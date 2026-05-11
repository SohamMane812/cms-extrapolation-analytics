# DECISIONS.md — Finalized Decisions

## Data Scale (Finalized)
- Beneficiaries: 50K–100K (actual: 75K)
- Providers: 500–2,000 (actual: ~444 active)
- Part A Claims (CCLF1): 300K–500K (actual: ~400K)
- Diagnosis Rows (CCLF4): 1M–2M
- Part B Claim Lines (CCLF5): 500K–1.5M
- Total: 5,104,395 rows

## Stack (Finalized)
- Python venv (no conda)
- .env files for all config/secrets
- GCP: BigQuery + Cloud Storage
- BigQuery datasets: raw, staging, curated, analytics, ml_outputs
- GCS bucket for raw and processed files
- Next.js 16.2.6 frontend (App Router, TypeScript, Tailwind)
- Vercel deployment — live at https://cms-extrapolation-analytics.vercel.app

## Version Strategy (Finalized)
- V1: Data generation, EDA, extrapolation, provider benchmarking, anomaly detection, full dashboard ✅ COMPLETE
- V2: Product polish, UX refinement, clustering, ML prediction
- V3: Model explainability, downloadable reports, advanced deployment

## GCP Region (Finalized)
- BigQuery dataset location: US (multi-region, not us-central1)
- All queries must use location: US

## Dashboard Architecture (Finalized)
- Framework: Next.js 16.2.6, App Router, TypeScript, Tailwind CSS
- Auth: GCP Service Account key file
  - Local: ./config/service-account-key.json via GOOGLE_APPLICATION_CREDENTIALS
  - Vercel: full JSON content via GOOGLE_CREDENTIALS_JSON env var
- BigQuery client: lib/bigquery/client.ts — supports both auth modes
- Query helper: lib/bigquery/query.ts — runQuery<T>(sql) generic
- API route: /api/bigquery POST — accepts { sql } body, returns { data }
- Queries: lib/bigquery/queries.ts (named exports for executive overview)
- Charts: recharts (BarChart, LineChart, ScatterChart, PieChart, RadarChart)
- Root redirect: app/page.tsx → /executive-overview
- Vercel config: dashboard/vercel.json with framework: nextjs
- Root directory: dashboard/ (set in Vercel project settings)
- TypeScript strict mode: disabled (recharts formatter type compatibility)

## Dashboard Page Decisions (Finalized)
- Executive Overview: payment_summary + anomaly_scores + extrapolation_results
  - True OP rate = SUM(total_overpayment) / SUM(total_paid_amount)
- Extrapolation Simulator: precomputed extrapolation_results (4 rows)
  - CI computed frontend-side using ratio estimator approximation
  - TRUE_UNIVERSE constants hardcoded from precomputed values
  - Scale factor dampened (5% sensitivity)
- Provider Benchmarking: provider_benchmark_summary + peer_group_summary
  - Scatter: payment_z_score_vs_peer vs denial_rate_z_score_vs_peer
  - Detail panel sticky, loads on row/scatter click
- Anomaly Detection: anomaly_scores table
  - Detection curve built client-side from provider risk profiles
  - Score threshold filter: 0/1/2/5/10
- Claims Explorer: curated_cms_claims.fact_part_a_claims + fact_diagnoses
  - Paginated: 25 rows per page, server-side WHERE clause
  - Audit risk score computed client-side
  - "Why Risky" interpretation built dynamically from claim + diagnosis fields
  - URL params: ?provider=PRV000xxx, ?suspicious=true for drill-through
  - Adjustment chain loaded via chain_root_id
- Data Quality Monitor: analytics_cms_claims.data_quality_summary + staging DQ issues
  - Pipeline flow: Raw → Staging → Curated → Analytics
  - Clickable table/issue filters load record-level samples
- Risk Adjustment: patient_risk_summary + coding_intensity_summary
  - Filters: claim year, utilization segment
  - Charts: risk by age, HCC weight, coding intensity trend, cost bucket, scatter
- Sample Fairness: patient_risk_summary + fact_part_a_claims JOIN
  - Tabbed: Race / Sex / Region / Dual Status
  - Disparity ratios vs White baseline
  - Denial rate by race from claim-level join

## Key Gitignore Decisions
- Root .gitignore: removed bare *.json rule — was blocking package.json, tsconfig.json
- Specific credential exclusions: service_account*.json, gcp_key*.json, **/service-account-key.json
- dashboard/.gitignore: .env* excluded (service account path stays local only)
- vercel.json: explicitly allowed via !vercel.json exception

## BigQuery Load Strategy (Finalized)
- Authentication: Service Account for dashboard, ADC for notebooks/Python
- Load behavior: Truncate-and-replace on every load
- Partitioning: CCLF1, CCLF4, CCLF5 partitioned by clm_from_dt (DAY)
- Clustering per table as documented in ARCHITECTURE.md
- Explicit BigQuery schemas — no schema inference

## SQL Transformation Strategy (Finalized)
- All SQL scripts: CREATE OR REPLACE TABLE — fully idempotent
- Template variables: {raw}, {staging}, {curated}, {analytics}, {ml}
- run_sql.py: orchestrates all layers with dry-run support and skip flags
- Staging: retains all records, adds is_latest_version flag, logs DQ issues
- Curated: filters is_latest_version = TRUE and has_critical_null = FALSE
- Analytics: materialized tables, not views
- Peer group baselines exclude Suspicious and Outlier providers
- Percentiles: APPROX_QUANTILES

## EDA Notebook Design (Finalized)
- Authentication: google-cloud-bigquery ADC directly in notebooks
- Shared utilities: src/utils/notebook_utils.py
- Notebook structure: analytical report format with finding(), healthcare_context(), observation()
- Ground truth: provider_risk_profile used as validation label in notebook 05
- Anomaly score null handling: null scores = 0.0 for ROC — documented as honest limitation
