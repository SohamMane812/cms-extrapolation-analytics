"""
data_generation/generate_cclf4_diagnoses.py

Generates the Part A diagnosis codes table (CCLF4).

One row per diagnosis per institutional claim.
Each CCLF1 claim gets between 3 and 12 diagnosis rows depending
on patient complexity, MA status, and risk profile.

Dependencies:
    - config.yaml (via config_loader)
    - outputs/generated/{mode}/cclf1_part_a_claims.parquet
    - outputs/generated/{mode}/cclf8_beneficiary.parquet
    - outputs/generated/{mode}/diagnosis_ref.parquet

Usage:
    python data_generation/generate_cclf4_diagnoses.py

Output (prototype mode):
    outputs/generated/prototype/cclf4_diagnoses.parquet
"""

import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

import random
from datetime import date

import numpy as np
import pandas as pd

from src.utils.config_loader import load_config, get_output_dir, get_raw_section, summarize_config


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Diagnosis type sequence logic:
# Sequence 1 is always Principal
# Sequence 2 is Admitting (inpatient only) or Secondary
# Sequences 3+ are Secondary or External_Cause

PROD_TYPE_MAP = {
    1: "Principal",
    2: "Admitting",
}

POA_WEIGHTS = {
    "Y": 0.75,
    "N": 0.15,
    "U": 0.07,
    "W": 0.03,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_num_diagnoses(
    clm_type: str,
    is_ma: bool,
    is_high_risk: bool,
    dx_cfg: dict,
    mode_key: str,
    rng: np.random.Generator,
) -> int:
    """Determine how many diagnoses to assign to a claim."""
    lo = dx_cfg["diagnoses_per_claim"][mode_key]["min"]
    hi = dx_cfg["diagnoses_per_claim"][mode_key]["max"]

    base = int(rng.integers(lo, hi + 1))

    # Inpatient and SNF claims tend to have more diagnoses
    if clm_type in ("60", "20"):
        base = min(base + int(rng.integers(1, 3)), hi)

    # MA patients get extra diagnoses (coding intensity)
    if is_ma:
        boost_lo, boost_hi = dx_cfg["ma_extra_diagnosis_boost"]
        base = min(base + int(rng.integers(boost_lo, boost_hi + 1)), hi)

    # High-risk patients get extra diagnoses
    if is_high_risk:
        boost_lo, boost_hi = dx_cfg["high_risk_extra_diagnosis_boost"]
        base = min(base + int(rng.integers(boost_lo, boost_hi + 1)), hi)

    return max(lo, base)


def sample_poa(clm_type: str, rng: np.random.Generator) -> str | None:
    """Sample POA indicator. NULL for non-inpatient."""
    if clm_type != "60":
        return None
    labels = list(POA_WEIGHTS.keys())
    probs  = list(POA_WEIGHTS.values())
    return str(rng.choice(labels, p=probs))


def assign_prod_type(seq_num: int, clm_type: str) -> str:
    """Assign diagnosis product type based on sequence and claim type."""
    if seq_num == 1:
        return "Principal"
    if seq_num == 2 and clm_type == "60":
        return "Admitting"
    # ~5% chance of External_Cause for later sequences
    return "Secondary"


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

def generate_cclf4(
    cfg,
    dx_cfg: dict,
    claims_df: pd.DataFrame,
    bene_df: pd.DataFrame,
    dx_ref_df: pd.DataFrame,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """Generate CCLF4 diagnosis codes table."""
    print("  Generating CCLF4 diagnoses...")

    mode_key    = cfg.active_mode
    inj_cfg     = cfg.injection

    # Build patient lookup for MA and high-risk flags
    bene_lookup = bene_df.set_index("bene_mbi_id")[
        ["ma_plan_flag", "high_risk_patient_flag", "risk_score"]
    ].to_dict("index")

    # Only generate diagnoses for original claims (not adj/cancel)
    orig_claims = claims_df[claims_df["clm_adjsmt_type_cd"] == "0"].copy()

    # Split diagnosis pool by body system for realistic assignment
    # High-value HCC diagnoses are sampled more for MA patients
    hcc_dx     = dx_ref_df[dx_ref_df["hcc_category"].notna()].copy()
    non_hcc_dx = dx_ref_df[dx_ref_df["hcc_category"].isna()].copy()
    high_val_dx = dx_ref_df[dx_ref_df["high_value_hcc_flag"] == True].copy()

    # Unsupported diagnosis injection rate
    unsupported_rate = dx_cfg.get("unsupported_dx_rate", 0.04)

    records = []

    for _, claim in orig_claims.iterrows():
        clm_id   = claim["cur_clm_uniq_id"]
        bene_id  = claim["bene_mbi_id"]
        clm_type = claim["clm_type_cd"]
        from_dt  = claim["clm_from_dt"]
        thru_dt  = claim["clm_thru_dt"]

        bene_info   = bene_lookup.get(bene_id, {})
        is_ma       = bool(bene_info.get("ma_plan_flag", False))
        is_high_risk = bool(bene_info.get("high_risk_patient_flag", False))

        # Determine number of diagnoses for this claim
        n_dx = get_num_diagnoses(
            clm_type, is_ma, is_high_risk, dx_cfg, mode_key, rng
        )

        # Build diagnosis pool for this claim
        # MA patients draw more from high-value HCC pool
        if is_ma and len(high_val_dx) > 0:
            hcc_weight    = 0.65
            nonhcc_weight = 0.35
        elif is_high_risk:
            hcc_weight    = 0.55
            nonhcc_weight = 0.45
        else:
            hcc_weight    = 0.40
            nonhcc_weight = 0.60

        selected_dx = []

        # Always include at least one HCC diagnosis for MA patients
        if is_ma and len(hcc_dx) > 0:
            anchor = hcc_dx.iloc[int(rng.integers(len(hcc_dx)))]
            selected_dx.append(anchor)

        # Fill remaining diagnoses from weighted pool
        while len(selected_dx) < n_dx:
            use_hcc = rng.random() < hcc_weight
            pool    = hcc_dx if (use_hcc and len(hcc_dx) > 0) else non_hcc_dx
            if len(pool) == 0:
                pool = dx_ref_df
            candidate = pool.iloc[int(rng.integers(len(pool)))]

            # Avoid duplicates within the same claim
            if candidate["icd10_cd"] not in [d["icd10_cd"] for d in selected_dx]:
                selected_dx.append(candidate)

        # Generate diagnosis rows
        for seq_num, dx_row in enumerate(selected_dx, start=1):
            icd10_cd    = dx_row["icd10_cd"]
            hcc_cat     = dx_row["hcc_category"]
            hcc_weight_val = dx_row["hcc_weight"]
            is_chronic  = bool(dx_row["chronic_flag"])
            is_high_val = bool(dx_row["high_value_hcc_flag"])

            prod_type   = assign_prod_type(seq_num, clm_type)
            poa_ind     = sample_poa(clm_type, rng)

            # Unsupported diagnosis injection
            # High-value HCC diagnoses on MA patients are candidates
            if (
                is_high_val
                and is_ma
                and inj_cfg.inject_suspicious_patterns
                and rng.random() < unsupported_rate
            ):
                unsupported = True
            else:
                unsupported = False

            # Temporal drift — coding intensity grows each year
            # More diagnoses flagged as chronic over time
            if inj_cfg.inject_temporal_drift:
                year = from_dt.year if isinstance(from_dt, date) else pd.Timestamp(from_dt).year
                drift_boost = (year - 2021) * cfg.raw["injection"]["coding_intensity_annual_increase"]
                # Slightly increase probability of chronic flag over time
                if not is_chronic and rng.random() < drift_boost:
                    is_chronic = True

            records.append({
                "cur_clm_uniq_id":              clm_id,
                "bene_mbi_id":                  bene_id,
                "clm_dgns_cd":                  icd10_cd,
                "clm_val_sqnc_num":             seq_num,
                "clm_prod_type_cd":             prod_type,
                "clm_from_dt":                  from_dt,
                "clm_thru_dt":                  thru_dt,
                "clm_poa_ind":                  poa_ind,
                "dgns_prcdr_icd_ind":           "0",
                "hcc_category":                 hcc_cat if pd.notna(hcc_cat) else None,
                "hcc_weight":                   float(hcc_weight_val) if pd.notna(hcc_weight_val) else None,
                "chronic_condition_flag":       is_chronic,
                "high_value_hcc_flag":          is_high_val,
                "suspected_unsupported_dx_flag": unsupported,
            })

    df = pd.DataFrame(records)

    # -----------------------------------------------------------------------
    # Summary stats
    # -----------------------------------------------------------------------
    avg_dx_per_claim = len(df) / len(orig_claims)
    hcc_rows         = df["hcc_category"].notna().sum()
    chronic_rows     = df["chronic_condition_flag"].sum()
    unsupported_rows = df["suspected_unsupported_dx_flag"].sum()

    print(f"    Generated {len(df):,} diagnosis rows for {len(orig_claims):,} claims.")
    print(f"    Avg diagnoses/claim  : {avg_dx_per_claim:.1f}")
    print(f"    HCC-mapped rows      : {hcc_rows:,} ({hcc_rows/len(df)*100:.1f}%)")
    print(f"    Chronic condition    : {chronic_rows:,} ({chronic_rows/len(df)*100:.1f}%)")
    print(f"    Unsupported dx flags : {unsupported_rows:,} ({unsupported_rows/len(df)*100:.1f}%)")
    print(f"    Unique ICD-10 codes  : {df['clm_dgns_cd'].nunique():,}")
    print(f"    POA dist (inpatient) : {df[df['clm_poa_ind'].notna()]['clm_poa_ind'].value_counts().to_dict()}")

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
    print("generate_cclf4_diagnoses.py")
    print("=" * 60)

    cfg = load_config()
    summarize_config(cfg)

    rng = np.random.default_rng(cfg.global_settings.random_seed)
    random.seed(cfg.global_settings.random_seed)

    get_output_dir(cfg)

    # Load dependencies
    print("  Loading dependencies...")
    claims_df = pd.read_parquet(cfg.paths.cclf1)
    bene_df   = pd.read_parquet(cfg.paths.cclf8)
    dx_ref_df = pd.read_parquet(cfg.paths.diagnosis_ref)
    print(f"    Loaded {len(claims_df):,} claims, {len(bene_df):,} beneficiaries, {len(dx_ref_df):,} diagnosis codes.")

    dx_cfg = get_raw_section(cfg, "diagnoses")

    df = generate_cclf4(cfg, dx_cfg, claims_df, bene_df, dx_ref_df, rng)
    save_table(df, cfg.paths.cclf4, cfg.global_settings.output_format)

    # -----------------------------------------------------------------------
    # Validation
    # -----------------------------------------------------------------------
    print()
    print("Validation checks:")

    orig_claim_ids = set(
        claims_df[claims_df["clm_adjsmt_type_cd"] == "0"]["cur_clm_uniq_id"]
    )
    assert set(df["cur_clm_uniq_id"]).issubset(orig_claim_ids), \
        "FAIL: Diagnosis rows referencing non-original claims"

    assert df["clm_dgns_cd"].notna().all(),             "FAIL: Null diagnosis codes"
    assert df["clm_val_sqnc_num"].ge(1).all(),          "FAIL: Sequence numbers below 1"
    assert df["dgns_prcdr_icd_ind"].eq("0").all(),      "FAIL: Non ICD-10 indicator found"
    assert df["clm_prod_type_cd"].notna().all(),         "FAIL: Null prod type codes"

    # Each claim must have at least one Principal diagnosis (seq 1)
    seq1 = df[df["clm_val_sqnc_num"] == 1]
    assert len(seq1) == len(orig_claim_ids.intersection(set(df["cur_clm_uniq_id"]))), \
        "FAIL: Some claims missing principal diagnosis (sequence 1)"

    # POA only for inpatient claims
    inpatient_claim_ids = set(
        claims_df[(claims_df["clm_type_cd"] == "60") & (claims_df["clm_adjsmt_type_cd"] == "0")]["cur_clm_uniq_id"]
    )
    non_inpatient_dx = df[~df["cur_clm_uniq_id"].isin(inpatient_claim_ids)]
    assert non_inpatient_dx["clm_poa_ind"].isna().all(), \
        "FAIL: Non-inpatient claims have POA indicator"

    # HCC weight null iff HCC category null
    hcc_rows     = df[df["hcc_category"].notna()]
    non_hcc_rows = df[df["hcc_category"].isna()]
    assert hcc_rows["hcc_weight"].notna().all(),    "FAIL: HCC-mapped rows missing hcc_weight"
    assert non_hcc_rows["hcc_weight"].isna().all(), "FAIL: Non-HCC rows with hcc_weight"

    # Unsupported flag only on HCC-mapped rows
    unsupported = df[df["suspected_unsupported_dx_flag"] == True]
    if len(unsupported) > 0:
        assert unsupported["hcc_category"].notna().all(), \
            "FAIL: Unsupported flag on non-HCC diagnosis"

    print("  cclf4_diagnoses: all checks passed.")
    print()
    print("Diagnosis generation complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
    