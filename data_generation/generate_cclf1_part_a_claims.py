"""
data_generation/generate_cclf1_part_a_claims.py

Generates the Part A claims header table (CCLF1).

Performance-optimized:
  - Vectorized beneficiary and provider sampling (pre-sampled in bulk)
  - Vectorized date, payment, and flag generation where possible
  - Chunked parquet writes to keep memory flat
  - Progress reporting every 50K claims

Dependencies:
    - config.yaml (via config_loader)
    - outputs/generated/{mode}/cclf8_beneficiary.parquet
    - outputs/generated/{mode}/provider_dim.parquet

Usage:
    python data_generation/generate_cclf1_part_a_claims.py
"""

import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

import random
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from src.utils.config_loader import load_config, get_output_dir, get_raw_section, summarize_config

CHUNK_SIZE = 50_000


# ---------------------------------------------------------------------------
# Chunked writer
# ---------------------------------------------------------------------------

# Explicit PyArrow schema — prevents null-type inference on all-None columns
CCLF1_SCHEMA = pa.schema([
    pa.field("cur_clm_uniq_id",      pa.string()),
    pa.field("bene_mbi_id",           pa.string()),
    pa.field("provider_id",           pa.string()),
    pa.field("clm_type_cd",           pa.string()),
    pa.field("clm_from_dt",           pa.date32()),
    pa.field("clm_thru_dt",           pa.date32()),
    pa.field("clm_mdcr_npmt_rsn_cd",  pa.string()),
    pa.field("clm_pmt_amt",           pa.float64()),
    pa.field("clm_adjsmt_type_cd",    pa.string()),
    pa.field("clm_orig_clm_id",       pa.string()),
    pa.field("dgns_prcdr_icd_ind",    pa.string()),
    pa.field("facility_type",         pa.string()),
    pa.field("claim_status",          pa.string()),
    pa.field("drg_cd",                pa.string()),
    pa.field("length_of_stay",        pa.float64()),
    pa.field("overpayment_flag",      pa.bool_()),
    pa.field("overpayment_amt",       pa.float64()),
    pa.field("audit_eligible_flag",   pa.bool_()),
    pa.field("true_error_flag",       pa.bool_()),
    pa.field("created_at",            pa.timestamp("ns")),
])


class ParquetChunkWriter:
    def __init__(self, path, schema):
        self.path   = path
        self.schema = schema
        self.writer = None
        self.total  = 0

    def write_chunk(self, records):
        if not records:
            return
        df    = pd.DataFrame(records)
        table = pa.Table.from_pandas(df, schema=self.schema, preserve_index=False)
        if self.writer is None:
            self.writer = pq.ParquetWriter(str(self.path), self.schema)
        self.writer.write_table(table)
        self.total += len(records)

    def close(self):
        if self.writer:
            self.writer.close()
        return self.total


# ---------------------------------------------------------------------------
# Vectorized helpers
# ---------------------------------------------------------------------------

def generate_claim_id(i):
    return f"CLM1{str(i).zfill(10)}"


def vectorized_dates(n, data_start, data_end, clm_types, los_cfg, rng):
    """
    Generate from_dt and thru_dt for all claims at once.
    Returns two lists of date objects.
    """
    total_days   = (data_end - data_start).days
    from_offsets = rng.integers(0, total_days, size=n)
    from_dates   = [data_start + timedelta(days=int(o)) for o in from_offsets]

    thru_dates = []
    for i, (fd, ct) in enumerate(zip(from_dates, clm_types)):
        if ct == "60":   # Inpatient
            los = int(np.clip(rng.normal(los_cfg["mean"], los_cfg["std"]),
                              los_cfg["min"], los_cfg["max"]))
            thru_dates.append(min(fd + timedelta(days=los), data_end))
        elif ct == "10": # HHA
            thru_dates.append(min(fd + timedelta(days=int(rng.integers(14, 61))), data_end))
        elif ct == "50": # Hospice
            thru_dates.append(min(fd + timedelta(days=int(rng.integers(1, 180))), data_end))
        elif ct == "20": # SNF
            thru_dates.append(min(fd + timedelta(days=int(rng.integers(3, 30))), data_end))
        else:            # Outpatient — same day
            thru_dates.append(fd)

    return from_dates, thru_dates


def sample_payment(clm_type, pay_cfg, is_denied, rng):
    if is_denied:
        return 0.0
    cfg = pay_cfg.get(clm_type, pay_cfg["40"])
    raw = rng.normal(cfg["mean"], cfg["std"])
    return round(float(np.clip(raw, cfg["min"], cfg["max"])), 2)


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

def generate_cclf1(cfg, parta_cfg, bene_df, provider_df, rng):
    print("  Generating CCLF1 Part A claims (vectorized + chunked)...")

    n_claims   = cfg.scale.num_part_a_claims
    data_start = date.fromisoformat(cfg.global_settings.date_start)
    data_end   = date.fromisoformat(cfg.global_settings.date_end)
    inj_cfg    = cfg.injection

    # -----------------------------------------------------------------------
    # Pre-compute sampling pools
    # -----------------------------------------------------------------------
    facility_types = {"Hospital", "SNF", "HHA", "Hospice", "Outpatient_Facility"}
    facility_providers = provider_df[
        provider_df["provider_type"].isin(facility_types)
    ]["provider_id"].values
    if len(facility_providers) < 3:
        facility_providers = provider_df["provider_id"].values

    provider_risk = dict(zip(provider_df["provider_id"], provider_df["provider_risk_profile"]))

    # Claim type distribution
    ct_cfg    = parta_cfg["claim_type_distribution"]
    ct_labels = list(ct_cfg.keys())
    ct_probs  = list(ct_cfg.values())

    # DRG pool
    drg_pool   = parta_cfg["drg_codes"]
    drg_codes  = [d["code"] for d in drg_pool]
    drg_weights = [d["weight"] for d in drg_pool]
    drg_total  = sum(drg_weights)
    drg_probs  = [w / drg_total for w in drg_weights]

    los_cfg        = parta_cfg["length_of_stay"]
    pay_cfg        = parta_cfg["payment_ranges"]
    adj_rate       = parta_cfg["adjustment_rate"]
    cancel_rate    = parta_cfg["cancellation_rate"]
    denial_rate    = parta_cfg["denial_rate"]
    op_rate        = parta_cfg["overpayment_rate"]
    op_pct_lo, op_pct_hi = parta_cfg["overpayment_pct_range"]
    audit_elig_rate = parta_cfg["audit_eligible_rate"]

    denial_codes = ["N1", "N30", "N115", "B7", "MA130"]

    facility_map = {"60": "Hospital", "40": "Outpatient",
                    "20": "SNF", "10": "HHA", "50": "Hospice"}

    # -----------------------------------------------------------------------
    # Pre-sample ALL beneficiaries at once (vectorized — the main speedup)
    # -----------------------------------------------------------------------
    print(f"    Pre-sampling {n_claims:,} beneficiary assignments...")
    util_weights = np.where(
        bene_df["utilization_segment"] == "High", 3.0,
        np.where(bene_df["utilization_segment"] == "Medium", 1.5, 0.8)
    ).astype(float)
    util_weights /= util_weights.sum()

    # Sample all bene indices at once — O(n) instead of O(n) loop calls
    bene_indices  = rng.choice(len(bene_df), size=n_claims, p=util_weights)
    bene_ids      = bene_df["bene_mbi_id"].values[bene_indices]
    ma_flags      = bene_df["ma_plan_flag"].values[bene_indices]

    # Pre-sample claim types and providers
    clm_types    = rng.choice(ct_labels, size=n_claims, p=ct_probs)
    provider_ids = rng.choice(facility_providers, size=n_claims)

    # Pre-sample denial flags
    denial_rand  = rng.random(size=n_claims)
    op_rand      = rng.random(size=n_claims)
    audit_rand   = rng.random(size=n_claims)
    adj_rand     = rng.random(size=n_claims)

    # Pre-generate dates vectorized
    print(f"    Generating service dates...")
    from_dates, thru_dates = vectorized_dates(
        n_claims, data_start, data_end, clm_types, los_cfg, rng
    )

    # -----------------------------------------------------------------------
    # Main loop — now just builds records, no sampling calls inside
    # -----------------------------------------------------------------------
    print(f"    Building {n_claims:,} claim records...")
    writer    = ParquetChunkWriter(cfg.paths.cclf1, CCLF1_SCHEMA)
    chunk     = []
    adj_queue = []

    for i in range(n_claims):
        claim_id    = generate_claim_id(i + 1)
        bene_id     = str(bene_ids[i])
        provider_id = str(provider_ids[i])
        clm_type    = str(clm_types[i])
        from_dt     = from_dates[i]
        thru_dt     = thru_dates[i]
        risk_profile = provider_risk.get(provider_id, "Normal")

        # Denial
        base_denial = denial_rate
        if risk_profile in ("Suspicious", "Outlier"):
            base_denial = denial_rate * 1.8
        is_denied = denial_rand[i] < base_denial

        if is_denied:
            claim_status = "Denied"
            denial_code  = str(rng.choice(denial_codes))
        else:
            claim_status = "Paid"
            denial_code  = None

        # Payment
        base_pmt = sample_payment(clm_type, pay_cfg, is_denied, rng)

        # Outlier inflation
        if risk_profile == "Outlier" and claim_status == "Paid" and inj_cfg.inject_outliers:
            mult_lo, mult_hi = inj_cfg.outlier_payment_multiplier
            if rng.random() < 0.20:
                base_pmt = round(base_pmt * float(rng.uniform(mult_lo, mult_hi)), 2)

        # Temporal drift
        if inj_cfg.inject_temporal_drift:
            drift_rate   = cfg.raw["injection"]["coding_intensity_annual_increase"]
            year_offset  = from_dt.year - 2021
            base_pmt     = round(base_pmt * (1.0 + drift_rate * year_offset), 2)

        # Flu season boost for inpatient Q1
        if inj_cfg.inject_temporal_drift and clm_type == "60" and from_dt.month in (1, 2, 3):
            base_pmt = round(base_pmt * 1.08, 2)

        clm_pmt_amt = base_pmt

        # DRG / LOS
        if clm_type == "60":
            drg_cd = str(rng.choice(drg_codes, p=drg_probs))
            los    = (thru_dt - from_dt).days
        else:
            drg_cd = None
            los    = None

        # Overpayment
        if claim_status == "Paid" and op_rand[i] < op_rate:
            overpayment_flag = True
            op_pct           = float(rng.uniform(op_pct_lo, op_pct_hi))
            overpayment_amt  = round(clm_pmt_amt * op_pct, 2)
            true_error_flag  = True
        else:
            overpayment_flag = False
            overpayment_amt  = 0.0
            true_error_flag  = False

        audit_eligible = (claim_status == "Paid") and (audit_rand[i] < audit_elig_rate)

        record = {
            "cur_clm_uniq_id":       claim_id,
            "bene_mbi_id":           bene_id,
            "provider_id":           provider_id,
            "clm_type_cd":           clm_type,
            "clm_from_dt":           from_dt,
            "clm_thru_dt":           thru_dt,
            "clm_mdcr_npmt_rsn_cd":  denial_code,
            "clm_pmt_amt":           clm_pmt_amt,
            "clm_adjsmt_type_cd":    "0",
            "clm_orig_clm_id":       None,
            "dgns_prcdr_icd_ind":    "0",
            "facility_type":         facility_map.get(clm_type, "Outpatient"),
            "claim_status":          claim_status,
            "drg_cd":                drg_cd,
            "length_of_stay":        los,
            "overpayment_flag":      overpayment_flag,
            "overpayment_amt":       overpayment_amt,
            "audit_eligible_flag":   audit_eligible,
            "true_error_flag":       true_error_flag,
            "created_at":            pd.Timestamp(from_dt),
        }
        chunk.append(record)

        # Queue adj/cancel
        if claim_status == "Paid":
            rv = adj_rand[i]
            if rv < cancel_rate and inj_cfg.inject_duplicates:
                adj_queue.append(("cancel", claim_id, record.copy()))
            elif rv < (cancel_rate + adj_rate) and inj_cfg.inject_anomalies:
                adj_queue.append(("adjust", claim_id, record.copy()))

        if len(chunk) >= CHUNK_SIZE:
            writer.write_chunk(chunk)
            chunk = []

        if (i + 1) % 50_000 == 0 or (i + 1) == n_claims:
            pct = (i + 1) / n_claims * 100
            print(f"    Progress: {i+1:,}/{n_claims:,} ({pct:.1f}%)")

    # Flush remaining originals
    if chunk:
        writer.write_chunk(chunk)
        chunk = []

    print(f"    Original claims written: {writer.total:,}")
    print(f"    Appending {len(adj_queue):,} adj/cancel records...")

    # Adjustments
    for adj_type, orig_id, orig_rec in adj_queue:
        adj_id  = f"{orig_id}_{'ADJ' if adj_type == 'adjust' else 'CXL'}"
        adj_rec = orig_rec.copy()
        adj_rec["cur_clm_uniq_id"]     = adj_id
        adj_rec["clm_orig_clm_id"]     = orig_id
        adj_rec["overpayment_flag"]    = False
        adj_rec["overpayment_amt"]     = 0.0
        adj_rec["true_error_flag"]     = False
        adj_rec["audit_eligible_flag"] = False

        if adj_type == "cancel":
            adj_rec["clm_adjsmt_type_cd"]    = "1"
            adj_rec["claim_status"]          = "Cancelled"
            adj_rec["clm_pmt_amt"]           = -abs(orig_rec["clm_pmt_amt"])
            adj_rec["clm_mdcr_npmt_rsn_cd"]  = None
        else:
            adj_rec["clm_adjsmt_type_cd"] = "2"
            adj_rec["claim_status"]       = "Adjusted"
            delta = float(rng.uniform(-0.15, 0.10))
            adj_rec["clm_pmt_amt"] = round(orig_rec["clm_pmt_amt"] * (1 + delta), 2)

        chunk.append(adj_rec)
        if len(chunk) >= CHUNK_SIZE:
            writer.write_chunk(chunk)
            chunk = []

    if chunk:
        writer.write_chunk(chunk)

    total_rows = writer.close()
    return total_rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("\n" + "=" * 60)
    print("generate_cclf1_part_a_claims.py")
    print("=" * 60)

    cfg = load_config()
    summarize_config(cfg)

    rng = np.random.default_rng(cfg.global_settings.random_seed)
    random.seed(cfg.global_settings.random_seed)

    get_output_dir(cfg)

    print("  Loading dependencies...")
    bene_df     = pd.read_parquet(cfg.paths.cclf8)
    provider_df = pd.read_parquet(cfg.paths.provider_dim)
    print(f"    Loaded {len(bene_df):,} beneficiaries, {len(provider_df):,} providers.")

    parta_cfg  = get_raw_section(cfg, "part_a_claims")
    total_rows = generate_cclf1(cfg, parta_cfg, bene_df, provider_df, rng)

    print(f"\n    Saved -> {cfg.paths.cclf1}  ({total_rows:,} rows)")

    # Validation
    print()
    print("Validation checks (reading back from parquet)...")
    df = pd.read_parquet(cfg.paths.cclf1)

    assert df["cur_clm_uniq_id"].is_unique,                          "FAIL: Duplicate claim IDs"
    assert df["bene_mbi_id"].isin(bene_df["bene_mbi_id"]).all(),     "FAIL: Unknown bene IDs"
    assert df["provider_id"].isin(provider_df["provider_id"]).all(), "FAIL: Unknown provider IDs"
    assert (df["clm_thru_dt"] >= df["clm_from_dt"]).all(),           "FAIL: thru_dt before from_dt"
    assert df["dgns_prcdr_icd_ind"].eq("0").all(),                   "FAIL: Non ICD-10 indicator"

    denied = df[df["claim_status"] == "Denied"]
    assert denied["clm_pmt_amt"].eq(0.0).all(),                      "FAIL: Denied claims non-zero pmt"

    cancelled = df[df["claim_status"] == "Cancelled"]
    if len(cancelled) > 0:
        assert cancelled["clm_pmt_amt"].le(0).all(),                 "FAIL: Cancelled claims positive pmt"

    adj_cancel = df[df["clm_adjsmt_type_cd"].isin(["1", "2"])]
    if len(adj_cancel) > 0:
        assert adj_cancel["clm_orig_clm_id"].notna().all(),          "FAIL: Adj/cancel missing orig_clm_id"

    originals = df[df["clm_adjsmt_type_cd"] == "0"]
    assert originals["clm_orig_clm_id"].isna().all(),                "FAIL: Originals with non-null orig_id"

    inpatient = df[df["clm_type_cd"] == "60"]
    if len(inpatient) > 0:
        assert inpatient["drg_cd"].notna().all(),                    "FAIL: Inpatient missing DRG"
        assert inpatient["length_of_stay"].notna().all(),            "FAIL: Inpatient missing LOS"

    non_ip = df[df["clm_type_cd"] != "60"]
    assert non_ip["drg_cd"].isna().all(),                            "FAIL: Non-inpatient has DRG"

    orig_df = df[df["clm_adjsmt_type_cd"] == "0"]
    print(f"  cclf1_part_a_claims: all checks passed.")
    print(f"  Total records        : {len(df):,}")
    print(f"  Original claims      : {len(orig_df):,}")
    print(f"  Adj/cancel records   : {len(df) - len(orig_df):,}")
    print(f"  Paid claims          : {(orig_df['claim_status']=='Paid').sum():,}")
    print(f"  Denied claims        : {(orig_df['claim_status']=='Denied').sum():,}")
    print(f"  Overpayment rate     : {orig_df['overpayment_flag'].mean()*100:.1f}%")
    print(f"  Avg payment (paid)   : ${orig_df[orig_df['claim_status']=='Paid']['clm_pmt_amt'].mean():,.2f}")
    print()
    print("Part A claims generation complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
    