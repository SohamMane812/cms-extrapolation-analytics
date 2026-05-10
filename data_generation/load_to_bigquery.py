"""
data_generation/load_to_bigquery.py

Loads all generated parquet files into BigQuery raw_cms_claims dataset.

Behavior:
    - Uses Application Default Credentials (ADC)
    - Truncate-and-replace on every load (deterministic clean reloads)
    - Partitioned by clm_from_dt on CCLF1, CCLF4, CCLF5
    - Clustered as specified per table
    - Reference and dimension tables loaded without partitioning

Usage:
    # Load all tables
    python data_generation/load_to_bigquery.py

    # Load specific tables only
    python data_generation/load_to_bigquery.py --tables cclf1 cclf8 provider_dim

Dependencies:
    - config.yaml (via config_loader)
    - All parquet files must exist in outputs/generated/{mode}/
    - google-cloud-bigquery and db-dtypes must be installed
    - ADC must be configured: gcloud auth application-default login
"""

import sys
import argparse
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

import pandas as pd
from google.cloud import bigquery
from google.cloud.bigquery import SchemaField, TimePartitioning, TimePartitioningType

from src.utils.config_loader import load_config, get_raw_section, summarize_config


# ---------------------------------------------------------------------------
# BigQuery schema definitions
# Explicitly typed to avoid inference errors on nullable columns
# ---------------------------------------------------------------------------

SCHEMAS = {
    "raw_cclf1_claims_header": [
        SchemaField("cur_clm_uniq_id",       "STRING",    "REQUIRED"),
        SchemaField("bene_mbi_id",            "STRING",    "REQUIRED"),
        SchemaField("provider_id",            "STRING",    "REQUIRED"),
        SchemaField("clm_type_cd",            "STRING",    "REQUIRED"),
        SchemaField("clm_from_dt",            "DATE",      "REQUIRED"),
        SchemaField("clm_thru_dt",            "DATE",      "REQUIRED"),
        SchemaField("clm_mdcr_npmt_rsn_cd",   "STRING",    "NULLABLE"),
        SchemaField("clm_pmt_amt",            "FLOAT64",   "REQUIRED"),
        SchemaField("clm_adjsmt_type_cd",     "STRING",    "REQUIRED"),
        SchemaField("clm_orig_clm_id",        "STRING",    "NULLABLE"),
        SchemaField("dgns_prcdr_icd_ind",     "STRING",    "REQUIRED"),
        SchemaField("facility_type",          "STRING",    "REQUIRED"),
        SchemaField("claim_status",           "STRING",    "REQUIRED"),
        SchemaField("drg_cd",                 "STRING",    "NULLABLE"),
        SchemaField("length_of_stay",         "INT64",     "NULLABLE"),
        SchemaField("overpayment_flag",       "BOOL",      "REQUIRED"),
        SchemaField("overpayment_amt",        "FLOAT64",   "REQUIRED"),
        SchemaField("audit_eligible_flag",    "BOOL",      "REQUIRED"),
        SchemaField("true_error_flag",        "BOOL",      "REQUIRED"),
        SchemaField("created_at",             "TIMESTAMP", "REQUIRED"),
    ],

    "raw_cclf4_diagnosis": [
        SchemaField("cur_clm_uniq_id",              "STRING",  "REQUIRED"),
        SchemaField("bene_mbi_id",                  "STRING",  "REQUIRED"),
        SchemaField("clm_dgns_cd",                  "STRING",  "REQUIRED"),
        SchemaField("clm_val_sqnc_num",             "INT64",   "REQUIRED"),
        SchemaField("clm_prod_type_cd",             "STRING",  "REQUIRED"),
        SchemaField("clm_from_dt",                  "DATE",    "REQUIRED"),
        SchemaField("clm_thru_dt",                  "DATE",    "REQUIRED"),
        SchemaField("clm_poa_ind",                  "STRING",  "NULLABLE"),
        SchemaField("dgns_prcdr_icd_ind",           "STRING",  "REQUIRED"),
        SchemaField("hcc_category",                 "STRING",  "NULLABLE"),
        SchemaField("hcc_weight",                   "FLOAT64", "NULLABLE"),
        SchemaField("chronic_condition_flag",       "BOOL",    "REQUIRED"),
        SchemaField("high_value_hcc_flag",          "BOOL",    "REQUIRED"),
        SchemaField("suspected_unsupported_dx_flag","BOOL",    "REQUIRED"),
    ],

    "raw_cclf5_physician": [
        SchemaField("cur_clm_uniq_id",          "STRING",  "REQUIRED"),
        SchemaField("clm_line_num",             "INT64",   "REQUIRED"),
        SchemaField("bene_mbi_id",              "STRING",  "REQUIRED"),
        SchemaField("provider_id",              "STRING",  "REQUIRED"),
        SchemaField("clm_from_dt",              "DATE",    "REQUIRED"),
        SchemaField("clm_thru_dt",              "DATE",    "REQUIRED"),
        SchemaField("clm_line_from_dt",         "DATE",    "REQUIRED"),
        SchemaField("clm_line_dgns_cd",         "STRING",  "NULLABLE"),
        SchemaField("clm_dgns_1_cd",            "STRING",  "NULLABLE"),
        SchemaField("clm_dgns_2_cd",            "STRING",  "NULLABLE"),
        SchemaField("clm_dgns_3_cd",            "STRING",  "NULLABLE"),
        SchemaField("clm_dgns_4_cd",            "STRING",  "NULLABLE"),
        SchemaField("clm_line_hcpcs_cd",        "STRING",  "REQUIRED"),
        SchemaField("clm_carr_pmt_dnl_cd",      "STRING",  "NULLABLE"),
        SchemaField("clm_adjsmt_type_cd",       "STRING",  "REQUIRED"),
        SchemaField("clm_orig_clm_id",          "STRING",  "NULLABLE"),
        SchemaField("dgns_prcdr_icd_ind",       "STRING",  "REQUIRED"),
        SchemaField("line_allowed_amt",         "FLOAT64", "REQUIRED"),
        SchemaField("line_paid_amt",            "FLOAT64", "REQUIRED"),
        SchemaField("units_of_service",         "INT64",   "REQUIRED"),
        SchemaField("place_of_service_cd",      "STRING",  "REQUIRED"),
        SchemaField("modifier_1",               "STRING",  "NULLABLE"),
        SchemaField("modifier_2",               "STRING",  "NULLABLE"),
        SchemaField("service_category",         "STRING",  "REQUIRED"),
        SchemaField("overpayment_flag",         "BOOL",    "REQUIRED"),
        SchemaField("overpayment_amt",          "FLOAT64", "REQUIRED"),
        SchemaField("true_error_flag",          "BOOL",    "REQUIRED"),
        SchemaField("suspicious_pattern_flag",  "BOOL",    "REQUIRED"),
    ],

    "raw_cclf8_beneficiary": [
        SchemaField("bene_mbi_id",               "STRING",  "REQUIRED"),
        SchemaField("bene_dob",                  "DATE",    "REQUIRED"),
        SchemaField("bene_age",                  "INT64",   "REQUIRED"),
        SchemaField("bene_sex_cd",               "STRING",  "REQUIRED"),
        SchemaField("bene_race_cd",              "STRING",  "NULLABLE"),
        SchemaField("bene_mdcr_stus_cd",         "STRING",  "REQUIRED"),
        SchemaField("bene_dual_stus_cd",         "STRING",  "NULLABLE"),
        SchemaField("bene_death_dt",             "DATE",    "NULLABLE"),
        SchemaField("bene_orgnl_entlmt_rsn_cd",  "STRING",  "REQUIRED"),
        SchemaField("bene_entlmt_buyin_ind",     "STRING",  "REQUIRED"),
        SchemaField("bene_part_a_enrlmt_bgn_dt", "DATE",    "REQUIRED"),
        SchemaField("bene_part_b_enrlmt_bgn_dt", "DATE",    "NULLABLE"),
        SchemaField("region",                    "STRING",  "REQUIRED"),
        SchemaField("state",                     "STRING",  "REQUIRED"),
        SchemaField("county",                    "STRING",  "NULLABLE"),
        SchemaField("risk_score",                "FLOAT64", "REQUIRED"),
        SchemaField("chronic_condition_count",   "INT64",   "REQUIRED"),
        SchemaField("ma_plan_flag",              "BOOL",    "REQUIRED"),
        SchemaField("high_risk_patient_flag",    "BOOL",    "REQUIRED"),
        SchemaField("utilization_segment",       "STRING",  "REQUIRED"),
        SchemaField("low_income_subsidy_flag",   "BOOL",    "REQUIRED"),
        SchemaField("annual_cost_bucket",        "STRING",  "REQUIRED"),
    ],

    "raw_provider_dim": [
        SchemaField("provider_id",           "STRING",  "REQUIRED"),
        SchemaField("provider_name",         "STRING",  "REQUIRED"),
        SchemaField("provider_type",         "STRING",  "REQUIRED"),
        SchemaField("specialty",             "STRING",  "NULLABLE"),
        SchemaField("region",                "STRING",  "REQUIRED"),
        SchemaField("state",                 "STRING",  "REQUIRED"),
        SchemaField("peer_group",            "STRING",  "REQUIRED"),
        SchemaField("provider_risk_profile", "STRING",  "REQUIRED"),
        SchemaField("ownership_type",        "STRING",  "REQUIRED"),
        SchemaField("bed_size",              "INT64",   "NULLABLE"),
        SchemaField("years_active",          "INT64",   "REQUIRED"),
        SchemaField("urban_rural_flag",      "STRING",  "REQUIRED"),
        SchemaField("active_flag",           "BOOL",    "REQUIRED"),
    ],

    "raw_procedure_ref": [
        SchemaField("hcpcs_cd",               "STRING",  "REQUIRED"),
        SchemaField("procedure_desc",         "STRING",  "REQUIRED"),
        SchemaField("procedure_category",     "STRING",  "REQUIRED"),
        SchemaField("expected_allowed_amt",   "FLOAT64", "REQUIRED"),
        SchemaField("allowed_amt_std_dev",    "FLOAT64", "REQUIRED"),
        SchemaField("high_risk_billing_flag", "BOOL",    "REQUIRED"),
        SchemaField("typical_specialty",      "STRING",  "NULLABLE"),
        SchemaField("inpatient_only_flag",    "BOOL",    "REQUIRED"),
    ],

    "raw_diagnosis_ref": [
        SchemaField("icd10_cd",               "STRING",  "REQUIRED"),
        SchemaField("diagnosis_desc",         "STRING",  "REQUIRED"),
        SchemaField("hcc_category",           "STRING",  "NULLABLE"),
        SchemaField("hcc_weight",             "FLOAT64", "NULLABLE"),
        SchemaField("chronic_flag",           "BOOL",    "REQUIRED"),
        SchemaField("high_value_hcc_flag",    "BOOL",    "REQUIRED"),
        SchemaField("expected_care_pattern",  "STRING",  "NULLABLE"),
        SchemaField("body_system",            "STRING",  "REQUIRED"),
    ],
}

# ---------------------------------------------------------------------------
# Partitioning and clustering config per table
# ---------------------------------------------------------------------------

TABLE_CONFIG = {
    "raw_cclf1_claims_header": {
        "partition_field":  "clm_from_dt",
        "cluster_fields":   ["bene_mbi_id", "provider_id"],
    },
    "raw_cclf4_diagnosis": {
        "partition_field":  "clm_from_dt",
        "cluster_fields":   ["bene_mbi_id", "clm_dgns_cd"],
    },
    "raw_cclf5_physician": {
        "partition_field":  "clm_from_dt",
        "cluster_fields":   ["bene_mbi_id", "provider_id", "clm_line_hcpcs_cd"],
    },
    "raw_cclf8_beneficiary": {
        "partition_field":  None,
        "cluster_fields":   ["region", "utilization_segment"],
    },
    "raw_provider_dim": {
        "partition_field":  None,
        "cluster_fields":   ["provider_type", "provider_risk_profile"],
    },
    "raw_procedure_ref": {
        "partition_field":  None,
        "cluster_fields":   None,
    },
    "raw_diagnosis_ref": {
        "partition_field":  None,
        "cluster_fields":   ["body_system"],
    },
}

# ---------------------------------------------------------------------------
# Map logical table names to file paths and BQ table names
# ---------------------------------------------------------------------------

TABLE_MAP = {
    "procedure_ref": "raw_procedure_ref",
    "diagnosis_ref": "raw_diagnosis_ref",
    "provider_dim":  "raw_provider_dim",
    "cclf8":         "raw_cclf8_beneficiary",
    "cclf1":         "raw_cclf1_claims_header",
    "cclf4":         "raw_cclf4_diagnosis",
    "cclf5":         "raw_cclf5_physician",
}


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

def get_parquet_path(cfg, table_key: str) -> Path:
    """Resolve parquet file path from config paths."""
    path_map = {
        "procedure_ref": cfg.paths.procedure_ref,
        "diagnosis_ref": cfg.paths.diagnosis_ref,
        "provider_dim":  cfg.paths.provider_dim,
        "cclf8":         cfg.paths.cclf8,
        "cclf1":         cfg.paths.cclf1,
        "cclf4":         cfg.paths.cclf4,
        "cclf5":         cfg.paths.cclf5,
    }
    return path_map[table_key]


def prepare_dataframe(df: pd.DataFrame, bq_table_name: str) -> pd.DataFrame:
    """
    Coerce DataFrame dtypes to match BigQuery schema expectations.
    Handles numpy types, object columns, and date/timestamp columns.
    """
    schema = SCHEMAS[bq_table_name]
    type_map = {f.name: f.field_type for f in schema}

    for col in df.columns:
        if col not in type_map:
            continue
        bq_type = type_map[col]

        if bq_type == "DATE":
            df[col] = pd.to_datetime(df[col], errors="coerce").dt.date
        elif bq_type == "TIMESTAMP":
            df[col] = pd.to_datetime(df[col], errors="coerce")
        elif bq_type == "FLOAT64":
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("float64")
        elif bq_type == "INT64":
            # Use nullable Int64 to handle NaN in integer columns
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")
        elif bq_type == "BOOL":
            df[col] = df[col].astype("boolean")
        elif bq_type == "STRING":
            df[col] = df[col].where(df[col].notna(), other=None)
            df[col] = df[col].astype("object")

    return df


def load_table(
    client: bigquery.Client,
    project_id: str,
    dataset_id: str,
    table_key: str,
    parquet_path: Path,
    dry_run: bool = False,
) -> dict:
    """
    Load a single parquet file into BigQuery.
    Returns a result dict with status and row count.
    """
    bq_table_name = TABLE_MAP[table_key]
    table_ref     = f"{project_id}.{dataset_id}.{bq_table_name}"
    tbl_cfg       = TABLE_CONFIG[bq_table_name]

    print(f"\n  Loading {table_key} → {table_ref}")
    print(f"    Source: {parquet_path}")

    if not parquet_path.exists():
        print(f"    SKIP: File not found.")
        return {"table": table_key, "status": "skipped", "rows": 0}

    # Read parquet
    df = pd.read_parquet(parquet_path)
    print(f"    Read {len(df):,} rows from parquet.")

    if dry_run:
        print(f"    DRY RUN: skipping BigQuery load.")
        return {"table": table_key, "status": "dry_run", "rows": len(df)}

    # Prepare dtypes
    df = prepare_dataframe(df, bq_table_name)

    # Build job config
    job_config = bigquery.LoadJobConfig(
        schema=SCHEMAS[bq_table_name],
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        create_disposition=bigquery.CreateDisposition.CREATE_IF_NEEDED,
    )

    # Partitioning
    if tbl_cfg["partition_field"]:
        job_config.time_partitioning = TimePartitioning(
            type_=TimePartitioningType.DAY,
            field=tbl_cfg["partition_field"],
        )

    # Clustering
    if tbl_cfg["cluster_fields"]:
        job_config.clustering_fields = tbl_cfg["cluster_fields"]

    # Load
    load_job = client.load_table_from_dataframe(df, table_ref, job_config=job_config)
    load_job.result()  # Wait for completion

    # Verify
    table    = client.get_table(table_ref)
    bq_rows  = table.num_rows
    print(f"    Loaded {bq_rows:,} rows into BigQuery.")
    print(f"    Partition: {tbl_cfg['partition_field'] or 'none'}")
    print(f"    Cluster  : {tbl_cfg['cluster_fields'] or 'none'}")

    return {"table": table_key, "status": "success", "rows": bq_rows}


# ---------------------------------------------------------------------------
# Post-load validation queries
# ---------------------------------------------------------------------------

VALIDATION_QUERIES = {
    "raw_cclf1_claims_header": """
        SELECT
            COUNT(*)                                          AS total_rows,
            COUNTIF(cur_clm_uniq_id IS NULL)                 AS null_claim_ids,
            COUNTIF(clm_pmt_amt < 0)                         AS negative_payments,
            COUNTIF(clm_type_cd NOT IN ('10','20','40','50','60')) AS invalid_claim_types,
            COUNTIF(clm_thru_dt < clm_from_dt)               AS invalid_date_range,
            COUNTIF(drg_cd IS NOT NULL AND clm_type_cd != '60') AS drg_on_non_inpatient,
            COUNTIF(overpayment_flag = TRUE AND overpayment_amt = 0) AS op_flag_zero_amt,
            MIN(clm_from_dt)                                 AS earliest_claim,
            MAX(clm_from_dt)                                 AS latest_claim
        FROM `{table_ref}`
    """,
    "raw_cclf4_diagnosis": """
        SELECT
            COUNT(*)                                         AS total_rows,
            COUNTIF(clm_dgns_cd IS NULL)                     AS null_dx_codes,
            COUNTIF(clm_val_sqnc_num < 1)                    AS invalid_seq_num,
            COUNTIF(hcc_category IS NOT NULL AND hcc_weight IS NULL) AS hcc_cat_no_weight,
            COUNTIF(hcc_category IS NULL AND hcc_weight IS NOT NULL) AS weight_no_hcc_cat,
            COUNTIF(suspected_unsupported_dx_flag = TRUE AND hcc_category IS NULL) AS unsupported_non_hcc,
            COUNT(DISTINCT cur_clm_uniq_id)                  AS distinct_claims
        FROM `{table_ref}`
    """,
    "raw_cclf5_physician": """
        SELECT
            COUNT(*)                                         AS total_rows,
            COUNTIF(line_paid_amt > line_allowed_amt
                    AND clm_adjsmt_type_cd = '0'
                    AND clm_carr_pmt_dnl_cd IS NULL)         AS paid_exceeds_allowed,
            COUNTIF(clm_carr_pmt_dnl_cd IS NOT NULL
                    AND line_paid_amt != 0
                    AND clm_adjsmt_type_cd = '0')            AS denied_nonzero_paid,
            COUNTIF(units_of_service < 1)                    AS invalid_units,
            COUNTIF(service_category IS NULL)                AS null_service_cat,
            COUNT(DISTINCT cur_clm_uniq_id)                  AS distinct_claims,
            COUNT(DISTINCT bene_mbi_id)                      AS distinct_patients,
            COUNT(DISTINCT provider_id)                      AS distinct_providers
        FROM `{table_ref}`
    """,
    "raw_cclf8_beneficiary": """
        SELECT
            COUNT(*)                                         AS total_rows,
            COUNTIF(bene_mbi_id IS NULL)                     AS null_mbi,
            COUNTIF(bene_age < 65 OR bene_age > 95)          AS age_out_of_range,
            COUNTIF(bene_sex_cd NOT IN ('1','2'))             AS invalid_sex,
            COUNTIF(risk_score <= 0)                         AS nonpositive_risk_score,
            COUNTIF(county IS NULL)                          AS missing_county,
            COUNTIF(bene_race_cd IS NULL)                    AS missing_race,
            COUNTIF(bene_entlmt_buyin_ind = '3'
                    AND bene_part_b_enrlmt_bgn_dt IS NULL)   AS part_ab_missing_partb_date,
            AVG(risk_score)                                  AS avg_risk_score,
            AVG(chronic_condition_count)                     AS avg_chronic_count
        FROM `{table_ref}`
    """,
}


def run_validation_queries(
    client: bigquery.Client,
    project_id: str,
    dataset_id: str,
    tables_loaded: list[str],
) -> None:
    """Run post-load validation queries on loaded tables."""
    print("\n" + "=" * 60)
    print("Post-load validation queries")
    print("=" * 60)

    for table_key, query_template in VALIDATION_QUERIES.items():
        # Only validate tables that were actually loaded
        logical_key = [k for k, v in TABLE_MAP.items() if v == table_key]
        if not logical_key or logical_key[0] not in tables_loaded:
            continue

        table_ref = f"{project_id}.{dataset_id}.{table_key}"
        query     = query_template.format(table_ref=table_ref)

        print(f"\n  {table_key}:")
        try:
            result = client.query(query).to_dataframe()
            for col in result.columns:
                val = result[col].iloc[0]
                # Flag non-zero counts for integrity check columns
                flag = ""
                if isinstance(val, (int, float)) and col not in (
                    "total_rows", "distinct_claims", "distinct_patients",
                    "distinct_providers", "avg_risk_score", "avg_chronic_count",
                    "earliest_claim", "latest_claim", "negative_payments",
                ):
                    if val != 0:
                        flag = "  ⚠ UNEXPECTED"
                print(f"    {col:<45}: {val}{flag}")
        except Exception as e:
            print(f"    ERROR running validation query: {e}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Load generated parquet files into BigQuery.")
    parser.add_argument(
        "--tables",
        nargs="+",
        choices=list(TABLE_MAP.keys()),
        default=list(TABLE_MAP.keys()),
        help="Tables to load. Defaults to all tables.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read parquet files and validate but do not load to BigQuery.",
    )
    parser.add_argument(
        "--skip-validation",
        action="store_true",
        help="Skip post-load validation queries.",
    )
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("load_to_bigquery.py")
    print("=" * 60)

    cfg = load_config()
    summarize_config(cfg)

    project_id = cfg.raw.get("gcp", {}).get("project_id") or _get_project_from_env()
    dataset_id = "raw_cms_claims"

    print(f"\n  GCP Project : {project_id}")
    print(f"  Dataset     : {dataset_id}")
    print(f"  Tables      : {args.tables}")
    print(f"  Dry run     : {args.dry_run}")

    # Initialize BigQuery client (uses ADC automatically)
    client = bigquery.Client(project=project_id)

    # Load tables
    results      = []
    tables_loaded = []

    for table_key in args.tables:
        parquet_path = get_parquet_path(cfg, table_key)
        result = load_table(
            client, project_id, dataset_id, table_key, parquet_path,
            dry_run=args.dry_run,
        )
        results.append(result)
        if result["status"] == "success":
            tables_loaded.append(table_key)

    # Summary
    print("\n" + "=" * 60)
    print("Load summary")
    print("=" * 60)
    total_rows = 0
    for r in results:
        status_icon = "✓" if r["status"] == "success" else "○" if r["status"] == "dry_run" else "✗"
        print(f"  {status_icon}  {r['table']:<20} {r['rows']:>10,} rows  [{r['status']}]")
        if r["status"] == "success":
            total_rows += r["rows"]
    print(f"\n  Total rows loaded: {total_rows:,}")

    # Post-load validation
    if not args.dry_run and not args.skip_validation and tables_loaded:
        run_validation_queries(client, project_id, dataset_id, tables_loaded)

    print("\nDone.")
    print("=" * 60)


def _get_project_from_env() -> str:
    """
    Fall back to reading GCP_PROJECT_ID from .env if not in config.yaml.
    """
    import os
    from dotenv import load_dotenv
    load_dotenv()
    project_id = os.getenv("GCP_PROJECT_ID")
    if not project_id:
        raise ValueError(
            "GCP project ID not found. Set GCP_PROJECT_ID in your .env file "
            "or add a gcp.project_id key to config.yaml."
        )
    return project_id


if __name__ == "__main__":
    main()
    