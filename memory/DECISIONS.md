# DECISIONS.md — Finalized Decisions

## Data Scale (Finalized)
- Beneficiaries: 75K actual
- Providers: ~444 active
- Part A Claims: ~400K
- Total: 5,104,395 rows across 7 tables

## Stack (Finalized)
- Python venv, GCP BigQuery + Cloud Storage
- Next.js 16.2.6, App Router, TypeScript, Tailwind CSS
- Vercel deployment — https://cms-extrapolation-analytics.vercel.app
- GitHub: github.com/SohamMane812/cms-extrapolation-analytics

## V2 Design Philosophy (Finalized)
- Surface language: business-first, audit-operational, investigation-oriented
- Technical depth: preserved underneath, accessible via expandable sections
- Tone: analytically mature, trustworthy, honest about limitations
- Audience: LinkedIn, recruiters, healthcare analytics professionals, data leaders
- Goal: platform demonstrates domain knowledge + statistical reasoning + business interpretation
- Avoid: generic dashboard feel, academic notebook feel, technical demo feel

## V2 Language Standards (Finalized)
- Always explain WHY a metric matters, not just WHAT it is
- Every chart gets a 1-line "so what" subtitle
- Key Findings sections use business language, not statistical jargon
- Limitations and assumptions are surfaced, not hidden
- "Potential" qualifier used for unconfirmed overpayments
- "Elevated Audit Risk" preferred over generic "High Risk"

## GCP Region (Finalized)
- BigQuery dataset location: US (multi-region)
- All queries use location: US

## Dashboard Architecture (Finalized)
- Auth: GCP Service Account
  - Local: GOOGLE_APPLICATION_CREDENTIALS → ./config/service-account-key.json
  - Vercel: GOOGLE_CREDENTIALS_JSON → full JSON string
- lib/bigquery/client.ts: supports both auth modes with fallback to ADC
- API: /api/bigquery POST → { sql } → { data }
- Root redirect: / → /executive-overview
- vercel.json in dashboard/ with framework: nextjs
- Vercel Root Directory setting: dashboard
- TypeScript strict: false (recharts formatter compatibility)

## Dashboard Pages (Finalized — V1)
All 8 pages live. See CURRENT_STATUS.md for routes and status.

Key query decisions:
- Executive Overview OP rate: SUM(overpayment) / SUM(paid) — not AVG(rate)
- Extrapolation CI: ratio estimator, frontend-computed, dampened scale factor
- Detection curve: client-side from provider risk profiles
- Claims pagination: 25/page, server-side WHERE clause
- Adjustment chain: loaded via chain_root_id on claim select

## BigQuery Dataset Structure (Finalized)
- raw_cms_claims: 7 tables, 5,104,395 rows
- staging_cms_claims: 6 tables, 5,140,615 rows (DQ issues logged)
- curated_cms_claims: 8 tables, 4,652,849 rows (is_latest_version=TRUE)
- analytics_cms_claims: 9 tables, ~737K rows (materialized aggregates)
- ml_outputs: empty (V3)

Key curated tables:
- fact_part_a_claims — claim_id, chain_root_id, adjustment lineage, overpayment flags
- fact_diagnoses — HCC mapping, chronic flags, unsupported dx detection
- dim_provider — peer group, risk profile, benchmarks
- dim_beneficiary — demographics, risk score, dual status

Key analytics tables:
- payment_summary — claim_source = 'Part_A' or 'Part_B'
- provider_benchmark_summary — z-scores, percentiles, peer comparisons
- anomaly_scores — composite score, 7 audit flags, risk tier
- extrapolation_results — 4 sample types, precomputed
- data_quality_summary — 3 issue types, all Low severity
- patient_risk_summary — HCC weight, chronic count, demographics
- coding_intensity_summary — by year, utilization segment, cost bucket
- peer_group_summary — peer baselines excluding Suspicious/Outlier
- denial_summary — by provider, claim type, year/month

## SQL Pipeline (Finalized)
- 23 scripts, fully idempotent (CREATE OR REPLACE TABLE)
- run_sql.py orchestrates all layers
- Staging → Curated drop: 9.5% (duplicate resolution, not DQ failures)
- Peer group baselines exclude Suspicious and Outlier providers
- Percentiles: APPROX_QUANTILES

## Key Gitignore Rules (Finalized)
- Removed bare *.json from root .gitignore
- Specific exclusions: service_account*.json, gcp_key*.json, **/service-account-key.json
- vercel.json explicitly allowed via !vercel.json
- dashboard/.gitignore excludes .env* files
