"""
data_generation/generate_cclf4_diagnoses.py

Generates the Part A diagnosis codes table (CCLF4).

Memory-optimized: writes records in chunks to avoid large in-memory
accumulation at full scale (~2M+ rows).

Dependencies:
    - config.yaml (via config_loader)
    - outputs/generated/{mode}/cclf1_part_a_claims.parquet
    - outputs/generated/{mode}/cclf8_beneficiary.parquet
    - outputs/generated/{mode}/diagnosis_ref.parquet

Usage:
    python data_generation/generate_cclf4_diagnoses.py
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
import pyarrow as pa
import pyarrow.parquet as pq

from src.utils.config_loader import load_config, get_output_dir, get_raw_section, summarize_config

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

POA_WEIGHTS = {"Y": 0.75, "N": 0.15, "U": 0.07, "W": 0.03}
CHUNK_SIZE  = 50_000   # Write to parquet every N diagnosis rows


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_num_diagnoses(clm_type, is_ma, is_high_risk, dx_cfg, mode_key, rng):
    lo = dx_cfg["diagnoses_per_claim"][mode_key]["min"]
    hi = dx_cfg["diagnoses_per_claim"][mode_key]["max"]
    base = int(rng.integers(lo, hi + 1))
    if clm_type in ("60", "20"):
        base = min(base + int(rng.integers(1, 3)), hi)
    if is_ma:
        boost_lo, boost_hi = dx_cfg["ma_extra_diagnosis_boost"]
        base = min(base + int(rng.integers(boost_lo, boost_hi + 1)), hi)
    if is_high_risk:
        boost_lo, boost_hi = dx_cfg["high_risk_extra_diagnosis_boost"]
        base = min(base + int(rng.integers(boost_lo, boost_hi + 1)), hi)
    return max(lo, base)


def sample_poa(clm_type, rng):
    if clm_type != "60":
        return None
    labels = list(POA_WEIGHTS.keys())
    probs  = list(POA_WEIGHTS.values())
    return str(rng.choice(labels, p=probs))


def assign_prod_type(seq_num, clm_type):
    if seq_num == 1:
        return "Principal"
    if seq_num == 2 and clm_type == "60":
        return "Admitting"
    return "Secondary"


# ---------------------------------------------------------------------------
# Chunked writer
# ---------------------------------------------------------------------------

# Explicit schema for CCLF4 — prevents null-type mismatch across chunks
CCLF4_SCHEMA = pa.schema([
    pa.field("cur_clm_uniq_id",               pa.string()),
    pa.field("bene_mbi_id",                    pa.string()),
    pa.field("clm_dgns_cd",                    pa.string()),
    pa.field("clm_val_sqnc_num",               pa.int64()),
    pa.field("clm_prod_type_cd",               pa.string()),
    pa.field("clm_from_dt",                    pa.date32()),
    pa.field("clm_thru_dt",                    pa.date32()),
    pa.field("clm_poa_ind",                    pa.string()),
    pa.field("dgns_prcdr_icd_ind",             pa.string()),
    pa.field("hcc_category",                   pa.string()),
    pa.field("hcc_weight",                     pa.float64()),
    pa.field("chronic_condition_flag",         pa.bool_()),
    pa.field("high_value_hcc_flag",            pa.bool_()),
    pa.field("suspected_unsupported_dx_flag",  pa.bool_()),
])


class ParquetChunkWriter:
    """Writes DataFrame rows to a parquet file in chunks to keep memory flat."""

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

def generate_cclf4(cfg, dx_cfg, claims_df, bene_df, dx_ref_df, rng):
    print("  Generating CCLF4 diagnoses (chunked write mode)...")

    mode_key    = cfg.active_mode
    inj_cfg     = cfg.injection
    output_path = cfg.paths.cclf4

    bene_lookup = bene_df.set_index("bene_mbi_id")[
        ["ma_plan_flag", "high_risk_patient_flag", "risk_score"]
    ].to_dict("index")

    orig_claims = claims_df[claims_df["clm_adjsmt_type_cd"] == "0"].copy()

    hcc_dx           = dx_ref_df[dx_ref_df["hcc_category"].notna()].copy()
    non_hcc_dx       = dx_ref_df[dx_ref_df["hcc_category"].isna()].copy()
    unsupported_rate = dx_cfg.get("unsupported_dx_rate", 0.04)

    writer  = ParquetChunkWriter(output_path, CCLF4_SCHEMA)
    chunk   = []
    n_total = len(orig_claims)

    for idx, (_, claim) in enumerate(orig_claims.iterrows()):
        clm_id   = claim["cur_clm_uniq_id"]
        bene_id  = claim["bene_mbi_id"]
        clm_type = claim["clm_type_cd"]
        from_dt  = claim["clm_from_dt"]
        thru_dt  = claim["clm_thru_dt"]

        bene_info    = bene_lookup.get(bene_id, {})
        is_ma        = bool(bene_info.get("ma_plan_flag", False))
        is_high_risk = bool(bene_info.get("high_risk_patient_flag", False))

        n_dx = get_num_diagnoses(clm_type, is_ma, is_high_risk, dx_cfg, mode_key, rng)

        if is_ma and len(hcc_dx) > 0:
            hcc_weight = 0.65
        elif is_high_risk:
            hcc_weight = 0.55
        else:
            hcc_weight = 0.40

        selected_dx = []
        if is_ma and len(hcc_dx) > 0:
            anchor = hcc_dx.iloc[int(rng.integers(len(hcc_dx)))]
            selected_dx.append(anchor)

        while len(selected_dx) < n_dx:
            use_hcc   = rng.random() < hcc_weight
            pool      = hcc_dx if (use_hcc and len(hcc_dx) > 0) else non_hcc_dx
            if len(pool) == 0:
                pool = dx_ref_df
            candidate = pool.iloc[int(rng.integers(len(pool)))]
            if candidate["icd10_cd"] not in [d["icd10_cd"] for d in selected_dx]:
                selected_dx.append(candidate)

        for seq_num, dx_row in enumerate(selected_dx, start=1):
            icd10_cd       = dx_row["icd10_cd"]
            hcc_cat        = dx_row["hcc_category"]
            hcc_weight_val = dx_row["hcc_weight"]
            is_chronic     = bool(dx_row["chronic_flag"])
            is_high_val    = bool(dx_row["high_value_hcc_flag"])

            prod_type = assign_prod_type(seq_num, clm_type)
            poa_ind   = sample_poa(clm_type, rng)

            unsupported = (
                is_high_val and is_ma
                and inj_cfg.inject_suspicious_patterns
                and rng.random() < unsupported_rate
            )

            if inj_cfg.inject_temporal_drift:
                year = from_dt.year if isinstance(from_dt, date) else pd.Timestamp(from_dt).year
                drift_boost = (year - 2021) * cfg.raw["injection"]["coding_intensity_annual_increase"]
                if not is_chronic and rng.random() < drift_boost:
                    is_chronic = True

            chunk.append({
                "cur_clm_uniq_id":               clm_id,
                "bene_mbi_id":                   bene_id,
                "clm_dgns_cd":                   icd10_cd,
                "clm_val_sqnc_num":              seq_num,
                "clm_prod_type_cd":              prod_type,
                "clm_from_dt":                   from_dt,
                "clm_thru_dt":                   thru_dt,
                "clm_poa_ind":                   poa_ind,
                "dgns_prcdr_icd_ind":            "0",
                "hcc_category":                  hcc_cat if pd.notna(hcc_cat) else None,
                "hcc_weight":                    float(hcc_weight_val) if pd.notna(hcc_weight_val) else None,
                "chronic_condition_flag":        is_chronic,
                "high_value_hcc_flag":           is_high_val,
                "suspected_unsupported_dx_flag": unsupported,
            })

            if len(chunk) >= CHUNK_SIZE:
                writer.write_chunk(chunk)
                chunk = []

        if (idx + 1) % 10_000 == 0 or (idx + 1) == n_total:
            pct = (idx + 1) / n_total * 100
            print(f"    Progress: {idx+1:,}/{n_total:,} claims ({pct:.1f}%) — "
                  f"{writer.total + len(chunk):,} diagnosis rows written")

    if chunk:
        writer.write_chunk(chunk)

    total_rows = writer.close()
    print(f"    Total diagnosis rows: {total_rows:,}")
    return total_rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("\n" + "=" * 60)
    print("generate_cclf4_diagnoses.py")
    print("=" * 60)

    cfg = load_config()
    summarize_config(cfg)

    rng = np.random.default_rng(cfg.global_settings.random_seed)
    random.seed(cfg.global_settings.random_seed)

    get_output_dir(cfg)

    print("  Loading dependencies...")
    claims_df = pd.read_parquet(cfg.paths.cclf1)
    bene_df   = pd.read_parquet(cfg.paths.cclf8)
    dx_ref_df = pd.read_parquet(cfg.paths.diagnosis_ref)
    print(f"    Loaded {len(claims_df):,} claims, {len(bene_df):,} beneficiaries, "
          f"{len(dx_ref_df):,} diagnosis codes.")

    dx_cfg = get_raw_section(cfg, "diagnoses")

    total_rows = generate_cclf4(cfg, dx_cfg, claims_df, bene_df, dx_ref_df, rng)

    print(f"\n    Saved -> {cfg.paths.cclf4}  ({total_rows:,} rows)")

    print()
    print("Validation checks (reading back from parquet)...")
    df = pd.read_parquet(cfg.paths.cclf4)

    orig_claim_ids = set(
        claims_df[claims_df["clm_adjsmt_type_cd"] == "0"]["cur_clm_uniq_id"]
    )
    assert set(df["cur_clm_uniq_id"]).issubset(orig_claim_ids), \
        "FAIL: Diagnosis rows referencing non-original claims"
    assert df["clm_dgns_cd"].notna().all(),        "FAIL: Null diagnosis codes"
    assert df["clm_val_sqnc_num"].ge(1).all(),      "FAIL: Sequence numbers below 1"
    assert df["dgns_prcdr_icd_ind"].eq("0").all(),  "FAIL: Non ICD-10 indicator"
    assert df["clm_prod_type_cd"].notna().all(),     "FAIL: Null prod type codes"

    hcc_rows     = df[df["hcc_category"].notna()]
    non_hcc_rows = df[df["hcc_category"].isna()]
    assert hcc_rows["hcc_weight"].notna().all(),    "FAIL: HCC-mapped rows missing hcc_weight"
    assert non_hcc_rows["hcc_weight"].isna().all(), "FAIL: Non-HCC rows with hcc_weight"

    inpatient_ids = set(
        claims_df[(claims_df["clm_type_cd"] == "60") &
                  (claims_df["clm_adjsmt_type_cd"] == "0")]["cur_clm_uniq_id"]
    )
    non_inpatient_dx = df[~df["cur_clm_uniq_id"].isin(inpatient_ids)]
    assert non_inpatient_dx["clm_poa_ind"].isna().all(), \
        "FAIL: Non-inpatient claims have POA indicator"

    avg_dx       = len(df) / max(1, len(orig_claim_ids))
    hcc_pct      = df["hcc_category"].notna().mean() * 100
    unsupported  = df["suspected_unsupported_dx_flag"].sum()

    print(f"  cclf4_diagnoses: all checks passed.")
    print(f"  Avg diagnoses/claim  : {avg_dx:.1f}")
    print(f"  HCC-mapped rows      : {hcc_pct:.1f}%")
    print(f"  Unsupported dx flags : {unsupported:,}")
    print()
    print("Diagnosis generation complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
    