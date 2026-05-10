# DATA_DICTIONARY.md — CMS Extrapolation Analytics

## Overview

This document defines all tables, fields, types, and business logic for the CMS Extrapolation Analytics project. All schemas are finalized for Version 1. No changes should be made without updating this document and DECISIONS.md.

---

## Table Index

| Table | Description | Target Row Count |
|---|---|---|
| CCLF1 | Part A Claims Header | 300K–500K |
| CCLF4 | Part A Diagnosis Codes | 1M–2M |
| CCLF5 | Part B Physician Claim Lines | 500K–1.5M |
| CCLF8 | Beneficiary Demographics | 50K–100K |
| provider_dim | Provider Dimension | 500–2,000 |
| procedure_ref | Procedure Code Reference | ~500 |
| diagnosis_ref | Diagnosis Code Reference | ~1,000 |
| audit_sample | Audit Sample Table | Varies by simulation |

---

## CCLF1 — Part A Claims Header

One row per institutional claim.

Represents claims from hospitals, inpatient facilities, outpatient facilities, skilled nursing facilities, home health agencies, and hospice.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `cur_clm_uniq_id` | STRING | NO | Unique claim ID, primary key |
| `bene_mbi_id` | STRING | NO | Patient ID, FK to CCLF8 |
| `provider_id` | STRING | NO | Facility/provider ID, FK to provider_dim |
| `clm_type_cd` | STRING | NO | 10=HHA, 20=SNF, 40=Outpatient, 50=Hospice, 60=Inpatient |
| `clm_from_dt` | DATE | NO | Claim service start date |
| `clm_thru_dt` | DATE | NO | Claim service end date |
| `clm_mdcr_npmt_rsn_cd` | STRING | YES | Denial reason code, NULL means payable |
| `clm_pmt_amt` | FLOAT64 | NO | Medicare payment amount, negative for reversals |
| `clm_adjsmt_type_cd` | STRING | NO | 0=original, 1=cancel, 2=adjustment |
| `clm_orig_clm_id` | STRING | YES | Original claim ID for adjustments/cancellations, NULL for originals |
| `dgns_prcdr_icd_ind` | STRING | NO | ICD version, 0=ICD-10 |
| `facility_type` | STRING | NO | Hospital, SNF, HHA, Hospice, Outpatient |
| `claim_status` | STRING | NO | Paid, Denied, Adjusted, Cancelled |
| `drg_cd` | STRING | YES | DRG code, populated for inpatient claims only |
| `length_of_stay` | INT64 | YES | Days between admission and discharge, inpatient only |
| `overpayment_flag` | BOOLEAN | NO | Whether claim has simulated overpayment |
| `overpayment_amt` | FLOAT64 | NO | Simulated overpayment amount, 0.0 if none |
| `audit_eligible_flag` | BOOLEAN | NO | Whether claim is eligible for audit |
| `true_error_flag` | BOOLEAN | NO | Hidden ground truth label for ML and validation |
| `created_at` | TIMESTAMP | NO | Record creation timestamp |

### Business Rules
- `clm_orig_clm_id` is NULL for original claims (clm_adjsmt_type_cd = 0)
- `clm_orig_clm_id` is populated for cancellations (type 1) and adjustments (type 2)
- `drg_cd` and `length_of_stay` are NULL for all non-inpatient claim types
- `clm_pmt_amt` may be negative for cancellation and adjustment reversals
- `true_error_flag` is internal only and should be excluded from auditor-facing analyses
- `overpayment_amt` is 0.0 when `overpayment_flag` is FALSE

### CLM_TYPE_CD Values
| Code | Meaning |
|---|---|
| 10 | Home Health Agency |
| 20 | Skilled Nursing Facility |
| 40 | Outpatient |
| 50 | Hospice |
| 60 | Inpatient |

---

## CCLF4 — Part A Diagnosis Codes

One row per diagnosis per institutional claim. Each CCLF1 claim will have between 3 and 12 diagnosis rows depending on patient complexity.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `cur_clm_uniq_id` | STRING | NO | FK to CCLF1, links diagnosis to claim |
| `bene_mbi_id` | STRING | NO | Patient ID, FK to CCLF8 |
| `clm_dgns_cd` | STRING | NO | ICD-10 diagnosis code |
| `clm_val_sqnc_num` | INT64 | NO | Diagnosis sequence number, 1=primary |
| `clm_prod_type_cd` | STRING | NO | Principal, Secondary, Admitting, External_Cause |
| `clm_from_dt` | DATE | NO | Claim start date, denormalized for query convenience |
| `clm_thru_dt` | DATE | NO | Claim end date, denormalized |
| `clm_poa_ind` | STRING | YES | Present on admission: Y, N, U, W — NULL for non-inpatient |
| `dgns_prcdr_icd_ind` | STRING | NO | ICD version, 0=ICD-10 |
| `hcc_category` | STRING | YES | Simulated HCC category label, NULL if not HCC-mapped |
| `hcc_weight` | FLOAT64 | YES | Simulated HCC risk weight, NULL if not HCC-mapped |
| `chronic_condition_flag` | BOOLEAN | NO | Whether diagnosis represents a chronic condition |
| `high_value_hcc_flag` | BOOLEAN | NO | Whether diagnosis strongly affects risk score |
| `suspected_unsupported_dx_flag` | BOOLEAN | NO | Simulated flag for diagnosis lacking clinical support |

### Business Rules
- `clm_poa_ind` is NULL for all non-inpatient claim types
- `clm_val_sqnc_num` = 1 always corresponds to the principal diagnosis
- `hcc_weight` is NULL when `hcc_category` is NULL
- `suspected_unsupported_dx_flag` is used for coding intensity and fraud analysis
- Dates are denormalized from CCLF1 for query performance

### CLM_PROD_TYPE_CD Values
| Value | Meaning |
|---|---|
| Principal | Primary reason for admission or visit |
| Secondary | Additional conditions affecting care |
| Admitting | Diagnosis at time of admission |
| External_Cause | Cause of injury or external event |

---

## CCLF5 — Part B Physician Claim Lines

One row per service line within a professional claim. A single claim can have multiple lines representing different procedures on the same date.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `cur_clm_uniq_id` | STRING | NO | Claim ID, FK groups lines into claims |
| `clm_line_num` | INT64 | NO | Line number within claim, starts at 1 |
| `bene_mbi_id` | STRING | NO | Patient ID, FK to CCLF8 |
| `provider_id` | STRING | NO | Physician/provider ID, FK to provider_dim |
| `clm_from_dt` | DATE | NO | Claim start date |
| `clm_thru_dt` | DATE | NO | Claim end date |
| `clm_line_from_dt` | DATE | NO | Line-level service date |
| `clm_line_dgns_cd` | STRING | YES | Line-level diagnosis code |
| `clm_dgns_1_cd` | STRING | YES | Claim-level diagnosis 1, primary |
| `clm_dgns_2_cd` | STRING | YES | Claim-level diagnosis 2 |
| `clm_dgns_3_cd` | STRING | YES | Claim-level diagnosis 3 |
| `clm_dgns_4_cd` | STRING | YES | Claim-level diagnosis 4 |
| `clm_line_hcpcs_cd` | STRING | NO | CPT/HCPCS procedure code |
| `clm_carr_pmt_dnl_cd` | STRING | YES | Denial code, NULL means paid |
| `clm_adjsmt_type_cd` | STRING | NO | 0=original, 1=cancel, 2=adjustment |
| `clm_orig_clm_id` | STRING | YES | Original claim ID for adjustments, NULL for originals |
| `dgns_prcdr_icd_ind` | STRING | NO | ICD version, 0=ICD-10 |
| `line_allowed_amt` | FLOAT64 | NO | Allowed amount for this line |
| `line_paid_amt` | FLOAT64 | NO | Actual paid amount, negative for reversals |
| `units_of_service` | INT64 | NO | Number of units billed on this line |
| `place_of_service_cd` | STRING | NO | 11=Office, 21=Inpatient, 22=Outpatient, 02=Telehealth |
| `modifier_1` | STRING | YES | Procedure modifier, e.g. 25, 59, GT |
| `modifier_2` | STRING | YES | Second procedure modifier |
| `service_category` | STRING | NO | E/M, Imaging, Lab, Surgery, Telehealth, Injection, Pathology |
| `overpayment_flag` | BOOLEAN | NO | Whether line has simulated overpayment |
| `overpayment_amt` | FLOAT64 | NO | Simulated overpayment amount, 0.0 if none |
| `true_error_flag` | BOOLEAN | NO | Hidden ground truth label for ML and validation |
| `suspicious_pattern_flag` | BOOLEAN | NO | Whether line belongs to a suspicious billing pattern |

### Business Rules
- `clm_orig_clm_id` is NULL for original claims (clm_adjsmt_type_cd = 0)
- `line_paid_amt` may be negative for reversals
- `line_paid_amt` <= `line_allowed_amt` for paid claims
- `clm_carr_pmt_dnl_cd` is NULL for paid lines
- `true_error_flag` is internal only and should be excluded from auditor-facing analyses
- `service_category` is derived from `clm_line_hcpcs_cd` at generation time

### PLACE_OF_SERVICE_CD Values
| Code | Meaning |
|---|---|
| 02 | Telehealth |
| 11 | Office |
| 21 | Inpatient Hospital |
| 22 | Outpatient Hospital |
| 31 | Skilled Nursing Facility |
| 32 | Nursing Facility |

---

## CCLF8 — Beneficiary Demographics

One row per patient. Every claim in CCLF1 and CCLF5 joins back here via `bene_mbi_id`.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `bene_mbi_id` | STRING | NO | Patient ID, primary key |
| `bene_dob` | DATE | NO | Date of birth |
| `bene_age` | INT64 | NO | Age in years, precomputed at data generation time |
| `bene_sex_cd` | STRING | NO | 1=Male, 2=Female |
| `bene_race_cd` | STRING | YES | 0=Unknown, 1=White, 2=Black, 3=Other, 4=Asian, 5=Hispanic, 6=Native American |
| `bene_mdcr_stus_cd` | STRING | NO | AGED, DISABLED, ESRD, AGED_ESRD |
| `bene_dual_stus_cd` | STRING | YES | NULL=not dual, 02=full dual, 04=partial dual |
| `bene_death_dt` | DATE | YES | Date of death, NULL if alive |
| `bene_orgnl_entlmt_rsn_cd` | STRING | NO | 0=AGED, 1=DISABLED, 2=ESRD |
| `bene_entlmt_buyin_ind` | STRING | NO | 1=Part A only, 3=Part A and B |
| `bene_part_a_enrlmt_bgn_dt` | DATE | NO | Part A enrollment start date |
| `bene_part_b_enrlmt_bgn_dt` | DATE | YES | Part B enrollment start date, NULL if Part A only |
| `region` | STRING | NO | Northeast, Southeast, Midwest, Southwest, West |
| `state` | STRING | NO | Simulated US state abbreviation |
| `county` | STRING | YES | Simulated county name, nullable for data quality simulation |
| `risk_score` | FLOAT64 | NO | Simulated HCC-based risk score, correlated with but not equal to diagnosis burden |
| `chronic_condition_count` | INT64 | NO | Count of distinct chronic conditions |
| `ma_plan_flag` | BOOLEAN | NO | Whether patient is Medicare Advantage-like |
| `high_risk_patient_flag` | BOOLEAN | NO | Whether patient is flagged as high risk |
| `utilization_segment` | STRING | NO | Low, Medium, High |
| `low_income_subsidy_flag` | BOOLEAN | NO | Whether patient receives low income subsidy |
| `annual_cost_bucket` | STRING | NO | Low_Cost, Medium_Cost, High_Cost, Catastrophic |

### Business Rules
- `bene_death_dt` NULL means patient is alive
- `bene_age` is computed from `bene_dob` at generation time against a fixed reference date
- `risk_score` is correlated with `chronic_condition_count` and HCC weights but intentionally diverges to simulate coding intensity
- `ma_plan_flag` = TRUE patients will have higher average diagnosis counts and risk scores
- `county` is intentionally NULL for approximately 5% of patients to simulate data quality issues
- `bene_race_cd` is intentionally NULL for approximately 3% of patients to simulate missingness

### Annual Cost Bucket Thresholds (Approximate)
| Bucket | Annual Payment Range |
|---|---|
| Low_Cost | < $5,000 |
| Medium_Cost | $5,000 – $25,000 |
| High_Cost | $25,000 – $100,000 |
| Catastrophic | > $100,000 |

---

## Provider Dimension

One row per provider. Every claim in CCLF1 and CCLF5 joins back here via `provider_id`.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `provider_id` | STRING | NO | Provider ID, primary key |
| `provider_name` | STRING | NO | Simulated provider name |
| `provider_type` | STRING | NO | Hospital, Physician, SNF, HHA, Hospice, Outpatient_Facility |
| `specialty` | STRING | YES | Cardiology, Primary_Care, Oncology, Orthopedics, Neurology, etc. NULL for facility types |
| `region` | STRING | NO | Northeast, Southeast, Midwest, Southwest, West |
| `state` | STRING | NO | Simulated US state abbreviation |
| `peer_group` | STRING | NO | See peer group values below |
| `provider_risk_profile` | STRING | NO | Normal, High_Volume, Suspicious, Outlier, Emerging |
| `ownership_type` | STRING | NO | Nonprofit, For_Profit, Government |
| `bed_size` | INT64 | YES | Number of beds, populated for hospitals and SNFs only |
| `years_active` | INT64 | NO | Simulated years the provider has been operating |
| `urban_rural_flag` | STRING | NO | Urban, Suburban, Rural |
| `active_flag` | BOOLEAN | NO | Whether provider is currently active |

### Business Rules
- `specialty` is NULL for facility-type providers (SNF, HHA, Hospice, Hospital)
- `bed_size` is NULL for non-facility providers
- `provider_risk_profile` is seeded at generation time and drives injected anomaly patterns
- Suspicious and Outlier providers will have injected billing anomalies in CCLF1 and CCLF5
- Emerging providers will have sparse claim history and unstable utilization patterns

### Peer Group Values
| Value | Description |
|---|---|
| Cardiology_Physician_Group | Cardiology specialist physicians |
| PrimaryCare_Physician_Group | Primary care and family medicine physicians |
| Large_Inpatient_Hospital | Large hospital facilities |
| Small_Community_Hospital | Small and critical access hospitals |
| SNF_Facility | Skilled nursing facilities |
| Home_Health_Agency | Home health agencies |
| Oncology_Physician_Group | Oncology specialist physicians |
| Orthopedics_Physician_Group | Orthopedic specialist physicians |
| Outpatient_Facility_Group | Outpatient facility providers |

### Provider Risk Profile Behaviors
| Profile | Behavior |
|---|---|
| Normal | Realistic billing within peer norms |
| High_Volume | Above average claim volume but otherwise normal |
| Suspicious | Injected anomalies: duplicate patterns, unusual CPT mix, high denial rate |
| Outlier | Extreme payment outliers, impossible patterns, high unsupported diagnosis rate |
| Emerging | Sparse history, unstable utilization, limited peer comparison data |

---

## Procedure Code Reference

Static lookup table. One row per CPT/HCPCS code.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `hcpcs_cd` | STRING | NO | CPT/HCPCS procedure code, primary key |
| `procedure_desc` | STRING | NO | Human readable procedure description |
| `procedure_category` | STRING | NO | E/M, Imaging, Lab, Surgery, Telehealth, Injection, Pathology |
| `expected_allowed_amt` | FLOAT64 | NO | Expected normal allowed amount for benchmarking |
| `allowed_amt_std_dev` | FLOAT64 | NO | Standard deviation of allowed amount for outlier detection |
| `high_risk_billing_flag` | BOOLEAN | NO | Whether procedure is commonly flagged in audits |
| `typical_specialty` | STRING | YES | Most common provider specialty for this procedure |
| `inpatient_only_flag` | BOOLEAN | NO | Whether procedure is valid for inpatient claims only |

### Business Rules
- Used as a join target from CCLF5 `clm_line_hcpcs_cd`
- `expected_allowed_amt` and `allowed_amt_std_dev` are used to compute z-scores for payment anomaly detection
- `high_risk_billing_flag` is used to prioritize audit sample selection
- `inpatient_only_flag` supports validation checks for impossible place-of-service combinations

---

## Diagnosis Reference

Static lookup table. One row per ICD-10 diagnosis code.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `icd10_cd` | STRING | NO | ICD-10 diagnosis code, primary key |
| `diagnosis_desc` | STRING | NO | Human readable diagnosis description |
| `hcc_category` | STRING | YES | Simulated HCC category label, NULL if not HCC-mapped |
| `hcc_weight` | FLOAT64 | YES | Simulated HCC risk weight, NULL if not HCC-mapped |
| `chronic_flag` | BOOLEAN | NO | Whether diagnosis represents a chronic condition |
| `high_value_hcc_flag` | BOOLEAN | NO | Whether diagnosis strongly affects risk score |
| `expected_care_pattern` | STRING | YES | Labs, Medications, Specialist_Visit, Imaging |
| `body_system` | STRING | NO | Cardiovascular, Endocrine, Respiratory, Musculoskeletal, Neurological, etc. |

### Business Rules
- Used as a join target from CCLF4 `clm_dgns_cd`
- `hcc_weight` is NULL when `hcc_category` is NULL
- `expected_care_pattern` is used in unsupported diagnosis detection logic
- A diagnosis is flagged as unsupported when `high_value_hcc_flag` is TRUE but no matching `expected_care_pattern` claims exist for that patient

---

## Audit Sample Table

One row per claim included in an audit sample. Central to extrapolation simulation and sample fairness analysis.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `sample_id` | STRING | NO | Unique sample identifier, primary key |
| `sample_name` | STRING | NO | Human readable sample name for dashboard display |
| `sample_type` | STRING | NO | Random, Biased_High_Cost, Biased_Provider, Biased_Claim_Type, Stratified |
| `cur_clm_uniq_id` | STRING | NO | FK to CCLF1 or CCLF5 claim |
| `claim_source` | STRING | NO | Part_A or Part_B |
| `bene_mbi_id` | STRING | NO | Patient ID for convenience joins |
| `provider_id` | STRING | NO | Provider ID for convenience joins |
| `clm_pmt_amt` | FLOAT64 | NO | Payment amount at time of sampling, denormalized |
| `sample_date` | DATE | NO | Date sample was selected |
| `review_result` | STRING | YES | Correct, Overpaid, Denied, Unsupported — NULL if not yet reviewed |
| `reviewed_overpayment_amt` | FLOAT64 | YES | Overpayment amount found during audit, NULL if not reviewed |
| `review_notes` | STRING | YES | Simulated audit notes |
| `sample_selection_reason` | STRING | NO | Random, High_Cost_Trigger, Provider_Outlier, Denial_Pattern, Diagnosis_Pattern, Utilization_Spike |
| `extrapolation_universe_size` | INT64 | NO | Total claim count in the population this sample represents |
| `extrapolation_universe_amt` | FLOAT64 | NO | Total payment amount in the population this sample represents |

### Business Rules
- Each `sample_id` represents one audit sample run, containing multiple claims
- `extrapolation_universe_size` and `extrapolation_universe_amt` are snapshot values at sampling time
- Extrapolated overpayment = (reviewed_overpayment_amt / clm_pmt_amt) * extrapolation_universe_amt
- `review_result` NULL means claim has been sampled but not yet reviewed
- Multiple sample types can exist simultaneously for comparison analysis
- `clm_pmt_amt` is denormalized to preserve the payment value at sampling time independent of later adjustments

---

## Table Relationships

```
CCLF8 (bene_mbi_id)
  ├── CCLF1 (bene_mbi_id, provider_id)
  │     └── CCLF4 (cur_clm_uniq_id, bene_mbi_id)
  └── CCLF5 (bene_mbi_id, provider_id)

provider_dim (provider_id)
  ├── CCLF1 (provider_id)
  └── CCLF5 (provider_id)

procedure_ref (hcpcs_cd)
  └── CCLF5 (clm_line_hcpcs_cd)

diagnosis_ref (icd10_cd)
  └── CCLF4 (clm_dgns_cd)

audit_sample (cur_clm_uniq_id)
  ├── CCLF1 (cur_clm_uniq_id) when claim_source = Part_A
  └── CCLF5 (cur_clm_uniq_id) when claim_source = Part_B
```

---

## Injected Data Quality Issues

The following issues are intentionally injected to simulate real-world CMS data problems.

| Issue | Table | Approximate Rate |
|---|---|---|
| NULL county | CCLF8 | ~5% of patients |
| NULL race code | CCLF8 | ~3% of patients |
| Negative payment amounts | CCLF1, CCLF5 | ~2–3% of claims |
| Duplicate claim lines | CCLF5 | ~1–2% of lines |
| Adjustment/cancellation chains | CCLF1, CCLF5 | ~5% of claims |
| Suspected unsupported diagnoses | CCLF4 | ~3–5% of diagnosis rows |
| Suspicious billing patterns | CCLF5 | Concentrated in Suspicious/Outlier providers |
| Missing denial codes on denied claims | CCLF1, CCLF5 | ~1% of denied claims |

---

*Last updated: Session 2 — Schema Finalization*
*Status: All tables finalized for Version 1*