"""
data_generation/generate_cclf1_part_a_claims.py

Generates the Part A claims header table (CCLF1).

Dependencies:
    - config.yaml (via config_loader)
    - outputs/generated/{mode}/cclf8_beneficiary.parquet
    - outputs/generated/{mode}/provider_dim.parquet

Usage:
    python data_generation/generate_cclf1_part_a_claims.py

Output (prototype mode):
    outputs/generated/prototype/cclf1_part_a_claims.parquet
"""

import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

import random
import uuid
from datetime import date, timedelta

import numpy as np
import pandas as pd

from src.utils.config_loader import load_config, get_output_dir, get_raw_section, summarize_config


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def generate_claim_id(i: int) -> str:
    return f"CLM1{str(i).zfill(10)}"


def generate_adjustment_id(orig_id: str, suffix: str) -> str:
    return f"{orig_id}_{suffix}"


def sample_service_dates(
    data_start: date,
    data_end: date,
    clm_type: str,
    los_cfg: dict,
    rng: np.random.Generator,
) -> tuple[date, date]:
    """Sample claim from/thru dates. Inpatient uses LOS distribution."""
    total_days = (data_end - data_start).days
    from_offset = int(rng.integers(0, total_days))
    from_dt = data_start + timedelta(days=from_offset)

    if clm_type == "60":  # Inpatient
        los = int(np.clip(
            rng.normal(los_cfg["mean"], los_cfg["std"]),
            los_cfg["min"],
            los_cfg["max"]
        ))
        thru_dt = min(from_dt + timedelta(days=los), data_end)
    elif clm_type == "10":  # HHA — multi-day episodes
        episode_days = int(rng.integers(14, 61))
        thru_dt = min(from_dt + timedelta(days=episode_days), data_end)
    elif clm_type == "50":  # Hospice — can be long
        episode_days = int(rng.integers(1, 180))
        thru_dt = min(from_dt + timedelta(days=episode_days), data_end)
    elif clm_type == "20":  # SNF
        episode_days = int(rng.integers(3, 30))
        thru_dt = min(from_dt + timedelta(days=episode_days), data_end)
    else:  # Outpatient — same day
        thru_dt = from_dt

    return from_dt, thru_dt


def sample_payment(
    clm_type: str,
    pay_cfg: dict,
    claim_status: str,
    rng: np.random.Generator,
) -> float:
    """Sample a realistic payment amount for a given claim type."""
    if claim_status == "Denied":
        return 0.0

    cfg = pay_cfg.get(clm_type, pay_cfg["40"])
    raw = rng.normal(cfg["mean"], cfg["std"])
    amount = float(np.clip(raw, cfg["min"], cfg["max"]))
    return round(amount, 2)


def apply_temporal_drift(
    from_dt: date,
    base_payment: float,
    inj_cfg: dict,
) -> float:
    """
    Apply temporal drift: slight payment increase over years
    to simulate coding intensity growth.
    """
    drift_rate = inj_cfg.get("coding_intensity_annual_increase", 0.03)
    year_offset = from_dt.year - 2021
    multiplier  = 1.0 + (drift_rate * year_offset)
    return round(base_payment * multiplier, 2)


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

def generate_cclf1(
    cfg,
    parta_cfg: dict,
    bene_df: pd.DataFrame,
    provider_df: pd.DataFrame,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """Generate CCLF1 Part A claims header table."""
    print("  Generating CCLF1 Part A claims...")

    n_claims    = cfg.scale.num_part_a_claims
    data_start  = date.fromisoformat(cfg.global_settings.date_start)
    data_end    = date.fromisoformat(cfg.global_settings.date_end)
    inj_cfg     = cfg.injection

    # Separate active providers by type for realistic assignment
    facility_types = {"Hospital", "SNF", "HHA", "Hospice", "Outpatient_Facility"}
    facility_providers = provider_df[
        provider_df["provider_type"].isin(facility_types)
    ]["provider_id"].values

    # Fall back to all providers if too few facility providers (prototype mode)
    if len(facility_providers) < 3:
        facility_providers = provider_df["provider_id"].values

    # Claim type weights
    ct_cfg      = parta_cfg["claim_type_distribution"]
    ct_labels   = list(ct_cfg.keys())
    ct_probs    = list(ct_cfg.values())

    # Provider risk profiles for anomaly logic
    provider_risk = dict(zip(
        provider_df["provider_id"],
        provider_df["provider_risk_profile"]
    ))

    # DRG pool
    drg_pool    = parta_cfg["drg_codes"]
    drg_codes   = [d["code"] for d in drg_pool]
    drg_weights = [d["weight"] for d in drg_pool]
    drg_total   = sum(drg_weights)
    drg_probs   = [w / drg_total for w in drg_weights]

    los_cfg     = parta_cfg["length_of_stay"]
    pay_cfg     = parta_cfg["payment_ranges"]

    adj_rate    = parta_cfg["adjustment_rate"]
    cancel_rate = parta_cfg["cancellation_rate"]
    denial_rate = parta_cfg["denial_rate"]
    op_rate     = parta_cfg["overpayment_rate"]
    op_pct_lo, op_pct_hi = parta_cfg["overpayment_pct_range"]
    audit_elig_rate = parta_cfg["audit_eligible_rate"]

    # Denial reason codes (simplified realistic set)
    denial_codes = [
        "N1",    # Benefit not covered
        "N30",   # Not medically necessary
        "N115",  # Documentation insufficient
        "B7",    # Not covered as billed
        "MA130", # Claim lacks required info
    ]

    records      = []
    claim_counter = 1
    adj_claims   = []   # Collect adjustment/cancellation pairs after originals

    for i in range(n_claims):
        claim_id   = generate_claim_id(claim_counter)
        claim_counter += 1

        # Beneficiary — weight toward high utilizers for realism
        util_weights = np.where(
            bene_df["utilization_segment"] == "High", 3.0,
            np.where(bene_df["utilization_segment"] == "Medium", 1.5, 0.8)
        ).astype(float)
        util_weights /= util_weights.sum()
        bene_row = bene_df.iloc[int(rng.choice(len(bene_df), p=util_weights))]
        bene_id  = bene_row["bene_mbi_id"]

        # Provider
        provider_id = str(rng.choice(facility_providers))
        risk_profile = provider_risk.get(provider_id, "Normal")

        # Claim type
        clm_type = str(rng.choice(ct_labels, p=ct_probs))

        # Dates
        from_dt, thru_dt = sample_service_dates(data_start, data_end, clm_type, los_cfg, rng)

        # Claim status and denial
        is_denied = rng.random() < denial_rate
        # Outlier/Suspicious providers have higher denial rates
        if risk_profile in ("Suspicious", "Outlier"):
            is_denied = rng.random() < (denial_rate * 1.8)

        if is_denied:
            claim_status = "Denied"
            denial_code  = str(rng.choice(denial_codes))
        else:
            claim_status = "Paid"
            denial_code  = None

        # Payment
        base_payment = sample_payment(clm_type, pay_cfg, claim_status, rng)

        # Outlier providers get inflated payments
        if risk_profile == "Outlier" and claim_status == "Paid" and inj_cfg.inject_outliers:
            mult_lo, mult_hi = inj_cfg.outlier_payment_multiplier
            outlier_mult = float(rng.uniform(mult_lo, mult_hi))
            # Only inflate ~20% of outlier provider claims
            if rng.random() < 0.20:
                base_payment = round(base_payment * outlier_mult, 2)

        # Temporal drift
        if inj_cfg.inject_temporal_drift:
            base_payment = apply_temporal_drift(from_dt, base_payment, cfg.raw["injection"])

        clm_pmt_amt = base_payment

        # DRG — inpatient only
        if clm_type == "60":
            drg_cd = str(rng.choice(drg_codes, p=drg_probs))
            los    = (thru_dt - from_dt).days
        else:
            drg_cd = None
            los    = None

        # Overpayment
        if claim_status == "Paid" and rng.random() < op_rate:
            overpayment_flag = True
            op_pct           = float(rng.uniform(op_pct_lo, op_pct_hi))
            overpayment_amt  = round(clm_pmt_amt * op_pct, 2)
            true_error_flag  = True
        else:
            overpayment_flag = False
            overpayment_amt  = 0.0
            true_error_flag  = False

        # Audit eligibility — denied and cancelled claims not eligible
        audit_eligible = (claim_status == "Paid") and (rng.random() < audit_elig_rate)

        # Facility type from claim type
        facility_map = {
            "60": "Hospital",
            "40": "Outpatient",
            "20": "SNF",
            "10": "HHA",
            "50": "Hospice",
        }
        facility_type = facility_map.get(clm_type, "Outpatient")

        records.append({
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
            "facility_type":         facility_type,
            "claim_status":          claim_status,
            "drg_cd":                drg_cd,
            "length_of_stay":        los,
            "overpayment_flag":      overpayment_flag,
            "overpayment_amt":       overpayment_amt,
            "audit_eligible_flag":   audit_eligible,
            "true_error_flag":       true_error_flag,
            "created_at":            pd.Timestamp(from_dt),
        })

        # --- Queue adjustment or cancellation for this claim ---
        if claim_status == "Paid":
            rand_val = rng.random()
            if rand_val < cancel_rate and inj_cfg.inject_duplicates:
                adj_claims.append(("cancel", claim_id, records[-1].copy()))
            elif rand_val < (cancel_rate + adj_rate) and inj_cfg.inject_anomalies:
                adj_claims.append(("adjust", claim_id, records[-1].copy()))

    # -----------------------------------------------------------------------
    # Append adjustment and cancellation records
    # -----------------------------------------------------------------------
    for adj_type, orig_id, orig_rec in adj_claims:
        adj_id = generate_adjustment_id(orig_id, "ADJ" if adj_type == "adjust" else "CXL")

        adj_rec = orig_rec.copy()
        adj_rec["cur_clm_uniq_id"]    = adj_id
        adj_rec["clm_orig_clm_id"]    = orig_id
        adj_rec["overpayment_flag"]   = False
        adj_rec["overpayment_amt"]    = 0.0
        adj_rec["true_error_flag"]    = False
        adj_rec["audit_eligible_flag"] = False

        if adj_type == "cancel":
            adj_rec["clm_adjsmt_type_cd"] = "1"
            adj_rec["claim_status"]       = "Cancelled"
            adj_rec["clm_pmt_amt"]        = -abs(orig_rec["clm_pmt_amt"])
            adj_rec["clm_mdcr_npmt_rsn_cd"] = None
        else:
            adj_rec["clm_adjsmt_type_cd"] = "2"
            adj_rec["claim_status"]       = "Adjusted"
            # Adjustment payment is slightly modified original
            delta = float(rng.uniform(-0.15, 0.10))
            adj_rec["clm_pmt_amt"] = round(orig_rec["clm_pmt_amt"] * (1 + delta), 2)

        records.append(adj_rec)

    # -----------------------------------------------------------------------
    # Build DataFrame
    # -----------------------------------------------------------------------
    df = pd.DataFrame(records)

    # -----------------------------------------------------------------------
    # Telehealth temporal injection — not applicable for Part A
    # but apply seasonal flu spike for inpatient claims in Q1
    # -----------------------------------------------------------------------
    if inj_cfg.inject_temporal_drift:
        flu_mask = (
            (df["clm_type_cd"] == "60") &
            (df["clm_from_dt"].apply(lambda d: d.month in [1, 2, 3]))
        )
        df.loc[flu_mask, "clm_pmt_amt"] = (
            df.loc[flu_mask, "clm_pmt_amt"] * 1.08
        ).round(2)

    # Summary stats
    orig_df = df[df["clm_adjsmt_type_cd"] == "0"]
    print(f"    Generated {len(df):,} total records ({len(orig_df):,} original + {len(df)-len(orig_df):,} adj/cancel).")
    print(f"    Claim type dist  : {orig_df['clm_type_cd'].value_counts().to_dict()}")
    print(f"    Claim status     : {orig_df['claim_status'].value_counts().to_dict()}")
    print(f"    Overpayment rate : {orig_df['overpayment_flag'].mean()*100:.1f}% of original claims")
    print(f"    Avg payment      : ${orig_df[orig_df['claim_status']=='Paid']['clm_pmt_amt'].mean():,.2f}")
    print(f"    Total payment    : ${orig_df[orig_df['claim_status']=='Paid']['clm_pmt_amt'].sum():,.0f}")
    print(f"    Audit eligible   : {orig_df['audit_eligible_flag'].sum():,} claims")

    return df


# ---------------------------------------------------------------------------
# Save helper
# ---------------------------------------------------------------------------

def save_table(df: pd.DataFrame, path: Path, output_format: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if output_format == "parquet":
        df.to_parquet(path, index=False)
    else:
        df.to_csv(path, index=False)
    print(f"    Saved → {path}  ({len(df):,} rows)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("\n" + "=" * 60)
    print("generate_cclf1_part_a_claims.py")
    print("=" * 60)

    cfg = load_config()
    summarize_config(cfg)

    rng = np.random.default_rng(cfg.global_settings.random_seed)
    random.seed(cfg.global_settings.random_seed)

    get_output_dir(cfg)

    # Load dependencies
    print("  Loading dependencies...")
    bene_df     = pd.read_parquet(cfg.paths.cclf8)
    provider_df = pd.read_parquet(cfg.paths.provider_dim)
    print(f"    Loaded {len(bene_df):,} beneficiaries, {len(provider_df):,} providers.")

    parta_cfg = get_raw_section(cfg, "part_a_claims")

    df = generate_cclf1(cfg, parta_cfg, bene_df, provider_df, rng)
    save_table(df, cfg.paths.cclf1, cfg.global_settings.output_format)

    # -----------------------------------------------------------------------
    # Validation
    # -----------------------------------------------------------------------
    print()
    print("Validation checks:")

    assert df["cur_clm_uniq_id"].is_unique,                         "FAIL: Duplicate claim IDs"
    assert df["bene_mbi_id"].isin(bene_df["bene_mbi_id"]).all(),    "FAIL: Unknown beneficiary IDs"
    assert df["provider_id"].isin(provider_df["provider_id"]).all(),"FAIL: Unknown provider IDs"
    assert (df["clm_thru_dt"] >= df["clm_from_dt"]).all(),          "FAIL: thru_dt before from_dt"
    assert df["dgns_prcdr_icd_ind"].eq("0").all(),                  "FAIL: Non ICD-10 indicator found"

    # Denied claims have $0 payment
    denied = df[df["claim_status"] == "Denied"]
    assert denied["clm_pmt_amt"].eq(0.0).all(),                     "FAIL: Denied claims with non-zero payment"

    # Cancelled claims have negative payment
    cancelled = df[df["claim_status"] == "Cancelled"]
    if len(cancelled) > 0:
        assert cancelled["clm_pmt_amt"].le(0).all(),                "FAIL: Cancelled claims with positive payment"

    # Adjustment/cancel records have orig claim ID populated
    adj_cancel = df[df["clm_adjsmt_type_cd"].isin(["1", "2"])]
    if len(adj_cancel) > 0:
        assert adj_cancel["clm_orig_clm_id"].notna().all(),         "FAIL: Adj/cancel records missing orig_clm_id"

    # Original records have null orig claim ID
    originals = df[df["clm_adjsmt_type_cd"] == "0"]
    assert originals["clm_orig_clm_id"].isna().all(),               "FAIL: Original claims with non-null orig_clm_id"

    # DRG only for inpatient
    inpatient = df[df["clm_type_cd"] == "60"]
    if len(inpatient) > 0:
        assert inpatient["drg_cd"].notna().all(),                   "FAIL: Inpatient claims missing DRG"
        assert inpatient["length_of_stay"].notna().all(),           "FAIL: Inpatient claims missing LOS"

    non_inpatient = df[df["clm_type_cd"] != "60"]
    assert non_inpatient["drg_cd"].isna().all(),                    "FAIL: Non-inpatient claims with DRG"
    assert non_inpatient["length_of_stay"].isna().all(),            "FAIL: Non-inpatient claims with LOS"

    # Overpayment amount is 0 when flag is False
    no_op = df[~df["overpayment_flag"]]
    assert no_op["overpayment_amt"].eq(0.0).all(),                  "FAIL: Non-overpayment claims with non-zero overpayment_amt"

    print("  cclf1_part_a_claims: all checks passed.")
    print()
    print("Part A claims generation complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
    