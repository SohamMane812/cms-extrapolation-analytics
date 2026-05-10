# ARCHITECTURE.md — CMS Extrapolation Analytics

## Overview

This document defines the full technical architecture for the CMS Extrapolation Analytics project including GCP structure, BigQuery organization, data flow, and deployment architecture.

---

## High-Level Architecture

```
Data Generation (Python)
        │
        ▼
Google Cloud Storage (Raw CSVs / Parquet)
        │
        ▼
BigQuery: raw_cms_claims
        │
        ▼
BigQuery: staging_cms_claims  (cleaning, deduplication, validation)
        │
        ▼
BigQuery: curated_cms_claims  (fact/dim star schema)
        │
        ▼
BigQuery: analytics_cms_claims  (aggregations, benchmarks, extrapolation)
        │
        ▼
BigQuery: ml_outputs  (model predictions, anomaly scores, clusters)
        │
        ▼
Next.js Frontend (Vercel)  ◄──── API Routes ──── BigQuery
```

---

## GCP Project

| Setting | Value |
|---|---|
| Project ID | cms-extrapolation-v1 |
| Region | us-central1 |
| Billing | Linked to existing billing account |

---

## Google Cloud Storage

| Bucket | Purpose |
|---|---|
| `cms-extrapolation-data-v1` | Primary data bucket |

### Bucket Folder Structure

```
cms-extrapolation-data-v1/
├── raw/                    # Raw generated CSV/Parquet files
│   ├── cclf1/
│   ├── cclf4/
│   ├── cclf5/
│   ├── cclf8/
│   ├── provider_dim/
│   ├── procedure_ref/
│   ├── diagnosis_ref/
│   └── audit_sample/
├── processed/              # Cleaned and validated files
├── model_outputs/          # Trained model artifacts
└── exports/                # Dashboard export files
```

---

## BigQuery Datasets

### Dataset 1: raw_cms_claims

Holds raw data exactly as generated. No transformations applied.

| Table | Source | Description |
|---|---|---|
| `raw_cclf1_claims_header` | GCS raw/cclf1/ | Part A claims as generated |
| `raw_cclf4_diagnosis` | GCS raw/cclf4/ | Diagnosis rows as generated |
| `raw_cclf5_physician` | GCS raw/cclf5/ | Part B claim lines as generated |
| `raw_cclf8_beneficiary` | GCS raw/cclf8/ | Beneficiary records as generated |
| `raw_provider_dim` | GCS raw/provider_dim/ | Provider dimension as generated |
| `raw_procedure_ref` | GCS raw/procedure_ref/ | Procedure reference as generated |
| `raw_diagnosis_ref` | GCS raw/diagnosis_ref/ | Diagnosis reference as generated |

---

### Dataset 2: staging_cms_claims

Cleaned and validated data. Transformations applied but not yet restructured into star schema.

| Table | Description |
|---|---|
| `stg_cclf1_claims_header` | Deduplicated, validated, adjustment chains resolved |
| `stg_cclf4_diagnosis` | Validated ICD codes, nulls handled |
| `stg_cclf5_physician` | Deduplicated lines, validated HCPCS codes |
| `stg_cclf8_beneficiary` | Validated demographics, age computed |
| `stg_provider_dim` | Validated provider records |
| `stg_data_quality_issues` | Log of all data quality issues found during staging |

#### Staging Transformation Rules
- Remove fully cancelled claims with no corresponding adjustment
- Resolve adjustment chains: keep only the final adjusted version for payment analysis
- Flag but retain duplicate claim lines
- Standardize all date formats
- Validate claim through date >= claim from date
- Validate payment amounts are non-null
- Validate ICD-10 codes against diagnosis_ref
- Validate HCPCS codes against procedure_ref
- Compute `length_of_stay` from date difference where NULL and claim type = inpatient

---

### Dataset 3: curated_cms_claims

Star schema optimized for analytics queries.

| Table | Type | Description |
|---|---|---|
| `fact_part_a_claims` | Fact | Final cleaned Part A claims |
| `fact_part_b_claim_lines` | Fact | Final cleaned Part B claim lines |
| `fact_diagnoses` | Fact | Final cleaned diagnosis rows |
| `dim_beneficiary` | Dimension | Patient demographics |
| `dim_provider` | Dimension | Provider attributes |
| `dim_diagnosis` | Dimension | Diagnosis reference |
| `dim_procedure` | Dimension | Procedure reference |
| `dim_date` | Dimension | Date spine for time-based analysis |

---

### Dataset 4: analytics_cms_claims

Pre-aggregated analytics tables optimized for dashboard queries and Python analysis.

| Table | Description |
|---|---|
| `provider_benchmark_summary` | Provider vs peer group metrics |
| `extrapolation_results` | Extrapolation estimates by sample type |
| `audit_sample_results` | Audit sample with review outcomes |
| `anomaly_scores` | Provider and claim-level anomaly scores |
| `data_quality_summary` | Data quality issue counts and rates |
| `patient_risk_summary` | Patient-level risk and utilization summary |
| `coding_intensity_summary` | Diagnosis capture and HCC trend analysis |
| `denial_summary` | Denial rates by provider, claim type, procedure |
| `payment_summary` | Payment aggregations by provider, region, claim type |

---

### Dataset 5: ml_outputs

Machine learning model results.

| Table | Description |
|---|---|
| `claim_overpayment_predictions` | Predicted overpayment probability per claim |
| `provider_anomaly_scores` | Anomaly scores per provider from isolation forest |
| `provider_clusters` | Cluster assignments per provider |
| `denial_risk_predictions` | Predicted denial probability per claim |
| `model_performance_metrics` | Model evaluation metrics by model version |
| `feature_importance` | Feature importance scores by model |

---

## Data Flow Detail

### Phase 1 — Generation
```
Python data_generation/ scripts
  → Generate synthetic CCLF-style data
  → Output as CSV or Parquet
  → Upload to GCS raw/ folders
```

### Phase 2 — Raw Load
```
GCS raw/ files
  → Load into BigQuery raw_cms_claims dataset
  → No transformations, exact copy of generated data
```

### Phase 3 — Staging
```
raw_cms_claims tables
  → SQL transformations in sql/raw_to_staging/
  → Write to staging_cms_claims dataset
  → Log all data quality issues to stg_data_quality_issues
```

### Phase 4 — Curated
```
staging_cms_claims tables
  → SQL transformations in sql/staging_to_curated/
  → Build star schema in curated_cms_claims dataset
  → Build dim_date spine
```

### Phase 5 — Analytics
```
curated_cms_claims tables
  → SQL aggregations in sql/analytics/
  → Write to analytics_cms_claims dataset
  → Python notebooks read from curated and analytics layers
```

### Phase 6 — ML
```
curated_cms_claims + analytics_cms_claims
  → Python modeling scripts in src/modeling/
  → Write predictions and scores to ml_outputs dataset
```

### Phase 7 — Frontend
```
analytics_cms_claims + ml_outputs
  → Next.js API routes query BigQuery
  → Dashboard pages render results
  → Deployed to Vercel
```

---

## Frontend Architecture

### Stack
- Framework: Next.js with TypeScript
- Styling: Tailwind CSS
- Charts: Recharts or Plotly
- Deployment: Vercel
- API: Next.js API routes querying BigQuery

### Dashboard Pages
| Page | Primary Data Source |
|---|---|
| Executive Overview | payment_summary, data_quality_summary |
| Claims Explorer | fact_part_a_claims, fact_part_b_claim_lines |
| Extrapolation Simulator | extrapolation_results, audit_sample_results |
| Sample Fairness | audit_sample_results, dim_beneficiary |
| Provider Benchmarking | provider_benchmark_summary |
| Anomaly Detection | anomaly_scores |
| Clustering | provider_clusters (V2) |
| Risk Adjustment | coding_intensity_summary, patient_risk_summary |
| ML Model Results | claim_overpayment_predictions, model_performance_metrics (V2) |
| Data Quality Monitor | data_quality_summary, stg_data_quality_issues |

---

## GitHub Repository Structure

```
cms-extrapolation-analytics/
│
├── memory/                         # Project documentation and memory system
│   ├── CLAUDE.md
│   ├── CURRENT_STATUS.md
│   ├── DECISIONS.md
│   ├── TODO.md
│   ├── DATA_DICTIONARY.md
│   ├── ARCHITECTURE.md
│   └── PROJECT_CONTEXT.md
│
├── data_generation/                # Synthetic data generation scripts
│   ├── generate_cclf1_part_a_claims.py
│   ├── generate_cclf4_diagnoses.py
│   ├── generate_cclf5_part_b_claims.py
│   ├── generate_cclf8_beneficiaries.py
│   ├── generate_provider_dim.py
│   ├── generate_reference_tables.py
│   ├── inject_bias_outliers_duplicates.py
│   └── config.yaml
│
├── sql/
│   ├── raw_to_staging/
│   ├── staging_to_curated/
│   └── analytics/
│       ├── provider_benchmarking.sql
│       ├── extrapolation_analysis.sql
│       ├── data_quality_checks.sql
│       ├── risk_adjustment_features.sql
│       └── anomaly_features.sql
│
├── notebooks/
│   ├── 01_data_quality_eda.ipynb
│   ├── 02_claims_eda.ipynb
│   ├── 03_extrapolation_simulation.ipynb
│   ├── 04_provider_benchmarking.ipynb
│   ├── 05_anomaly_detection.ipynb
│   ├── 06_clustering.ipynb
│   ├── 07_ml_modeling.ipynb
│   └── 08_model_validation.ipynb
│
├── src/
│   ├── data_quality/
│   ├── extrapolation/
│   ├── statistics/
│   ├── features/
│   ├── anomaly_detection/
│   ├── clustering/
│   ├── modeling/
│   └── utils/
│
├── models/
│   ├── trained_models/
│   ├── model_metrics/
│   └── feature_importance/
│
├── dashboard/
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── public/
│   └── styles/
│
├── outputs/
│   ├── figures/
│   ├── reports/
│   ├── sample_results/
│   └── model_outputs/
│
├── docs/
│   ├── architecture.md
│   ├── dataset_design.md
│   ├── extrapolation_methodology.md
│   ├── model_card.md
│   └── dashboard_walkthrough.md
│
├── config/
├── .env.example
├── .gitignore
├── requirements.txt
├── package.json
└── README.md
```

---

## Environment Variables

All secrets and configuration stored in `.env` (never committed).

```
GCP_PROJECT_ID
GCP_REGION
GCP_BUCKET_NAME
BIGQUERY_DATASET_RAW
BIGQUERY_DATASET_STAGING
BIGQUERY_DATASET_CURATED
BIGQUERY_DATASET_ANALYTICS
BIGQUERY_DATASET_ML
RANDOM_SEED
NUM_BENEFICIARIES
NUM_PROVIDERS
ENVIRONMENT
```

---

## Version Scope

| Component | V1 | V2 | V3 |
|---|---|---|---|
| Data generation | ✓ | | |
| GCS + BigQuery setup | ✓ | | |
| Raw → Staging SQL | ✓ | | |
| Staging → Curated SQL | ✓ | | |
| Analytics SQL | ✓ | | |
| EDA notebooks | ✓ | | |
| Extrapolation simulation | ✓ | | |
| Provider benchmarking | ✓ | | |
| Basic anomaly detection | ✓ | | |
| Basic dashboard | ✓ | | |
| Clustering | | ✓ | |
| ML prediction models | | ✓ | |
| Coding intensity analysis | | ✓ | |
| Model explainability | | | ✓ |
| Downloadable reports | | | ✓ |
| Advanced deployment | | | ✓ |

---

*Last updated: Session 2 — Schema Finalization*
*Status: Architecture finalized for Version 1*
