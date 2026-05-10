"""
data_generation/generate_cclf5_part_b_claims.py

Generates the Part B physician claim lines table (CCLF5).

One row per service line. Multiple lines can share a claim ID.

Dependencies:
    - config.yaml (via config_loader)
    - outputs/generated/{mode}/cclf8_beneficiary.parquet
    - outputs/generated/{mode}/provider_dim.parquet
    - outputs/generated/{mode}/procedure_ref.parquet

Usage:
    python data_generation/generate_cclf5_part_b_claims.py

Output (prototype mode):
    outputs/generated/prototype/cclf5_part_b_claims.parquet
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

from src.utils.config_loader import load_config, get_output_dir, get_raw_section, summarize_config


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DENIAL_CODES = ["CO-4", "CO-11", "CO-50", "CO-97", "PR-1", "OA-23"]

MODIFIER_POOL = ["25", "59", "GT", "95", "TC", "26", "52", "76", "77", "KX"]

# Place of service weights adjusted for telehealth temporal drift
POS_BASE = {
    "11": 0.45,
    "22": 0.20,
    "21": 0.10,
    "02": 0.15,
    "31": 0.05,
    "32": 0.05,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_pos_weights(from_dt: date, inj_cfg) -> tuple[list, list]:
    """
    Adjust place-of-service weights for telehealth temporal drift.
    Telehealth (02) increases significantly from 2021 onward.
    """
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
        # Reduce office visits proportionally to compensate
        office_idx   = pos_labels.index("11")
        new_probs[tele_idx]  = new_tele
        new_probs[office_idx] = max(new_probs[office_idx] - delta, 0.10)
        total = sum(new_probs)
        new_probs = [p / total for p in new_probs]
        return pos_labels, new_probs

    return pos_labels, pos_probs


def sample_line_payment(
    procedure_row: pd.Series,
    pos_cd: str,
    is_denied: bool,
    provider_risk: str,
    inj_cfg,
    rng: np.random.Generator,
) -> tuple[float, float]:
    """
    Sample line allowed and paid amounts.
    Returns (line_allowed_amt, line_paid_amt).
    """
    if is_denied:
        return 0.0, 0.0

    expected   = procedure_row["expected_allowed_amt"]
    std_dev    = procedure_row["allowed_amt_std_dev"]
    raw_amount = float(rng.normal(expected, std_dev))
    allowed    = round(max(raw_amount, expected * 0.10), 2)

    # Telehealth slight discount
    if pos_cd == "02":
        allowed = round(allowed * 0.85, 2)

    # Outlier provider inflation
    if provider_risk == "Outlier" and inj_cfg.inject_outliers:
        if rng.random() < 0.15:
            mult_lo, mult_hi = inj_cfg.outlier_payment_multiplier
            allowed = round(allowed * float(rng.uniform(mult_lo, mult_hi)), 2)

    # Medicare typically pays 80% of allowed after deductible
    paid = round(allowed * float(rng.uniform(0.75, 0.82)), 2)

    return allowed, paid


def apply_temporal_drift_payment(
    from_dt: date,
    allowed: float,
    paid: float,
    inj_cfg,
) -> tuple[float, float]:
    """Apply annual coding intensity drift to payments."""
    if not inj_cfg.inject_temporal_drift:
        return allowed, paid
    drift_rate = inj_cfg.coding_intensity_annual_increase
    year_offset = from_dt.year - 2021
    mult = 1.0 + drift_rate * year_offset
    return round(allowed * mult, 2), round(paid * mult, 2)


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

def generate_cclf5(
    cfg,
    partb_cfg: dict,
    bene_df: pd.DataFrame,
    provider_df: pd.DataFrame,
    proc_ref_df: pd.DataFrame,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """Generate CCLF5 Part B claim lines table."""
    print("  Generating CCLF5 Part B claim lines...")

    n_lines     = cfg.scale.num_part_b_claim_lines
    data_start  = date.fromisoformat(cfg.global_settings.date_start)
    data_end    = date.fromisoformat(cfg.global_settings.date_end)
    inj_cfg     = cfg.injection
    mode_key    = cfg.active_mode

    # Provider lookup
    provider_risk_map = dict(zip(
        provider_df["provider_id"],
        provider_df["provider_risk_profile"]
    ))
    provider_type_map = dict(zip(
        provider_df["provider_id"],
        provider_df["provider_type"]
    ))

    # Physician providers for Part B
    physician_providers = provider_df[
        provider_df["provider_type"].isin(["Physician", "Outpatient_Facility"])
    ]["provider_id"].values
    if len(physician_providers) < 3:
        physician_providers = provider_df["provider_id"].values

    # Procedure ref lookup
    proc_by_category = {
        cat: proc_ref_df[proc_ref_df["procedure_category"] == cat]
        for cat in proc_ref_df["procedure_category"].unique()
    }

    # Service category weights
    service_categories = list(proc_by_category.keys())
    service_weights = {
        "E/M":       0.35,
        "Imaging":   0.15,
        "Lab":       0.20,
        "Surgery":   0.05,
        "Telehealth":0.10,
        "Injection": 0.08,
        "Pathology": 0.07,
    }
    svc_labels = [c for c in service_categories if c in service_weights]
    svc_probs  = [service_weights.get(c, 0.05) for c in svc_labels]
    svc_total  = sum(svc_probs)
    svc_probs  = [p / svc_total for p in svc_probs]

    # Denial rates
    denial_rate     = partb_cfg["denial_rate"]
    adj_rate        = partb_cfg["adjustment_rate"]
    cancel_rate     = partb_cfg["cancellation_rate"]
    op_rate         = partb_cfg["overpayment_rate"]
    op_pct_lo, op_pct_hi = partb_cfg["overpayment_pct_range"]
    lines_min       = partb_cfg["lines_per_claim"][mode_key]["min"]
    lines_max       = partb_cfg["lines_per_claim"][mode_key]["max"]

    # Beneficiary weights
    util_weights = np.where(
        bene_df["utilization_segment"] == "High", 3.0,
        np.where(bene_df["utilization_segment"] == "Medium", 1.5, 0.8)
    ).astype(float)
    util_weights /= util_weights.sum()

    # Suspicious provider daily volume tracking
    suspicious_daily_counts: dict[str, dict[date, int]] = {}
    suspicious_volume_mult = inj_cfg.suspicious_daily_volume_multiplier

    records     = []
    adj_records = []
    claim_counter = 1
    line_count    = 0

    while line_count < n_lines:
        # --- New claim ---
        claim_id = f"CLM5{str(claim_counter).zfill(10)}"
        claim_counter += 1

        # Beneficiary
        bene_idx = int(rng.choice(len(bene_df), p=util_weights))
        bene_row = bene_df.iloc[bene_idx]
        bene_id  = bene_row["bene_mbi_id"]

        # Provider
        provider_id   = str(rng.choice(physician_providers))
        risk_profile  = provider_risk_map.get(provider_id, "Normal")

        # Claim date
        total_days  = (data_end - data_start).days
        from_offset = int(rng.integers(0, total_days))
        clm_from_dt = data_start + timedelta(days=from_offset)
        clm_thru_dt = clm_from_dt  # Part B claims are typically same day or short span

        # Suspicious provider: inflate daily volume
        if risk_profile == "Suspicious" and inj_cfg.inject_suspicious_patterns:
            daily_key = clm_from_dt
            if provider_id not in suspicious_daily_counts:
                suspicious_daily_counts[provider_id] = {}
            day_count = suspicious_daily_counts[provider_id].get(daily_key, 0)
            if day_count > 20 * suspicious_volume_mult:
                # Skip this provider for today — already over limit
                provider_id  = str(rng.choice(physician_providers))
                risk_profile = provider_risk_map.get(provider_id, "Normal")
            suspicious_daily_counts[provider_id][daily_key] = day_count + 1

        # Number of lines for this claim
        n_lines_this_claim = int(rng.integers(lines_min, lines_max + 1))

        # Claim-level diagnoses (up to 4)
        dx_pool = ["E11.9", "I10", "J44.1", "N18.3", "M17.11",
                   "G20", "I50.9", "E03.9", "I25.10", "F32.9"]
        n_clm_dx = min(4, int(rng.integers(1, 5)))
        clm_dx_selected = list(rng.choice(dx_pool, size=n_clm_dx, replace=False))
        clm_dx_cols = {f"clm_dgns_{j+1}_cd": (clm_dx_selected[j] if j < len(clm_dx_selected) else None)
                      for j in range(4)}

        for line_num in range(1, n_lines_this_claim + 1):
            if line_count >= n_lines:
                break

            # Service category and procedure
            svc_cat  = str(rng.choice(svc_labels, p=svc_probs))

            # Telehealth adjusts by date
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

            # Line-level service date
            line_from_dt = clm_from_dt + timedelta(days=int(rng.integers(0, 2)))
            line_from_dt = min(line_from_dt, data_end)

            # Line diagnosis
            line_dgns_cd = clm_dx_selected[0] if clm_dx_selected else None

            # Denial
            is_denied = rng.random() < denial_rate
            if risk_profile in ("Suspicious", "Outlier"):
                is_denied = rng.random() < (denial_rate * 1.7)

            denial_code = str(rng.choice(DENIAL_CODES)) if is_denied else None
            claim_status_line = "Denied" if is_denied else "Paid"

            # Payment
            allowed, paid = sample_line_payment(
                proc_row, pos_cd, is_denied, risk_profile, inj_cfg, rng
            )
            if inj_cfg.inject_temporal_drift:
                allowed, paid = apply_temporal_drift_payment(clm_from_dt, allowed, paid, inj_cfg)

            # Units of service
            units = int(rng.integers(
                partb_cfg["units_of_service"]["min"],
                partb_cfg["units_of_service"]["max"] + 1
            ))
            # Suspicious providers bill higher units
            if risk_profile == "Suspicious" and inj_cfg.inject_suspicious_patterns:
                if rng.random() < 0.25:
                    units = int(rng.integers(5, 15))

            # Modifiers
            modifier_1 = str(rng.choice(MODIFIER_POOL)) if rng.random() < 0.35 else None
            modifier_2 = str(rng.choice(MODIFIER_POOL)) if rng.random() < 0.08 else None

            # Overpayment
            if not is_denied and rng.random() < op_rate:
                overpayment_flag = True
                op_pct           = float(rng.uniform(op_pct_lo, op_pct_hi))
                overpayment_amt  = round(paid * op_pct, 2)
                true_error_flag  = True
            else:
                overpayment_flag = False
                overpayment_amt  = 0.0
                true_error_flag  = False

            # Suspicious pattern flag
            suspicious_pattern = (
                risk_profile in ("Suspicious", "Outlier")
                and inj_cfg.inject_suspicious_patterns
                and (units > 5 or (risk_profile == "Outlier" and allowed > proc_row["expected_allowed_amt"] * 2))
            )

            record = {
                "cur_clm_uniq_id":      claim_id,
                "clm_line_num":         line_num,
                "bene_mbi_id":          bene_id,
                "provider_id":          provider_id,
                "clm_from_dt":          clm_from_dt,
                "clm_thru_dt":          clm_thru_dt,
                "clm_line_from_dt":     line_from_dt,
                "clm_line_dgns_cd":     line_dgns_cd,
                "clm_dgns_1_cd":        clm_dx_cols["clm_dgns_1_cd"],
                "clm_dgns_2_cd":        clm_dx_cols["clm_dgns_2_cd"],
                "clm_dgns_3_cd":        clm_dx_cols["clm_dgns_3_cd"],
                "clm_dgns_4_cd":        clm_dx_cols["clm_dgns_4_cd"],
                "clm_line_hcpcs_cd":    hcpcs_cd,
                "clm_carr_pmt_dnl_cd":  denial_code,
                "clm_adjsmt_type_cd":   "0",
                "clm_orig_clm_id":      None,
                "dgns_prcdr_icd_ind":   "0",
                "line_allowed_amt":     allowed,
                "line_paid_amt":        paid,
                "units_of_service":     units,
                "place_of_service_cd":  pos_cd,
                "modifier_1":           modifier_1,
                "modifier_2":           modifier_2,
                "service_category":     svc_cat,
                "overpayment_flag":     overpayment_flag,
                "overpayment_amt":      overpayment_amt,
                "true_error_flag":      true_error_flag,
                "suspicious_pattern_flag": suspicious_pattern,
            }
            records.append(record)
            line_count += 1

            # Queue adjustment/cancellation
            if not is_denied:
                rand_val = rng.random()
                if rand_val < cancel_rate and inj_cfg.inject_duplicates:
                    adj_records.append(("cancel", claim_id, line_num, record.copy()))
                elif rand_val < (cancel_rate + adj_rate) and inj_cfg.inject_anomalies:
                    adj_records.append(("adjust", claim_id, line_num, record.copy()))

    # -----------------------------------------------------------------------
    # Append adjustment and cancellation records
    # -----------------------------------------------------------------------
    for adj_type, orig_claim_id, orig_line_num, orig_rec in adj_records:
        adj_rec = orig_rec.copy()
        adj_rec["clm_orig_clm_id"]    = orig_claim_id
        adj_rec["overpayment_flag"]   = False
        adj_rec["overpayment_amt"]    = 0.0
        adj_rec["true_error_flag"]    = False
        adj_rec["suspicious_pattern_flag"] = False

        if adj_type == "cancel":
            adj_rec["cur_clm_uniq_id"]    = f"{orig_claim_id}_CXL"
            adj_rec["clm_adjsmt_type_cd"] = "1"
            adj_rec["line_paid_amt"]      = -abs(orig_rec["line_paid_amt"])
            adj_rec["line_allowed_amt"]   = -abs(orig_rec["line_allowed_amt"])
            adj_rec["clm_carr_pmt_dnl_cd"] = None
        else:
            adj_rec["cur_clm_uniq_id"]    = f"{orig_claim_id}_ADJ"
            adj_rec["clm_adjsmt_type_cd"] = "2"
            delta = float(rng.uniform(-0.12, 0.08))
            adj_rec["line_paid_amt"]    = round(orig_rec["line_paid_amt"] * (1 + delta), 2)
            adj_rec["line_allowed_amt"] = round(orig_rec["line_allowed_amt"] * (1 + delta), 2)

        records.append(adj_rec)

    # -----------------------------------------------------------------------
    # Build DataFrame
    # -----------------------------------------------------------------------
    df = pd.DataFrame(records)

    # -----------------------------------------------------------------------
    # Summary stats
    # -----------------------------------------------------------------------
    orig_df = df[df["clm_adjsmt_type_cd"] == "0"]
    paid_df = orig_df[orig_df["line_paid_amt"] > 0]

    print(f"    Generated {len(df):,} total lines ({len(orig_df):,} original + {len(df)-len(orig_df):,} adj/cancel).")
    print(f"    Unique Part B claims    : {orig_df['cur_clm_uniq_id'].nunique():,}")
    print(f"    Service categories      : {orig_df['service_category'].value_counts().to_dict()}")
    print(f"    Denial rate             : {(orig_df['clm_carr_pmt_dnl_cd'].notna().mean()*100):.1f}%")
    print(f"    Overpayment rate        : {orig_df['overpayment_flag'].mean()*100:.1f}%")
    print(f"    Suspicious pattern lines: {orig_df['suspicious_pattern_flag'].sum():,}")
    print(f"    Avg line paid amt       : ${paid_df['line_paid_amt'].mean():,.2f}")
    print(f"    Telehealth lines        : {(orig_df['place_of_service_cd']=='02').sum():,} ({(orig_df['place_of_service_cd']=='02').mean()*100:.1f}%)")

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
    print("generate_cclf5_part_b_claims.py")
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
    proc_ref_df = pd.read_parquet(cfg.paths.procedure_ref)
    print(f"    Loaded {len(bene_df):,} beneficiaries, {len(provider_df):,} providers, {len(proc_ref_df):,} procedures.")

    partb_cfg = get_raw_section(cfg, "part_b_claims")

    df = generate_cclf5(cfg, partb_cfg, bene_df, provider_df, proc_ref_df, rng)
    save_table(df, cfg.paths.cclf5, cfg.global_settings.output_format)

    # -----------------------------------------------------------------------
    # Validation
    # -----------------------------------------------------------------------
    print()
    print("Validation checks:")

    assert df["bene_mbi_id"].isin(bene_df["bene_mbi_id"]).all(),        "FAIL: Unknown beneficiary IDs"
    assert df["provider_id"].isin(provider_df["provider_id"]).all(),     "FAIL: Unknown provider IDs"
    assert df["clm_line_hcpcs_cd"].isin(proc_ref_df["hcpcs_cd"]).all(), "FAIL: Unknown HCPCS codes"
    assert df["clm_line_num"].ge(1).all(),                               "FAIL: Line numbers below 1"
    assert (df["clm_thru_dt"] >= df["clm_from_dt"]).all(),              "FAIL: thru_dt before from_dt"
    assert df["units_of_service"].ge(1).all(),                           "FAIL: Units below 1"
    assert df["dgns_prcdr_icd_ind"].eq("0").all(),                       "FAIL: Non ICD-10 indicator"
    assert df["service_category"].notna().all(),                         "FAIL: Null service categories"

    # Denied lines have zero payment
    denied = df[df["clm_carr_pmt_dnl_cd"].notna() & (df["clm_adjsmt_type_cd"] == "0")]
    assert denied["line_paid_amt"].eq(0.0).all(),                        "FAIL: Denied lines with non-zero paid amt"

    # Allowed >= paid for original paid lines
    orig_paid = df[(df["clm_adjsmt_type_cd"] == "0") & (df["line_paid_amt"] > 0)]
    assert (orig_paid["line_allowed_amt"] >= orig_paid["line_paid_amt"]).all(), \
        "FAIL: Paid amount exceeds allowed amount"

    # Adj/cancel records have orig claim ID
    adj_cancel = df[df["clm_adjsmt_type_cd"].isin(["1", "2"])]
    if len(adj_cancel) > 0:
        assert adj_cancel["clm_orig_clm_id"].notna().all(),              "FAIL: Adj/cancel missing orig_clm_id"

    # Overpayment amount 0 when flag False
    no_op = df[~df["overpayment_flag"]]
    assert no_op["overpayment_amt"].eq(0.0).all(),                       "FAIL: Non-OP lines with non-zero OP amt"

    print("  cclf5_part_b_claims: all checks passed.")
    print()
    print("Part B claims generation complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
    