# DECISIONS.md — Finalized Decisions

## Data Scale (Finalized)
- Beneficiaries: 50K–100K
- Providers: 500–2,000
- Part A Claims (CCLF1): 300K–500K
- Diagnosis Rows (CCLF4): 1M–2M
- Part B Claim Lines (CCLF5): 500K–1.5M
- Total: ~2–4M rows

## Stack (Finalized)
- Python venv (no conda)
- .env files for all config/secrets
- GCP: BigQuery + Cloud Storage
- BigQuery datasets: raw, staging, curated, analytics, ml_outputs
- GCS bucket for raw and processed files
- Next.js 16.2.6 frontend (App Router, TypeScript, Tailwind)
- Vercel deployment (deferred to later phase)

## Version Strategy (Finalized)
- V1: Data generation, EDA, extrapolation, provider benchmarking, basic anomaly detection, basic dashboard
- V2: Clustering, ML prediction, coding intensity
- V3: Model explainability, downloadable reports, advanced deployment

## GCP Region (Finalized)
- BigQuery dataset location: US (multi-region, not us-central1)
- All queries must use location: US

## Dashboard Architecture (Finalized)
- Framework: Next.js 16.2.6, App Router, TypeScript, Tailwind CSS
- Auth: GCP Service Account key file (./config/service-account-key.json)
- BigQuery client: @google-cloud/bigquery via lib/bigquery/client.ts
- Query helper: lib/bigquery/query.ts — runQuery<T>(sql) generic
- API route: /api/bigquery POST — accepts { sql } body, returns { data }
- All queries in lib/bigquery/queries.ts (named exports)
- Charts: recharts (BarChart, LineChart, ScatterChart, ResponsiveContainer)
- Icons: lucide-react
- Folder structure:
  - app/<page-name>/page.tsx — one file per page
  - app/api/bigquery/route.ts — single generic BQ endpoint
  - lib/bigquery/ — client, query helper, queries
  - components/ui, components/charts, components/layout — shared (not yet populated)

## Dashboard Page Decisions (Finalized)
- Executive Overview: uses payment_summary + anomaly_scores + extrapolation_results
  - True OP rate = SUM(total_overpayment) / SUM(total_paid_amount) — not AVG(overpayment_rate)
- Extrapolation Simulator: reads precomputed extrapolation_results (4 rows)
  - CI computed frontend-side using ratio estimator approximation
  - Scale factor dampened (5% sensitivity) to avoid misleading live simulation
  - TRUE_UNIVERSE constants hardcoded from precomputed values
- Provider Benchmarking: uses provider_benchmark_summary + peer_group_summary
  - Scatter: payment_z_score_vs_peer vs denial_rate_z_score_vs_peer
  - Detail panel sticky, loads on row/scatter click
- Anomaly Detection: uses anomaly_scores table exclusively
  - Detection curve built client-side from provider risk profiles
  - Score threshold filter adjustable (0/1/2/5/10)
- Claims Explorer: uses curated_cms_claims.fact_part_a_claims + fact_diagnoses
  - Paginated: 25 rows per page, server-side WHERE clause
  - Audit risk score computed client-side (composite of flags)
  - "Why Risky" interpretation built from claim fields + diagnoses
  - URL params: ?provider=PRV000xxx, ?suspicious=true for drill-through
  - Adjustment chain loaded on claim select via chain_root_id

## Schema Decisions (Finalized)
[... all prior schema decisions unchanged ...]

## BigQuery Load Strategy (Finalized)
- Authentication: Service Account key file for dashboard
- ADC still used for notebooks/Python scripts
- Load behavior: Truncate-and-replace on every load
- Partitioning: CCLF1, CCLF4, CCLF5 partitioned by clm_from_dt (DAY)
- Explicit BigQuery schemas defined in code — no schema inference

## SQL Transformation Strategy (Finalized)
- All SQL scripts use CREATE OR REPLACE TABLE — fully idempotent
- Template variables: {raw}, {staging}, {curated}, {analytics}, {ml}
- run_sql.py orchestrates all layers with dry-run support and skip flags
- Staging: retains all records, adds is_latest_version flag, logs DQ issues
- Curated: filters is_latest_version = TRUE and has_critical_null = FALSE
- Analytics: materialized tables, not views
- Peer group baselines exclude Suspicious and Outlier providers
- Percentiles computed with APPROX_QUANTILES

## EDA Notebook Design (Finalized)
- Authentication: google-cloud-bigquery ADC directly in notebooks
- Shared utilities: src/utils/notebook_utils.py
- Notebook structure: analytical report format with finding(), healthcare_context(), observation()
- Ground truth usage: provider_risk_profile used as validation label in notebook 05
- Anomaly score null handling: null scores treated as 0.0 for ROC — documented
