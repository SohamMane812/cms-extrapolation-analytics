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
- Claim-level diagnoses capped at 4 columns (clm_dgns_1_cd through clm_dgns_4_cd)
- line_allowed_amt and line_paid_amt both retained for denial and adjustment analysis
- rendering_provider_id NOT added — deferred to future version
- service_category added as a precomputed field for benchmarking and dashboard use

### CCLF8
- bene_age stored as precomputed INT64 at generation time
- risk_score is correlated with but intentionally diverges from diagnosis burden
- low_income_subsidy_flag added for health equity analysis
- annual_cost_bucket added for segmentation and dashboard aggregation

### Provider Dimension
- peer_group uses hybrid provider type + specialty grouping
- provider_risk_profile has five values: Normal, High_Volume, Suspicious, Outlier, Emerging
- avg_monthly_claim_volume and avg_payment_per_claim NOT stored on provider_dim
- urban_rural_flag added with values: Urban, Suburban, Rural

### Procedure Code Reference
- allowed_amt_std_dev added for z-score based anomaly detection
- inpatient_only_flag added for validation logic

### Diagnosis Reference
- expected_care_pattern added for unsupported diagnosis detection
- body_system added for clinical grouping

### Audit Sample Table
- extrapolation_universe_size and extrapolation_universe_amt retained as snapshot fields
- sample_selection_reason added for audit storytelling and bias analysis

## Data Generation Order (Finalized)
1. procedure_ref and diagnosis_ref (reference tables, no dependencies)
2. provider_dim (no dependencies)
3. CCLF8 beneficiaries (no dependencies)
4. CCLF1 Part A claims (depends on CCLF8, provider_dim)
5. CCLF4 diagnoses (depends on CCLF1, CCLF8, diagnosis_ref)
6. CCLF5 Part B claim lines (depends on CCLF8, provider_dim, procedure_ref)
7. inject_bias_outliers_duplicates (post-processing pass across all tables)
8. audit_sample (generated after all claims exist)