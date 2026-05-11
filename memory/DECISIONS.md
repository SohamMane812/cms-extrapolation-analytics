# DECISIONS.md — Finalized Decisions

## Project Version History
- **V1**: Analytical implementation — warehouse, pipeline, notebooks, dashboard infrastructure
- **V2**: Productization — operational language, UX, workflow framing, business interpretation
- **V3**: Optional enhancement — cross-page navigation, ML, performance, demo assets

---

## Stack (Finalized)
- Python venv, GCP BigQuery + Cloud Storage
- Next.js 16.2.6, App Router, TypeScript, Tailwind CSS
- Vercel deployment — https://cms-extrapolation-analytics.vercel.app
- GitHub: github.com/SohamMane812/cms-extrapolation-analytics

---

## V2 Design Philosophy (Finalized)

### Platform Identity
The platform is a **healthcare audit analytics decision-support tool** — not a generic dashboard,
not a coding demo, not an academic notebook. Every design and language decision should reinforce
operational realism, audit workflow orientation, and executive explainability.

### Audience
- LinkedIn connections and healthcare analytics professionals
- Recruiters and hiring managers
- Data leaders and audit/risk teams
- Healthcare analytics interviewers

### Language Standards
- Surface language: business-first, audit-operational, investigation-oriented
- Technical depth: preserved underneath, accessible via interpretation blocks
- Tone: analytically mature, honest about limitations, never accusatory
- Framing: signals and indicators — not confirmed fraud or abuse
- Every chart gets a "so what" interpretation block
- Every page gets Key Findings insight cards
- Every KPI gets helper text explaining scope and calculation

### What the Platform Demonstrates
1. Healthcare domain knowledge (HCC coding, post-payment audits, CMS CCLF format)
2. Statistical reasoning (extrapolation, CI, anomaly scoring, z-scores)
3. Data engineering (BigQuery pipeline, staging/curated/analytics layers)
4. Business interpretation (translating analytics into operational decisions)
5. Audit workflow understanding (provider triage, claim investigation, sample design)
6. Governance maturity (data quality monitoring, fairness analysis, transparency)

---

## Dashboard Architecture (Finalized)

### Infrastructure
- Auth: GCP Service Account
  - Local: GOOGLE_APPLICATION_CREDENTIALS → ./config/service-account-key.json
  - Vercel: GOOGLE_CREDENTIALS_JSON → full JSON string env var
- lib/bigquery/client.ts: supports both auth modes with ADC fallback
- API: /api/bigquery POST → { sql } → { data }
- Root redirect: / → /executive-overview
- vercel.json in dashboard/ with framework: nextjs
- Vercel Root Directory: dashboard
- TypeScript strict: false (recharts formatter compatibility — re-enable in V3)

### Page Architecture Decisions
All pages follow this V2 structure:
1. Page header (title + subtitle with operational framing)
2. Context banner (explains why this page matters for audit)
3. KPIs with helper text (scope and calculation clarification)
4. Charts with interpretation blocks ("so what" before each chart)
5. Key Findings section (3-5 business-language insight cards)
6. Interpretation/methodology panel (clinical or operational context)

### Key Terminology Decisions (V2)
| Old | New |
|---|---|
| Composite Anomaly Score | Composite Audit Risk Score |
| Anomaly Risk Tier | Audit Priority Tier |
| Detection Curve | Audit Review Efficiency Curve |
| Flag Frequency | Audit Signal Frequency |
| Score Threshold | Review Threshold |
| Estimated Overpayment | Projected Recoverable Overpayment |
| Estimation Error | Projection Bias |
| CI Width | Recovery Uncertainty Range |
| Sample Coverage | Claims Reviewed |
| Provider Rankings | Provider Audit Risk Rankings |
| Peer Benchmarks | Peer Group Comparison |
| Claim Details | Claim Review Summary |
| Risk Indicators | Audit Review Indicators |
| DQ Issues | Data Quality Findings |
| Pipeline Status | Warehouse Processing Status |
| Risk Score | Patient Risk Burden Score |
| HCC Weight | Risk Contribution Weight |
| Coding Intensity | Diagnosis Coding Intensity |
| Sample Fairness | Audit Sample Fairness & Representation |
| Disparity Ratios | Payment Representation Variance |

---

## BigQuery Dataset Structure (Finalized)
- raw_cms_claims: 7 tables, 5,104,395 rows
- staging_cms_claims: 6 tables, 5,140,615 rows (DQ findings logged)
- curated_cms_claims: 8 tables, 4,652,849 rows (is_latest_version=TRUE)
- analytics_cms_claims: 9 tables, ~737K rows (materialized aggregates)

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

### Important Data Distinctions
- Executive Overview OP total: $24.2M (all Part A claims in payment_summary)
- Extrapolation universe OP: $20.58M (audit-eligible claims only, 289,837 claims)
- These are different and must be labeled distinctly throughout the UI

---

## SQL Pipeline (Finalized)
- 23 scripts, fully idempotent (CREATE OR REPLACE TABLE)
- run_sql.py orchestrates all layers
- Staging → Curated drop: 9.5% (duplicate resolution, not data loss)
- Peer group baselines exclude Suspicious and Outlier providers
- Percentiles: APPROX_QUANTILES

## Gitignore Rules (Finalized)
- Removed bare *.json from root .gitignore
- Specific exclusions: service_account*.json, gcp_key*.json, **/service-account-key.json
- vercel.json explicitly allowed via !vercel.json exception
- dashboard/.gitignore excludes .env* files
