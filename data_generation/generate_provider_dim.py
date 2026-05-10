"""
data_generation/generate_provider_dim.py

Generates the provider dimension table (provider_dim).

Dependencies:
    - config.yaml (via config_loader)
    - No other generated tables required

Usage:
    python data_generation/generate_provider_dim.py

Output (prototype mode):
    outputs/generated/prototype/provider_dim.parquet

Output (full mode):
    outputs/generated/full/provider_dim.parquet
"""

import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

import random
import uuid
import numpy as np
import pandas as pd
from faker import Faker

from src.utils.config_loader import load_config, get_output_dir, get_raw_section, summarize_config

fake = Faker()
Faker.seed(42)


# ---------------------------------------------------------------------------
# Provider name generation helpers
# ---------------------------------------------------------------------------

HOSPITAL_SUFFIXES = [
    "Medical Center", "Regional Hospital", "Community Hospital",
    "General Hospital", "Memorial Hospital", "Health System",
]

PHYSICIAN_SUFFIXES = [
    "MD", "DO", "MD PhD",
]

FACILITY_SUFFIXES = {
    "SNF":               ["Skilled Nursing Facility", "Rehabilitation Center", "Care Center"],
    "HHA":               ["Home Health Services", "Home Care Agency", "Home Health"],
    "Hospice":           ["Hospice Care", "Palliative Care Center", "Hospice Services"],
    "Outpatient_Facility":["Outpatient Center", "Ambulatory Care Center", "Specialty Clinic"],
}

CITY_NAMES_BY_REGION = {
    "Northeast":  ["Boston", "New York", "Philadelphia", "Hartford", "Providence", "Albany", "Newark"],
    "Southeast":  ["Atlanta", "Miami", "Charlotte", "Nashville", "Tampa", "Richmond", "Raleigh"],
    "Midwest":    ["Chicago", "Columbus", "Detroit", "Indianapolis", "Milwaukee", "Minneapolis", "Kansas City"],
    "Southwest":  ["Dallas", "Houston", "Phoenix", "San Antonio", "Albuquerque", "Tulsa", "New Orleans"],
    "West":       ["Los Angeles", "Seattle", "Portland", "Denver", "Las Vegas", "Salt Lake City", "Sacramento"],
}


def make_provider_name(provider_type: str, specialty: str | None, rng: np.random.Generator) -> str:
    if provider_type == "Hospital":
        city = fake.last_name()
        suffix = HOSPITAL_SUFFIXES[int(rng.integers(len(HOSPITAL_SUFFIXES)))]
        return f"{city} {suffix}"
    elif provider_type == "Physician":
        first = fake.first_name()
        last = fake.last_name()
        suffix = PHYSICIAN_SUFFIXES[int(rng.integers(len(PHYSICIAN_SUFFIXES)))]
        spec = specialty.replace("_", " ") if specialty else "Medicine"
        return f"Dr. {first} {last}, {suffix} — {spec}"
    else:
        suffixes = FACILITY_SUFFIXES.get(provider_type, ["Health Services"])
        city = fake.last_name()
        suffix = suffixes[int(rng.integers(len(suffixes)))]
        return f"{city} {suffix}"


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

def generate_provider_dim(cfg, prov_cfg: dict, rng: np.random.Generator) -> pd.DataFrame:
    """Generate provider_dim table."""
    print("  Generating provider_dim...")

    num_providers = cfg.scale.num_providers

    # --- Build peer group pool with resolved weights ---
    peer_groups = prov_cfg["peer_groups"]
    peer_names   = [pg["name"] for pg in peer_groups]
    peer_weights = [pg["weight"] for pg in peer_groups]
    total_weight = sum(peer_weights)
    peer_probs   = [w / total_weight for w in peer_weights]

    # Map peer group → provider_type and specialty
    peer_meta = {pg["name"]: pg for pg in peer_groups}

    # --- Build risk profile pool ---
    risk_dist   = prov_cfg["risk_profile_distribution"]
    risk_labels = list(risk_dist.keys())
    risk_probs  = list(risk_dist.values())

    # --- Ownership pool ---
    own_dist   = prov_cfg["ownership_distribution"]
    own_labels = list(own_dist.keys())
    own_probs  = list(own_dist.values())

    # --- Urban/rural pool ---
    ur_dist   = prov_cfg["urban_rural_distribution"]
    ur_labels = list(ur_dist.keys())
    ur_probs  = list(ur_dist.values())

    # --- Region/state pool ---
    bene_cfg  = cfg.raw["beneficiary"]
    regions   = bene_cfg["regions"]
    reg_names = list(regions.keys())
    reg_weights = [regions[r]["weight"] for r in reg_names]
    reg_total   = sum(reg_weights)
    reg_probs   = [w / reg_total for w in reg_weights]

    # --- Bed size ranges ---
    bed_ranges = prov_cfg.get("bed_size", {})

    # --- Assign peer groups ensuring Suspicious/Outlier profiles
    #     are concentrated but spread across peer groups ---
    peer_assignments = rng.choice(
        peer_names,
        size=num_providers,
        p=peer_probs,
    )

    # Force at least 1 Suspicious and 1 Outlier provider in prototype
    # (in full mode the distribution handles this naturally)
    risk_assignments = rng.choice(
        risk_labels,
        size=num_providers,
        p=risk_probs,
    )
    if cfg.active_mode == "prototype":
        if "Suspicious" not in risk_assignments:
            risk_assignments[rng.integers(num_providers)] = "Suspicious"
        if "Outlier" not in risk_assignments:
            risk_assignments[rng.integers(num_providers)] = "Outlier"

    records = []
    for i in range(num_providers):
        provider_id = f"PRV{str(i+1).zfill(6)}"

        peer_group   = peer_assignments[i]
        meta         = peer_meta[peer_group]
        provider_type = meta["provider_type"]
        specialty     = meta.get("specialty")   # None for facility types

        risk_profile = risk_assignments[i]

        # Region and state
        region = str(rng.choice(reg_names, p=reg_probs))
        state_pool = regions[region]["states"]
        state = str(rng.choice(state_pool))

        # Ownership — government skews toward hospitals
        if provider_type == "Hospital":
            own_labels_adj = own_labels
            own_probs_adj  = [0.40, 0.35, 0.25]
        else:
            own_labels_adj = own_labels
            own_probs_adj  = own_probs
        ownership = str(rng.choice(own_labels_adj, p=own_probs_adj))

        # Urban/rural — emerging providers skew rural
        if risk_profile == "Emerging":
            ur_probs_adj = [0.25, 0.35, 0.40]
        else:
            ur_probs_adj = ur_probs
        urban_rural = str(rng.choice(ur_labels, p=ur_probs_adj))

        # Bed size — hospitals and SNFs only
        bed_size = None
        if provider_type == "Hospital":
            peer_bed_key = (
                "Large_Inpatient_Hospital"
                if "Large" in peer_group
                else "Small_Community_Hospital"
            )
            lo, hi = bed_ranges.get(peer_bed_key, [10, 100])
            bed_size = int(rng.integers(lo, hi + 1))
        elif provider_type == "SNF":
            lo, hi = bed_ranges.get("SNF_Facility", [30, 200])
            bed_size = int(rng.integers(lo, hi + 1))

        # Years active — Emerging providers are newer
        yr_min, yr_max = prov_cfg["years_active_range"]
        if risk_profile == "Emerging":
            years_active = int(rng.integers(1, 4))
        elif risk_profile == "Outlier":
            years_active = int(rng.integers(yr_min, yr_max + 1))
        else:
            years_active = int(rng.integers(3, yr_max + 1))

        # Active flag — inactive providers are rare
        active_flag = bool(rng.random() > 0.02)

        # Provider name
        provider_name = make_provider_name(provider_type, specialty, rng)

        records.append({
            "provider_id":          provider_id,
            "provider_name":        provider_name,
            "provider_type":        provider_type,
            "specialty":            specialty,
            "region":               region,
            "state":                state,
            "peer_group":           peer_group,
            "provider_risk_profile": risk_profile,
            "ownership_type":       ownership,
            "bed_size":             bed_size,
            "years_active":         years_active,
            "urban_rural_flag":     urban_rural,
            "active_flag":          active_flag,
        })

    df = pd.DataFrame(records)

    # --- Summary stats ---
    print(f"    Generated {len(df):,} providers.")
    print(f"    Provider types  : {df['provider_type'].value_counts().to_dict()}")
    print(f"    Risk profiles   : {df['provider_risk_profile'].value_counts().to_dict()}")
    print(f"    Ownership types : {df['ownership_type'].value_counts().to_dict()}")
    print(f"    Urban/rural     : {df['urban_rural_flag'].value_counts().to_dict()}")

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
    print("generate_provider_dim.py")
    print("=" * 60)

    cfg = load_config()
    summarize_config(cfg)

    rng = np.random.default_rng(cfg.global_settings.random_seed)
    random.seed(cfg.global_settings.random_seed)

    prov_cfg = get_raw_section(cfg, "provider_dim")
    get_output_dir(cfg)

    df = generate_provider_dim(cfg, prov_cfg, rng)
    save_table(df, cfg.paths.provider_dim, cfg.global_settings.output_format)

    # --- Validation ---
    print()
    print("Validation checks:")
    assert df["provider_id"].is_unique,                         "FAIL: Duplicate provider IDs"
    assert df["provider_name"].notna().all(),                   "FAIL: Null provider names"
    assert df["provider_type"].notna().all(),                   "FAIL: Null provider types"
    assert df["peer_group"].notna().all(),                      "FAIL: Null peer groups"
    assert df["provider_risk_profile"].notna().all(),           "FAIL: Null risk profiles"

    # Specialty null only for facility types
    facility_types = {"Hospital", "SNF", "HHA", "Hospice", "Outpatient_Facility"}
    physician_rows = df[df["provider_type"] == "Physician"]
    assert physician_rows["specialty"].notna().all(),           "FAIL: Physician rows with null specialty"

    # Bed size null only for non-facility types
    bed_rows = df[df["provider_type"].isin(["Hospital", "SNF"])]
    assert bed_rows["bed_size"].notna().all(),                  "FAIL: Hospital/SNF rows with null bed_size"
    non_bed_rows = df[~df["provider_type"].isin(["Hospital", "SNF"])]
    assert non_bed_rows["bed_size"].isna().all(),               "FAIL: Non-facility rows with non-null bed_size"

    # Suspicious and Outlier providers must exist
    risk_profiles_present = set(df["provider_risk_profile"].unique())
    assert "Suspicious" in risk_profiles_present,               "FAIL: No Suspicious providers generated"
    assert "Outlier" in risk_profiles_present,                  "FAIL: No Outlier providers generated"

    print("  provider_dim: all checks passed.")
    print()
    print("Provider dimension generation complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
    