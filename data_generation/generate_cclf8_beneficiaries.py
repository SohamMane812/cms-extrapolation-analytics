"""
data_generation/generate_cclf8_beneficiaries.py

Generates the beneficiary demographics table (CCLF8).

Dependencies:
    - config.yaml (via config_loader)
    - No other generated tables required

Usage:
    python data_generation/generate_cclf8_beneficiaries.py

Output (prototype mode):
    outputs/generated/prototype/cclf8_beneficiary.parquet

Output (full mode):
    outputs/generated/full/cclf8_beneficiary.parquet
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
from faker import Faker

from src.utils.config_loader import load_config, get_output_dir, get_raw_section, summarize_config

fake = Faker()
Faker.seed(42)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sample_from_dist(labels: list, probs: list, rng: np.random.Generator, n: int) -> np.ndarray:
    """Sample n values from a labeled distribution."""
    return rng.choice(labels, size=n, p=probs)


def compute_age_from_dob(dob: date, reference_date: date) -> int:
    """Compute age in whole years at reference_date."""
    age = reference_date.year - dob.year
    if (reference_date.month, reference_date.day) < (dob.month, dob.day):
        age -= 1
    return max(0, age)


def generate_date_in_range(
    start: date,
    end: date,
    rng: np.random.Generator,
) -> date:
    """Generate a random date between start and end inclusive."""
    delta = (end - start).days
    return start + timedelta(days=int(rng.integers(0, delta + 1)))


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

def generate_cclf8(cfg, bene_cfg: dict, rng: np.random.Generator) -> pd.DataFrame:
    """Generate CCLF8 beneficiary demographics table."""
    print("  Generating CCLF8 beneficiaries...")

    n = cfg.scale.num_beneficiaries
    reference_date = date.fromisoformat(cfg.global_settings.reference_date)
    data_start     = date.fromisoformat(cfg.global_settings.date_start)
    data_end       = date.fromisoformat(cfg.global_settings.date_end)

    # -----------------------------------------------------------------------
    # IDs
    # -----------------------------------------------------------------------
    bene_ids = [f"MBI{str(i+1).zfill(9)}" for i in range(n)]

    # -----------------------------------------------------------------------
    # Age and DOB
    # -----------------------------------------------------------------------
    age_cfg = bene_cfg["age_distribution"]
    raw_ages = rng.normal(loc=age_cfg["mean"], scale=age_cfg["std"], size=n)
    ages = np.clip(raw_ages, age_cfg["min"], age_cfg["max"]).astype(int)

    # Derive DOB from age at reference_date
    dobs = []
    for age in ages:
        birth_year  = reference_date.year - age
        birth_month = int(rng.integers(1, 13))
        birth_day   = int(rng.integers(1, 29))   # Cap at 28 to avoid month-end issues
        dobs.append(date(birth_year, birth_month, birth_day))

    # -----------------------------------------------------------------------
    # Sex
    # -----------------------------------------------------------------------
    sex_cfg   = bene_cfg["sex_distribution"]
    sex_codes = sample_from_dist(["1", "2"], [sex_cfg["male"], sex_cfg["female"]], rng, n)

    # -----------------------------------------------------------------------
    # Race
    # -----------------------------------------------------------------------
    race_cfg    = bene_cfg["race_distribution"]
    race_labels = list(race_cfg.keys())
    race_probs  = [race_cfg[k] for k in race_labels]
    race_codes  = sample_from_dist(race_labels, race_probs, rng, n)

    # Apply intentional missingness
    missing_race_mask = rng.random(n) < bene_cfg["missing_race_rate"]
    race_codes = np.where(missing_race_mask, None, race_codes)

    # -----------------------------------------------------------------------
    # Medicare status and entitlement
    # -----------------------------------------------------------------------
    mdcr_cfg    = bene_cfg["medicare_status_distribution"]
    mdcr_labels = list(mdcr_cfg.keys())
    mdcr_probs  = [mdcr_cfg[k] for k in mdcr_labels]
    mdcr_status = sample_from_dist(mdcr_labels, mdcr_probs, rng, n)

    # Original entitlement reason derived from medicare status
    entlmt_reason = np.where(
        np.isin(mdcr_status, ["AGED", "AGED_ESRD"]), "0",
        np.where(np.isin(mdcr_status, ["DISABLED"]), "1", "2")
    )

    # Part A/B enrollment indicator
    # ~5% Part A only (no Part B)
    part_a_only_mask = rng.random(n) < 0.05
    entlmt_buyin = np.where(part_a_only_mask, "1", "3")

    # Enrollment start dates
    part_a_start_dates = []
    part_b_start_dates = []
    for i in range(n):
        # Part A starts 0–15 years before data start
        offset_days = int(rng.integers(0, 365 * 15))
        pa_start = data_start - timedelta(days=offset_days)
        part_a_start_dates.append(pa_start)

        if entlmt_buyin[i] == "3":
            # Part B starts same day or up to 6 months after Part A
            pb_offset = int(rng.integers(0, 180))
            part_b_start_dates.append(pa_start + timedelta(days=pb_offset))
        else:
            part_b_start_dates.append(None)

    # -----------------------------------------------------------------------
    # Dual eligibility
    # -----------------------------------------------------------------------
    dual_rate = bene_cfg["dual_eligibility_rate"]
    dual_full_rate = bene_cfg["dual_full_rate"]
    is_dual = rng.random(n) < dual_rate
    dual_status = np.where(
        ~is_dual, None,
        np.where(rng.random(n) < dual_full_rate, "02", "04")
    )

    # -----------------------------------------------------------------------
    # Death dates (small fraction)
    # -----------------------------------------------------------------------
    death_rate = bene_cfg["death_rate"]
    is_deceased = rng.random(n) < death_rate
    death_dates = []
    for i in range(n):
        if is_deceased[i]:
            death_dates.append(generate_date_in_range(data_start, data_end, rng))
        else:
            death_dates.append(None)

    # -----------------------------------------------------------------------
    # Region and state
    # -----------------------------------------------------------------------
    region_cfg    = bene_cfg["regions"]
    region_names  = list(region_cfg.keys())
    region_weights = [region_cfg[r]["weight"] for r in region_names]
    region_total   = sum(region_weights)
    region_probs   = [w / region_total for w in region_weights]

    regions = sample_from_dist(region_names, region_probs, rng, n)
    states  = []
    for region in regions:
        state_pool = region_cfg[region]["states"]
        states.append(str(rng.choice(state_pool)))

    # Counties — simple simulated names with intentional missingness
    county_names = [
        "Adams", "Baker", "Carroll", "Davidson", "Ellis",
        "Franklin", "Grant", "Harrison", "Irving", "Jefferson",
        "Kent", "Lawrence", "Madison", "Nelson", "Owen",
        "Parker", "Quinn", "Russell", "Sullivan", "Taylor",
        "Union", "Vernon", "Warren", "York", "Zane",
    ]
    counties = np.array([
        f"{str(rng.choice(county_names))} County" for _ in range(n)
    ])
    missing_county_mask = rng.random(n) < bene_cfg["missing_county_rate"]
    counties = np.where(missing_county_mask, None, counties)

    # -----------------------------------------------------------------------
    # MA plan flag
    # -----------------------------------------------------------------------
    ma_flag = rng.random(n) < bene_cfg["ma_plan_rate"]

    # -----------------------------------------------------------------------
    # Utilization segment
    # -----------------------------------------------------------------------
    util_cfg    = bene_cfg["utilization_distribution"]
    util_labels = list(util_cfg.keys())
    util_probs  = [util_cfg[k] for k in util_labels]
    util_segment = sample_from_dist(util_labels, util_probs, rng, n)

    # -----------------------------------------------------------------------
    # Chronic condition count
    # Correlated with utilization segment and MA flag
    # -----------------------------------------------------------------------
    chronic_counts = []
    for i in range(n):
        base = {
            "Low":    rng.integers(0, 3),
            "Medium": rng.integers(1, 5),
            "High":   rng.integers(3, 9),
        }.get(util_segment[i], 2)

        if ma_flag[i]:
            base = min(base + int(rng.integers(1, 3)), 12)

        chronic_counts.append(int(base))

    # -----------------------------------------------------------------------
    # Risk score
    # Correlated with chronic count and utilization but intentionally diverges.
    # MA-like patients get a coding intensity boost.
    # -----------------------------------------------------------------------
    risk_score_cfg = bene_cfg["risk_score"]
    risk_scores = []
    for i in range(n):
        base_lo, base_hi = risk_score_cfg["base_range"]
        base_score = float(rng.uniform(base_lo, base_hi))

        # Adjust for chronic burden
        chronic_boost = chronic_counts[i] * 0.07

        # High-risk multiplier
        if util_segment[i] == "High":
            hr_lo, hr_hi = risk_score_cfg["high_risk_multiplier"]
            hr_mult = float(rng.uniform(hr_lo, hr_hi))
            base_score *= hr_mult

        # MA coding intensity boost — diverges from true clinical burden
        if ma_flag[i]:
            ma_lo, ma_hi = risk_score_cfg["ma_coding_intensity_boost"]
            ma_boost = float(rng.uniform(ma_lo, ma_hi))
        else:
            ma_boost = 0.0

        # Random noise for additional divergence
        noise = float(rng.normal(0, risk_score_cfg["noise_std"]))

        raw_score = base_score + chronic_boost + ma_boost + noise
        risk_scores.append(round(max(0.1, raw_score), 4))

    # -----------------------------------------------------------------------
    # High-risk patient flag
    # Derived from risk score and utilization segment
    # -----------------------------------------------------------------------
    risk_arr    = np.array(risk_scores)
    risk_thresh = float(np.percentile(risk_arr, 85))
    high_risk   = (risk_arr >= risk_thresh) | (np.array(util_segment) == "High")

    # -----------------------------------------------------------------------
    # Low income subsidy
    # -----------------------------------------------------------------------
    lis_flag = rng.random(n) < bene_cfg["low_income_subsidy_rate"]

    # -----------------------------------------------------------------------
    # Annual cost bucket
    # Correlated with utilization segment
    # -----------------------------------------------------------------------
    cost_cfg    = bene_cfg["annual_cost_bucket_distribution"]
    cost_labels = list(cost_cfg.keys())

    # Adjust probabilities by utilization segment for realism
    cost_probs_map = {
        "Low":    [0.70, 0.25, 0.04, 0.01],
        "Medium": [0.35, 0.50, 0.13, 0.02],
        "High":   [0.05, 0.30, 0.50, 0.15],
    }
    annual_cost_buckets = []
    for i in range(n):
        seg_probs = cost_probs_map.get(util_segment[i], list(cost_cfg.values()))
        annual_cost_buckets.append(
            str(rng.choice(cost_labels, p=seg_probs))
        )

    # -----------------------------------------------------------------------
    # Assemble DataFrame
    # -----------------------------------------------------------------------
    df = pd.DataFrame({
        "bene_mbi_id":               bene_ids,
        "bene_dob":                  dobs,
        "bene_age":                  ages,
        "bene_sex_cd":               sex_codes,
        "bene_race_cd":              race_codes,
        "bene_mdcr_stus_cd":         mdcr_status,
        "bene_dual_stus_cd":         dual_status,
        "bene_death_dt":             death_dates,
        "bene_orgnl_entlmt_rsn_cd":  entlmt_reason,
        "bene_entlmt_buyin_ind":     entlmt_buyin,
        "bene_part_a_enrlmt_bgn_dt": part_a_start_dates,
        "bene_part_b_enrlmt_bgn_dt": part_b_start_dates,
        "region":                    regions,
        "state":                     states,
        "county":                    counties,
        "risk_score":                risk_scores,
        "chronic_condition_count":   chronic_counts,
        "ma_plan_flag":              ma_flag,
        "high_risk_patient_flag":    high_risk,
        "utilization_segment":       util_segment,
        "low_income_subsidy_flag":   lis_flag,
        "annual_cost_bucket":        annual_cost_buckets,
    })

    # -----------------------------------------------------------------------
    # Summary stats
    # -----------------------------------------------------------------------
    print(f"    Generated {len(df):,} beneficiaries.")
    print(f"    Age range        : {df['bene_age'].min()}–{df['bene_age'].max()}  |  mean {df['bene_age'].mean():.1f}")
    print(f"    Sex (M/F)        : {(df['bene_sex_cd']=='1').sum()} / {(df['bene_sex_cd']=='2').sum()}")
    print(f"    MA plan          : {df['ma_plan_flag'].sum()} ({df['ma_plan_flag'].mean()*100:.1f}%)")
    print(f"    High risk        : {df['high_risk_patient_flag'].sum()} ({df['high_risk_patient_flag'].mean()*100:.1f}%)")
    print(f"    Dual eligible    : {df['bene_dual_stus_cd'].notna().sum()} ({df['bene_dual_stus_cd'].notna().mean()*100:.1f}%)")
    print(f"    Deceased         : {df['bene_death_dt'].notna().sum()} ({df['bene_death_dt'].notna().mean()*100:.1f}%)")
    print(f"    Missing county   : {df['county'].isna().sum()} ({df['county'].isna().mean()*100:.1f}%)")
    print(f"    Missing race     : {df['bene_race_cd'].isna().sum()} ({df['bene_race_cd'].isna().mean()*100:.1f}%)")
    print(f"    Risk score range : {df['risk_score'].min():.3f}–{df['risk_score'].max():.3f}  |  mean {df['risk_score'].mean():.3f}")
    print(f"    Utilization      : {df['utilization_segment'].value_counts().to_dict()}")
    print(f"    Cost buckets     : {df['annual_cost_bucket'].value_counts().to_dict()}")

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
    print("generate_cclf8_beneficiaries.py")
    print("=" * 60)

    cfg = load_config()
    summarize_config(cfg)

    rng = np.random.default_rng(cfg.global_settings.random_seed)
    random.seed(cfg.global_settings.random_seed)

    bene_cfg = get_raw_section(cfg, "beneficiary")
    get_output_dir(cfg)

    df = generate_cclf8(cfg, bene_cfg, rng)
    save_table(df, cfg.paths.cclf8, cfg.global_settings.output_format)

    # -----------------------------------------------------------------------
    # Validation
    # -----------------------------------------------------------------------
    print()
    print("Validation checks:")

    assert df["bene_mbi_id"].is_unique,                             "FAIL: Duplicate MBI IDs"
    assert df["bene_dob"].notna().all(),                            "FAIL: Null DOBs"
    assert df["bene_age"].between(65, 95).all(),                    "FAIL: Ages out of range"
    assert df["bene_sex_cd"].isin(["1", "2"]).all(),                "FAIL: Invalid sex codes"
    assert df["bene_mdcr_stus_cd"].notna().all(),                   "FAIL: Null Medicare status"
    assert df["risk_score"].gt(0).all(),                            "FAIL: Non-positive risk scores"
    assert df["chronic_condition_count"].ge(0).all(),               "FAIL: Negative chronic counts"
    assert df["annual_cost_bucket"].notna().all(),                  "FAIL: Null cost buckets"
    assert df["utilization_segment"].isin(["Low","Medium","High"]).all(), "FAIL: Invalid utilization segments"

    # Part B enrollment date null only for Part A only beneficiaries
    part_a_only = df[df["bene_entlmt_buyin_ind"] == "1"]
    assert part_a_only["bene_part_b_enrlmt_bgn_dt"].isna().all(),   "FAIL: Part A only benes with Part B date"

    part_ab = df[df["bene_entlmt_buyin_ind"] == "3"]
    assert part_ab["bene_part_b_enrlmt_bgn_dt"].notna().all(),      "FAIL: Part A+B benes missing Part B date"

    # Missingness rates within expected bounds (±5%)
    county_missing_rate = df["county"].isna().mean()
    assert 0.0 <= county_missing_rate <= 0.10,                      f"FAIL: County missing rate {county_missing_rate:.2%} unexpected"

    race_missing_rate = df["bene_race_cd"].isna().mean()
    assert 0.0 <= race_missing_rate <= 0.08,                        f"FAIL: Race missing rate {race_missing_rate:.2%} unexpected"

    print("  cclf8_beneficiary: all checks passed.")
    print()
    print("Beneficiary generation complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
    