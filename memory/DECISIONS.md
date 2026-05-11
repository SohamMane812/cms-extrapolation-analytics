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
- Next.js frontend (deferred to later phase)
- Vercel deployment (deferred to later phase)

## Version Strategy (Finalized)
- V1: Data generation, EDA, extrapolation, provider benchmarking, basic anomaly detection, basic dashboard
- V2: Clustering, ML prediction, coding intensity
- V3: Model explainability, downloadable reports, advanced deployment

## GCP Region (Finalized)
- us-central1

## Schema Decisions (Finalized)

### CCLF1
- clm_pmt_amt allows negative values for reversals and recoupments
- true_error_flag is an explicit hidden ground truth field, internal only
- clm_orig_clm_id added for adjustment/cancellation lineage
- drg_cd added for inpatient realism, NULL for non-inpatient
- length_of_stay added as INT64, NULL for non-inpatient

### CCLF4
- hcc_weight added as FLOAT64 for risk adjustment scoring
- clm_poa_ind is NULL for non-inpatient claims
- diagnosis_rank_type NOT added — clm_prod_type_cd is sufficient for V1

### CCLF5
- Claim-level diagnoses capped at 4 columns
- line_allowed_amt and line_paid_amt both retained
- rendering_provider_id NOT added — deferred to future version
- service_category added as precomputed field

### CCLF8
- bene_age stored as precomputed INT64 at generation time
- risk_score intentionally diverges from diagnosis burden
- low_income_subsidy_flag added for health equity analysis
- annual_cost_bucket added for segmentation

### Provider Dimension
- peer_group uses hybrid provider type + specialty grouping
- provider_risk_profile: Normal, High_Volume, Suspicious, Outlier, Emerging
- avg_monthly_claim_volume NOT stored on provider_dim
- urban_rural_flag added

### Procedure Code Reference
- allowed_amt_std_dev added for z-score anomaly detection
- inpatient_only_flag added for validation logic

### Diagnosis Reference
- expected_care_pattern added for unsupported diagnosis detection
- body_system added for clinical grouping

### Audit Sample Table
- extrapolation_universe_size and extrapolation_universe_amt retained as snapshot fields
- sample_selection_reason added for audit storytelling

## BigQuery Load Strategy (Finalized)
- Authentication: Application Default Credentials (ADC)
- Load behavior: Truncate-and-replace on every load
- Partitioning: CCLF1, CCLF4, CCLF5 partitioned by clm_from_dt (DAY)
- Clustering per table as documented in ARCHITECTURE.md
- Explicit BigQuery schemas defined in code — no schema inference

## SQL Transformation Strategy (Finalized)
- All SQL scripts use CREATE OR REPLACE TABLE — fully idempotent
- Template variables: {raw}, {staging}, {curated}, {analytics}, {ml}
- run_sql.py orchestrates all layers with dry-run support and skip flags
- Staging: retains all records, adds is_latest_version flag, logs DQ issues
- Curated: filters is_latest_version = TRUE and has_critical_null = FALSE
- Analytics: materialized tables, not views
- Peer group summary computed separately (pass 1) before provider benchmark (pass 2)
- Peer group baselines exclude Suspicious and Outlier providers
- Percentiles computed with APPROX_QUANTILES (not PERCENTILE_CONT window functions)

## Data Generation Order (Finalized)
1. procedure_ref and diagnosis_ref
2. provider_dim
3. CCLF8 beneficiaries
4. CCLF1 Part A claims
5. CCLF4 diagnoses
6. CCLF5 Part B claim lines
7. inject_bias_outliers_duplicates (post-processing)
8. audit_sample (generated after all claims exist)
