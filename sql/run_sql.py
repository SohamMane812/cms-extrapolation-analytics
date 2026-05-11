"""
sql/run_sql.py

Centralized SQL orchestration runner for CMS Extrapolation Analytics.

Executes BigQuery SQL transformation scripts in dependency order.
Supports individual script execution, layer-level execution, and
full pipeline execution from raw through analytics.

Usage:
    # Run full pipeline
    python sql/run_sql.py --layer all

    # Run specific layer
    python sql/run_sql.py --layer staging
    python sql/run_sql.py --layer curated
    python sql/run_sql.py --layer analytics

    # Run single script
    python sql/run_sql.py --script sql/raw_to_staging/stg_cclf8_beneficiary.sql

    # Dry run (validate SQL syntax without executing)
    python sql/run_sql.py --layer staging --dry-run

    # Skip specific scripts
    python sql/run_sql.py --layer staging --skip stg_data_quality_issues

Authentication:
    Uses Application Default Credentials (ADC).
    Run: gcloud auth application-default login
"""

import sys
import argparse
import time
from pathlib import Path
from datetime import datetime

repo_root = Path(__file__).resolve().parent.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from google.cloud import bigquery
from src.utils.config_loader import load_config

# ---------------------------------------------------------------------------
# Pipeline definition
# Scripts run in the order listed. Dependency order matters.
# ---------------------------------------------------------------------------

PIPELINE = {
    "staging": [
        "sql/raw_to_staging/stg_provider_dim.sql",
        "sql/raw_to_staging/stg_cclf8_beneficiary.sql",
        "sql/raw_to_staging/stg_cclf1_claims_header.sql",
        "sql/raw_to_staging/stg_cclf4_diagnosis.sql",
        "sql/raw_to_staging/stg_cclf5_physician.sql",
        "sql/raw_to_staging/stg_data_quality_issues.sql",
    ],
    "curated": [
        "sql/staging_to_curated/dim_date.sql",
        "sql/staging_to_curated/dim_beneficiary.sql",
        "sql/staging_to_curated/dim_provider.sql",
        "sql/staging_to_curated/dim_diagnosis.sql",
        "sql/staging_to_curated/dim_procedure.sql",
        "sql/staging_to_curated/fact_part_a_claims.sql",
        "sql/staging_to_curated/fact_diagnoses.sql",
        "sql/staging_to_curated/fact_part_b_claim_lines.sql",
    ],
    "analytics": [
        "sql/analytics/payment_summary.sql",
        "sql/analytics/denial_summary.sql",
        "sql/analytics/peer_group_summary.sql",
        "sql/analytics/provider_benchmark_summary.sql",
        "sql/analytics/patient_risk_summary.sql",
        "sql/analytics/coding_intensity_summary.sql",
        "sql/analytics/data_quality_summary.sql",
        "sql/analytics/extrapolation_results.sql",
        "sql/analytics/anomaly_features.sql",
    ],
}


# ---------------------------------------------------------------------------
# Template variable substitution
# ---------------------------------------------------------------------------

def resolve_sql(sql_text: str, project_id: str) -> str:
    """
    Replace template variables in SQL with actual values.

    Variables supported:
        {project_id}   — GCP project ID
        {raw}          — raw_cms_claims dataset
        {staging}      — staging_cms_claims dataset
        {curated}      — curated_cms_claims dataset
        {analytics}    — analytics_cms_claims dataset
        {ml}           — ml_outputs dataset
    """
    return (
        sql_text
        .replace("{project_id}",  project_id)
        .replace("{raw}",         f"{project_id}.raw_cms_claims")
        .replace("{staging}",     f"{project_id}.staging_cms_claims")
        .replace("{curated}",     f"{project_id}.curated_cms_claims")
        .replace("{analytics}",   f"{project_id}.analytics_cms_claims")
        .replace("{ml}",          f"{project_id}.ml_outputs")
    )


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

def execute_script(
    client: bigquery.Client,
    script_path: Path,
    project_id: str,
    dry_run: bool = False,
) -> dict:
    """
    Execute a single SQL script against BigQuery.

    Returns a result dict with status, duration, and row count.
    """
    result = {
        "script":    script_path.name,
        "path":      str(script_path),
        "status":    "pending",
        "rows":      None,
        "duration":  None,
        "error":     None,
    }

    if not script_path.exists():
        result["status"] = "missing"
        result["error"]  = f"File not found: {script_path}"
        return result

    sql_raw  = script_path.read_text(encoding="utf-8")
    sql_text = resolve_sql(sql_raw, project_id)

    if dry_run:
        # Validate syntax only — no execution
        job_config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
        try:
            client.query(sql_text, job_config=job_config)
            result["status"] = "dry_run_ok"
        except Exception as e:
            result["status"] = "dry_run_error"
            result["error"]  = str(e)
        return result

    # Execute
    start = time.time()
    try:
        job = client.query(sql_text)
        job.result()   # Wait for completion
        duration = round(time.time() - start, 2)

        result["status"]   = "success"
        result["duration"] = duration

        # Attempt to get destination row count
        if job.destination:
            try:
                table      = client.get_table(job.destination)
                result["rows"] = table.num_rows
            except Exception:
                result["rows"] = None

    except Exception as e:
        result["status"]   = "error"
        result["error"]    = str(e)
        result["duration"] = round(time.time() - start, 2)

    return result


def run_layer(
    client: bigquery.Client,
    layer_name: str,
    scripts: list[str],
    project_id: str,
    repo_root: Path,
    dry_run: bool = False,
    skip: list[str] | None = None,
) -> list[dict]:
    """Run all scripts in a layer in order."""
    skip = skip or []
    results = []

    print(f"\n{'='*60}")
    print(f"Layer: {layer_name.upper()}")
    print(f"{'='*60}")

    for script_rel_path in scripts:
        script_path = repo_root / script_rel_path
        script_stem = script_path.stem

        if script_stem in skip:
            print(f"\n  SKIP  {script_path.name}")
            results.append({
                "script": script_path.name,
                "path": str(script_path),
                "status": "skipped",
                "rows": None,
                "duration": None,
                "error": None,
            })
            continue

        print(f"\n  Running {script_path.name}...")
        result = execute_script(client, script_path, project_id, dry_run=dry_run)

        # Print result inline
        if result["status"] == "success":
            rows_str = f"{result['rows']:,} rows" if result["rows"] is not None else "rows unknown"
            print(f"    ✓  {result['duration']}s  |  {rows_str}")
        elif result["status"] == "dry_run_ok":
            print(f"    ○  dry run OK")
        elif result["status"] == "missing":
            print(f"    —  MISSING: {result['error']}")
        else:
            print(f"    ✗  {result['status'].upper()}: {result['error']}")
            # Stop layer on first error to prevent cascading failures
            results.append(result)
            print(f"\n  Stopping layer '{layer_name}' due to error.")
            break

        results.append(result)

    return results


# ---------------------------------------------------------------------------
# Summary reporter
# ---------------------------------------------------------------------------

def print_summary(all_results: list[dict]) -> None:
    print(f"\n{'='*60}")
    print("Execution Summary")
    print(f"{'='*60}")

    counts = {"success": 0, "error": 0, "skipped": 0, "missing": 0, "dry_run_ok": 0}
    total_duration = 0.0

    for r in all_results:
        status = r["status"]
        counts[status] = counts.get(status, 0) + 1
        if r["duration"]:
            total_duration += r["duration"]

        icon = {
            "success":     "✓",
            "error":       "✗",
            "skipped":     "—",
            "missing":     "—",
            "dry_run_ok":  "○",
        }.get(status, "?")

        rows_str = f"{r['rows']:>10,} rows" if r["rows"] is not None else "           "
        dur_str  = f"{r['duration']:>6.2f}s" if r["duration"] else "        "
        print(f"  {icon}  {r['script']:<45} {rows_str}  {dur_str}  [{status}]")

    print(f"\n  Scripts run   : {len(all_results)}")
    print(f"  Succeeded     : {counts.get('success', 0)}")
    print(f"  Errors        : {counts.get('error', 0)}")
    print(f"  Skipped       : {counts.get('skipped', 0) + counts.get('missing', 0)}")
    print(f"  Total time    : {total_duration:.2f}s")

    if counts.get("error", 0) > 0:
        print("\n  ⚠  One or more scripts failed. Check errors above.")
    else:
        print("\n  All scripts completed successfully.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="CMS Extrapolation Analytics — BigQuery SQL runner."
    )
    parser.add_argument(
        "--layer",
        choices=["staging", "curated", "analytics", "all"],
        help="Run all scripts in a layer.",
    )
    parser.add_argument(
        "--script",
        type=str,
        help="Run a single SQL script by path.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate SQL syntax without executing.",
    )
    parser.add_argument(
        "--skip",
        nargs="+",
        default=[],
        help="Script stems to skip (e.g. --skip stg_data_quality_issues).",
    )
    args = parser.parse_args()

    if not args.layer and not args.script:
        parser.error("Provide --layer or --script.")

    print(f"\n{'='*60}")
    print("run_sql.py — BigQuery SQL Runner")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")

    cfg        = load_config()
    project_id = cfg.raw.get("gcp", {}).get("project_id") or _get_project_from_env()
    client     = bigquery.Client(project=project_id)

    print(f"  Project : {project_id}")
    print(f"  Dry run : {args.dry_run}")

    all_results = []

    if args.script:
        script_path = repo_root / args.script
        print(f"\n  Running single script: {script_path.name}")
        result = execute_script(client, script_path, project_id, dry_run=args.dry_run)
        all_results.append(result)

    elif args.layer:
        layers_to_run = (
            list(PIPELINE.keys()) if args.layer == "all" else [args.layer]
        )
        for layer_name in layers_to_run:
            scripts = PIPELINE.get(layer_name, [])
            layer_results = run_layer(
                client, layer_name, scripts, project_id, repo_root,
                dry_run=args.dry_run, skip=args.skip,
            )
            all_results.extend(layer_results)

            # Stop pipeline on layer error
            if any(r["status"] == "error" for r in layer_results):
                print(f"\n  Pipeline stopped at layer '{layer_name}' due to error.")
                break

    print_summary(all_results)
    print(f"\nFinished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")


def _get_project_from_env() -> str:
    import os
    from dotenv import load_dotenv
    load_dotenv()
    project_id = os.getenv("GCP_PROJECT_ID")
    if not project_id:
        raise ValueError(
            "GCP_PROJECT_ID not found. Set it in .env or add gcp.project_id to config.yaml."
        )
    return project_id


if __name__ == "__main__":
    main()
    