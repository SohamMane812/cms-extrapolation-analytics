"""
data_generation/generate_cclf5_part_b_claims.py

Generates the Part B physician claim lines table (CCLF5).

Memory-optimized: writes records in chunks to avoid large in-memory
accumulation at full scale (~1M+ rows).

Dependencies:
    - config.yaml (via config_loader)
    - outputs/generated/{mode}/cclf8_beneficiary.parquet
    - outputs/generated/{mode}/provider_dim.parquet
    - outputs/generated/{mode}/procedure_ref.parquet

Usage:
    python data_generation/generate_cclf5_part_b_claims.py
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

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DENIAL_CODES   = ["CO-4", "CO-11", "CO-50", "CO-97", "PR-1", "OA-23"]
MODIFIER_POOL  = ["25", "59", "GT", "95", "TC", "26", "52", "76", "77", "KX"]
CHUNK_SIZE     = 50_000

POS_BASE = {
    "11": 0.45, "22": 0.20, "21": 0.10,
    "02": 0.15, "31": 0.05, "32": 0.05,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_pos_weights(from_dt, inj_cfg):
    pos_labels = list(POS_BASE.keys())
    pos_probs  = list(POS_BASE.values())
    if not inj_cfg.inject_temporal_drift:
        return pos_labels, pos_probs
    spike_year = int(inj_cfg.telehealth_increase_year)
    if from_dt.year >= spike_year:
        year_offset  = from_dt.year - spike_year
        tele_mult    = 1.0 + (inj_cfg.telehealth_increase_multiplier - 1.0) * min(year_offset + 1, 3) / 3
        tele_idx     = pos_labels.index("02")
        new_probs    = pos_probs.copy()
        old_tele     = new_probs[tele_idx]
        new_tele     = min(old_tele * tele_mult, 0.40)
        delta        = new_tele - old_tele
        office_idx   = pos_labels.index("11")
        new_probs[tele_idx]   = new_tele
        new_probs[office_idx] = max(new_probs[office_idx] - delta, 0.10)
        total     = sum(new_probs)
        new_probs = [p / total for p in new_probs]
        return pos_labels, new_probs
    return pos_labels, pos_probs


def sample_line_payment(procedure_row, pos_cd, is_denied, provider_risk, inj_cfg, rng):
    if is_denied:
        return 0.0, 0.0
    expected  = procedure_row["expected_allowed_amt"]
    std_dev   = procedure_row["allowed_amt_std_dev"]
    raw_amt   = float(rng.normal(expected, std_dev))
    allowed   = round(max(raw_amt, expected * 0.10), 2)
    if pos_cd == "02":
        allowed = round(allowed * 0.85, 2)
    if provider_risk == "Outlier" and inj_cfg.inject_outliers:
        if rng.random() < 0.15:
            mult_lo, mult_hi = inj_cfg.outlier_payment_multiplier
            allowed = round(allowed * float(rng.uniform(mult_lo, mult_hi)), 2)
    paid = round(allowed * float(rng.uniform(0.75, 0.82)), 2)
    return allowed, paid


def apply_temporal_drift(from_dt, allowed, paid, inj_cfg):
    if not inj_cfg.inject_temporal_drift:
        return allowed, paid
    drift_rate  = inj_cfg.coding_intensity_annual_increase
    year_offset = from_dt.year - 2021
    mult        = 1.0 + drift_rate * year_offset
    return round(allowed * mult, 2), round(paid * mult, 2)


# ---------------------------------------------------------------------------
# Chunked writer
# ---------------------------------------------------------------------------

# Explicit schema for CCLF5
CCLF5_SCHEMA = pa.schema([
    pa.field("cur_clm_uniq_id",         pa.string()),
    pa.field("clm_line_num",            pa.int64()),
    pa.field("bene_mbi_id",             pa.string()),
    pa.field("provider_id",             pa.string()),
    pa.field("clm_from_dt",             pa.date32()),
    pa.field("clm_thru_dt",             pa.date32()),
    pa.field("clm_line_from_dt",        pa.date32()),
    pa.field("clm_line_dgns_cd",        pa.string()),
    pa.field("clm_dgns_1_cd",           pa.string()),
    pa.field("clm_dgns_2_cd",           pa.string()),
    pa.field("clm_dgns_3_cd",           pa.string()),
    pa.field("clm_dgns_4_cd",           pa.string()),
    pa.field("clm_line_hcpcs_cd",       pa.string()),
    pa.field("clm_carr_pmt_dnl_cd",     pa.string()),
    pa.field("clm_adjsmt_type_cd",      pa.string()),
    pa.field("clm_orig_clm_id",         pa.string()),
    pa.field("dgns_prcdr_icd_ind",      pa.string()),
    pa.field("line_allowed_amt",        pa.float64()),
    pa.field("line_paid_amt",           pa.float64()),
    pa.field("units_of_service",        pa.int64()),
    pa.field("place_of_service_cd",     pa.string()),
    pa.field("modifier_1",              pa.string()),
    pa.field("modifier_2",              pa.string()),
    pa.field("service_category",        pa.string()),
    pa.field("overpayment_flag",        pa.bool_()),
    pa.field("overpayment_amt",         pa.float64()),
    pa.field("true_error_flag",         pa.bool_()),
    pa.field("suspicious_pattern_flag", pa.bool_()),
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
# Main generator
# ---------------------------------------------------------------------------

def generate_cclf5(cfg, partb_cfg, bene_df, provider_df, proc_ref_df, rng):
    print("  Generating CCLF5 Part B claim lines (chunked write mode)...")

    n_lines     = cfg.scale.num_part_b_claim_lines
    data_start  = date.fromisoformat(cfg.global_settings.date_start)
    data_end    = date.fromisoformat(cfg.global_settings.date_end)
    inj_cfg     = cfg.injection
    mode_key    = cfg.active_mode

    provider_risk_map = dict(zip(provider_df["provider_id"], provider_df["provider_risk_profile"]))

    physician_providers = provider_df[
        provider_df["provider_type"].isin(["Physician", "Outpatient_Facility"])
    ]["provider_id"].values
    if len(physician_providers) < 3:
        physician_providers = provider_df["provider_id"].values

    proc_by_category = {
        cat: proc_ref_df[proc_ref_df["procedure_category"] == cat]
        for cat in proc_ref_df["procedure_category"].unique()
    }

    service_weights = {
        "E/M": 0.35, "Imaging": 0.15, "Lab": 0.20, "Surgery": 0.05,
        "Telehealth": 0.10, "Injection": 0.08, "Pathology": 0.07,
    }
    svc_labels = [c for c in proc_by_category if c in service_weights]
    svc_probs  = [service_weights.get(c, 0.05) for c in svc_labels]
    svc_total  = sum(svc_probs)
    svc_probs  = [p / svc_total for p in svc_probs]

    denial_rate     = partb_cfg["denial_rate"]
    adj_rate        = partb_cfg["adjustment_rate"]
    cancel_rate     = partb_cfg["cancellation_rate"]
    op_rate         = partb_cfg["overpayment_rate"]
    op_pct_lo, op_pct_hi = partb_cfg["overpayment_pct_range"]
    lines_min       = partb_cfg["lines_per_claim"][mode_key]["min"]
    lines_max       = partb_cfg["lines_per_claim"][mode_key]["max"]

    util_weights = np.where(
        bene_df["utilization_segment"] == "High", 3.0,
        np.where(bene_df["utilization_segment"] == "Medium", 1.5, 0.8)
    ).astype(float)
    util_weights /= util_weights.sum()

    suspicious_daily_counts = {}

    writer        = ParquetChunkWriter(cfg.paths.cclf5, CCLF5_SCHEMA)
    chunk         = []
    adj_records   = []
    claim_counter = 1
    line_count    = 0

    dx_pool = ["E11.9", "I10", "J44.1", "N18.3", "M17.11",
               "G20", "I50.9", "E03.9", "I25.10", "F32.9"]

    while line_count < n_lines:
        claim_id = f"CLM5{str(claim_counter).zfill(10)}"
        claim_counter += 1

        bene_idx    = int(rng.choice(len(bene_df), p=util_weights))
        bene_row    = bene_df.iloc[bene_idx]
        bene_id     = bene_row["bene_mbi_id"]

        provider_id  = str(rng.choice(physician_providers))
        risk_profile = provider_risk_map.get(provider_id, "Normal")

        total_days  = (data_end - data_start).days
        from_offset = int(rng.integers(0, total_days))
        clm_from_dt = data_start + timedelta(days=from_offset)
        clm_thru_dt = clm_from_dt

        if risk_profile == "Suspicious" and inj_cfg.inject_suspicious_patterns:
            daily_key = clm_from_dt
            if provider_id not in suspicious_daily_counts:
                suspicious_daily_counts[provider_id] = {}
            day_count = suspicious_daily_counts[provider_id].get(daily_key, 0)
            if day_count > 20 * inj_cfg.suspicious_daily_volume_multiplier:
                provider_id  = str(rng.choice(physician_providers))
                risk_profile = provider_risk_map.get(provider_id, "Normal")
            suspicious_daily_counts[provider_id][daily_key] = day_count + 1

        n_lines_this = int(rng.integers(lines_min, lines_max + 1))

        n_clm_dx = min(4, int(rng.integers(1, 5)))
        clm_dx   = list(rng.choice(dx_pool, size=n_clm_dx, replace=False))
        clm_dx_cols = {f"clm_dgns_{j+1}_cd": (clm_dx[j] if j < len(clm_dx) else None) for j in range(4)}

        for line_num in range(1, n_lines_this + 1):
            if line_count >= n_lines:
                break

            svc_cat  = str(rng.choice(svc_labels, p=svc_probs))
            if svc_cat == "Telehealth":
                pos_cd = "02"
            else:
                pos_labels, pos_probs_adj = get_pos_weights(clm_from_dt, inj_cfg)
                pos_cd = str(rng.choice(pos_labels, p=pos_probs_adj))

            proc_pool = proc_by_category.get(svc_cat, proc_ref_df)
            if len(proc_pool) == 0:
                proc_pool = proc_ref_df
            proc_row = proc_pool.iloc[int(rng.integers(len(proc_pool)))]
            hcpcs_cd = proc_row["hcpcs_cd"]

            line_from_dt = clm_from_dt + timedelta(days=int(rng.integers(0, 2)))
            line_from_dt = min(line_from_dt, data_end)

            line_dgns_cd = clm_dx[0] if clm_dx else None

            is_denied = rng.random() < denial_rate
            if risk_profile in ("Suspicious", "Outlier"):
                is_denied = rng.random() < (denial_rate * 1.7)

            denial_code = str(rng.choice(DENIAL_CODES)) if is_denied else None

            allowed, paid = sample_line_payment(
                proc_row, pos_cd, is_denied, risk_profile, inj_cfg, rng
            )
            if inj_cfg.inject_temporal_drift:
                allowed, paid = apply_temporal_drift(clm_from_dt, allowed, paid, inj_cfg)

            units = int(rng.integers(
                partb_cfg["units_of_service"]["min"],
                partb_cfg["units_of_service"]["max"] + 1
            ))
            if risk_profile == "Suspicious" and inj_cfg.inject_suspicious_patterns:
                if rng.random() < 0.25:
                    units = int(rng.integers(5, 15))

            modifier_1 = str(rng.choice(MODIFIER_POOL)) if rng.random() < 0.35 else None
            modifier_2 = str(rng.choice(MODIFIER_POOL)) if rng.random() < 0.08 else None

            if not is_denied and rng.random() < op_rate:
                overpayment_flag = True
                overpayment_amt  = round(paid * float(rng.uniform(op_pct_lo, op_pct_hi)), 2)
                true_error_flag  = True
            else:
                overpayment_flag = False
                overpayment_amt  = 0.0
                true_error_flag  = False

            suspicious_pattern = (
                risk_profile in ("Suspicious", "Outlier")
                and inj_cfg.inject_suspicious_patterns
                and (units > 5 or (risk_profile == "Outlier"
                                   and allowed > proc_row["expected_allowed_amt"] * 2))
            )

            record = {
                "cur_clm_uniq_id":          claim_id,
                "clm_line_num":             line_num,
                "bene_mbi_id":              bene_id,
                "provider_id":              provider_id,
                "clm_from_dt":              clm_from_dt,
                "clm_thru_dt":              clm_thru_dt,
                "clm_line_from_dt":         line_from_dt,
                "clm_line_dgns_cd":         line_dgns_cd,
                "clm_dgns_1_cd":            clm_dx_cols["clm_dgns_1_cd"],
                "clm_dgns_2_cd":            clm_dx_cols["clm_dgns_2_cd"],
                "clm_dgns_3_cd":            clm_dx_cols["clm_dgns_3_cd"],
                "clm_dgns_4_cd":            clm_dx_cols["clm_dgns_4_cd"],
                "clm_line_hcpcs_cd":        hcpcs_cd,
                "clm_carr_pmt_dnl_cd":      denial_code,
                "clm_adjsmt_type_cd":       "0",
                "clm_orig_clm_id":          None,
                "dgns_prcdr_icd_ind":       "0",
                "line_allowed_amt":         allowed,
                "line_paid_amt":            paid,
                "units_of_service":         units,
                "place_of_service_cd":      pos_cd,
                "modifier_1":               modifier_1,
                "modifier_2":               modifier_2,
                "service_category":         svc_cat,
                "overpayment_flag":         overpayment_flag,
                "overpayment_amt":          overpayment_amt,
                "true_error_flag":          true_error_flag,
                "suspicious_pattern_flag":  suspicious_pattern,
            }
            chunk.append(record)
            line_count += 1

            if not is_denied:
                rand_val = rng.random()
                if rand_val < cancel_rate and inj_cfg.inject_duplicates:
                    adj_records.append(("cancel", claim_id, line_num, record.copy()))
                elif rand_val < (cancel_rate + adj_rate) and inj_cfg.inject_anomalies:
                    adj_records.append(("adjust", claim_id, line_num, record.copy()))

            if len(chunk) >= CHUNK_SIZE:
                writer.write_chunk(chunk)
                chunk = []

        if line_count % 100_000 == 0 or line_count >= n_lines:
            pct = line_count / n_lines * 100
            print(f"    Progress: {line_count:,}/{n_lines:,} lines ({pct:.1f}%)")

    # Flush remaining originals
    if chunk:
        writer.write_chunk(chunk)
        chunk = []

    print(f"    Original lines written: {writer.total:,}")
    print(f"    Appending {len(adj_records):,} adj/cancel records...")

    # Append adjustments
    for adj_type, orig_id, orig_line, orig_rec in adj_records:
        adj_rec = orig_rec.copy()
        adj_rec["clm_orig_clm_id"]          = orig_id
        adj_rec["overpayment_flag"]         = False
        adj_rec["overpayment_amt"]          = 0.0
        adj_rec["true_error_flag"]          = False
        adj_rec["suspicious_pattern_flag"]  = False

        if adj_type == "cancel":
            adj_rec["cur_clm_uniq_id"]    = f"{orig_id}_CXL"
            adj_rec["clm_adjsmt_type_cd"] = "1"
            adj_rec["line_paid_amt"]      = -abs(orig_rec["line_paid_amt"])
            adj_rec["line_allowed_amt"]   = -abs(orig_rec["line_allowed_amt"])
            adj_rec["clm_carr_pmt_dnl_cd"] = None
        else:
            adj_rec["cur_clm_uniq_id"]    = f"{orig_id}_ADJ"
            adj_rec["clm_adjsmt_type_cd"] = "2"
            delta = float(rng.uniform(-0.12, 0.08))
            adj_rec["line_paid_amt"]    = round(orig_rec["line_paid_amt"] * (1 + delta), 2)
            adj_rec["line_allowed_amt"] = round(orig_rec["line_allowed_amt"] * (1 + delta), 2)

        chunk.append(adj_rec)
        if len(chunk) >= CHUNK_SIZE:
            writer.write_chunk(chunk)
            chunk = []

    if chunk:
        writer.write_chunk(chunk)

    total_rows = writer.close()
    print(f"    Total rows written: {total_rows:,}")
    return total_rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("\n" + "=" * 60)
    print("generate_cclf5_part_b_claims.py")
    print("=" * 60)

    cfg = load_config()
    summarize_config(cfg)

    rng = np.random.default_rng(cfg.global_settings.random_seed)
    random.seed(cfg.global_settings.random_seed)

    get_output_dir(cfg)

    print("  Loading dependencies...")
    bene_df     = pd.read_parquet(cfg.paths.cclf8)
    provider_df = pd.read_parquet(cfg.paths.provider_dim)
    proc_ref_df = pd.read_parquet(cfg.paths.procedure_ref)
    print(f"    Loaded {len(bene_df):,} beneficiaries, {len(provider_df):,} providers, "
          f"{len(proc_ref_df):,} procedures.")

    partb_cfg = get_raw_section(cfg, "part_b_claims")

    total_rows = generate_cclf5(cfg, partb_cfg, bene_df, provider_df, proc_ref_df, rng)

    print(f"\n    Saved -> {cfg.paths.cclf5}  ({total_rows:,} rows)")

    print()
    print("Validation checks (reading back from parquet)...")
    df = pd.read_parquet(cfg.paths.cclf5)

    assert df["bene_mbi_id"].isin(bene_df["bene_mbi_id"]).all(),         "FAIL: Unknown bene IDs"
    assert df["provider_id"].isin(provider_df["provider_id"]).all(),      "FAIL: Unknown provider IDs"
    assert df["clm_line_hcpcs_cd"].isin(proc_ref_df["hcpcs_cd"]).all(),  "FAIL: Unknown HCPCS codes"
    assert df["clm_line_num"].ge(1).all(),                                 "FAIL: Line numbers below 1"
    assert (df["clm_thru_dt"] >= df["clm_from_dt"]).all(),               "FAIL: thru_dt before from_dt"
    assert df["units_of_service"].ge(1).all(),                            "FAIL: Units below 1"
    assert df["service_category"].notna().all(),                           "FAIL: Null service categories"

    denied = df[df["clm_carr_pmt_dnl_cd"].notna() & (df["clm_adjsmt_type_cd"] == "0")]
    assert denied["line_paid_amt"].eq(0.0).all(),                         "FAIL: Denied lines with non-zero paid"

    orig_paid = df[(df["clm_adjsmt_type_cd"] == "0") & (df["line_paid_amt"] > 0)]
    assert (orig_paid["line_allowed_amt"] >= orig_paid["line_paid_amt"]).all(), \
        "FAIL: Paid exceeds allowed"

    orig_df = df[df["clm_adjsmt_type_cd"] == "0"]
    denial_rate_actual = orig_df["clm_carr_pmt_dnl_cd"].notna().mean()
    telehealth_rate    = (orig_df["place_of_service_cd"] == "02").mean()
    suspicious_count   = orig_df["suspicious_pattern_flag"].sum()

    print("  cclf5_part_b_claims: all checks passed.")
    print(f"  Total lines          : {len(df):,}")
    print(f"  Original lines       : {len(orig_df):,}")
    print(f"  Denial rate          : {denial_rate_actual*100:.1f}%")
    print(f"  Telehealth rate      : {telehealth_rate*100:.1f}%")
    print(f"  Suspicious patterns  : {suspicious_count:,}")
    print()
    print("Part B claims generation complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
    