-- =============================================================================
-- stg_data_quality_issues.sql
-- Centralized data quality issue log for all staging tables.
--
-- Source  : All staging tables
-- Target  : {staging}.stg_data_quality_issues
--
-- Collects all flagged data quality issues across tables into a single
-- audit log. Each row represents one issue on one record.
--
-- This table feeds:
--   - Data Quality Monitor dashboard page
--   - data_quality_summary analytics table
--   - EDA notebook data quality section
-- =============================================================================

CREATE OR REPLACE TABLE {staging}.stg_data_quality_issues
AS

-- -------------------------------------------------------------------------
-- CCLF1 issues
-- -------------------------------------------------------------------------

SELECT
    'cclf1'                  AS source_table,
    cur_clm_uniq_id          AS record_id,
    bene_mbi_id,
    provider_id,
    clm_from_dt              AS record_date,
    'invalid_date_range'     AS issue_type,
    'clm_thru_dt is before clm_from_dt' AS issue_description,
    CAST(NULL AS FLOAT64)    AS numeric_value,
    CURRENT_TIMESTAMP()      AS logged_at
FROM {staging}.stg_cclf1_claims_header
WHERE invalid_date_range = TRUE

UNION ALL

SELECT
    'cclf1',
    cur_clm_uniq_id,
    bene_mbi_id,
    provider_id,
    clm_from_dt,
    'drg_on_non_inpatient',
    'DRG code present on non-inpatient claim',
    NULL,
    CURRENT_TIMESTAMP()
FROM {staging}.stg_cclf1_claims_header
WHERE drg_on_non_inpatient = TRUE

UNION ALL

SELECT
    'cclf1',
    cur_clm_uniq_id,
    bene_mbi_id,
    provider_id,
    clm_from_dt,
    'denied_nonzero_payment',
    'Denied claim has non-zero payment amount',
    clm_pmt_amt,
    CURRENT_TIMESTAMP()
FROM {staging}.stg_cclf1_claims_header
WHERE denied_nonzero_payment = TRUE

-- -------------------------------------------------------------------------
-- CCLF4 issues
-- -------------------------------------------------------------------------

UNION ALL

SELECT
    'cclf4',
    cur_clm_uniq_id,
    bene_mbi_id,
    NULL AS provider_id,
    clm_from_dt,
    'invalid_icd10_code',
    CONCAT('ICD-10 code not in reference table: ', clm_dgns_cd),
    NULL,
    CURRENT_TIMESTAMP()
FROM {staging}.stg_cclf4_diagnosis
WHERE is_valid_icd10 = FALSE

UNION ALL

SELECT
    'cclf4',
    cur_clm_uniq_id,
    bene_mbi_id,
    NULL,
    clm_from_dt,
    'hcc_cat_missing_weight',
    'HCC category present but hcc_weight is null',
    NULL,
    CURRENT_TIMESTAMP()
FROM {staging}.stg_cclf4_diagnosis
WHERE hcc_cat_missing_weight = TRUE

UNION ALL

SELECT
    'cclf4',
    cur_clm_uniq_id,
    bene_mbi_id,
    NULL,
    clm_from_dt,
    'poa_on_non_inpatient',
    'POA indicator present on non-inpatient claim',
    NULL,
    CURRENT_TIMESTAMP()
FROM {staging}.stg_cclf4_diagnosis
WHERE poa_on_non_inpatient = TRUE

-- -------------------------------------------------------------------------
-- CCLF5 issues
-- -------------------------------------------------------------------------

UNION ALL

SELECT
    'cclf5',
    cur_clm_uniq_id,
    bene_mbi_id,
    provider_id,
    clm_from_dt,
    'invalid_hcpcs_code',
    CONCAT('HCPCS code not in reference table: ', clm_line_hcpcs_cd),
    NULL,
    CURRENT_TIMESTAMP()
FROM {staging}.stg_cclf5_physician
WHERE is_valid_hcpcs = FALSE

UNION ALL

SELECT
    'cclf5',
    cur_clm_uniq_id,
    bene_mbi_id,
    provider_id,
    clm_from_dt,
    'paid_exceeds_allowed',
    'Line paid amount exceeds allowed amount',
    line_paid_amt - line_allowed_amt,
    CURRENT_TIMESTAMP()
FROM {staging}.stg_cclf5_physician
WHERE paid_exceeds_allowed = TRUE

UNION ALL

SELECT
    'cclf5',
    cur_clm_uniq_id,
    bene_mbi_id,
    provider_id,
    clm_from_dt,
    'denied_nonzero_paid',
    'Denied line has non-zero paid amount',
    line_paid_amt,
    CURRENT_TIMESTAMP()
FROM {staging}.stg_cclf5_physician
WHERE denied_nonzero_paid = TRUE

UNION ALL

SELECT
    'cclf5',
    cur_clm_uniq_id,
    bene_mbi_id,
    provider_id,
    clm_from_dt,
    'payment_outlier',
    CONCAT('Payment z-score: ', ROUND(payment_z_score, 2)),
    payment_z_score,
    CURRENT_TIMESTAMP()
FROM {staging}.stg_cclf5_physician
WHERE payment_outlier_flag = TRUE
  AND clm_adjsmt_type_cd = '0'

-- -------------------------------------------------------------------------
-- CCLF8 issues
-- -------------------------------------------------------------------------

UNION ALL

SELECT
    'cclf8',
    bene_mbi_id,
    bene_mbi_id,
    NULL,
    CAST(NULL AS DATE),
    'missing_county',
    'Beneficiary county is null',
    NULL,
    CURRENT_TIMESTAMP()
FROM {staging}.stg_cclf8_beneficiary
WHERE county_missing = TRUE

UNION ALL

SELECT
    'cclf8',
    bene_mbi_id,
    bene_mbi_id,
    NULL,
    CAST(NULL AS DATE),
    'missing_race',
    'Beneficiary race code is null',
    NULL,
    CURRENT_TIMESTAMP()
FROM {staging}.stg_cclf8_beneficiary
WHERE race_missing = TRUE

UNION ALL

SELECT
    'cclf8',
    bene_mbi_id,
    bene_mbi_id,
    NULL,
    CAST(NULL AS DATE),
    'part_ab_missing_partb_date',
    'Part A+B beneficiary missing Part B enrollment date',
    NULL,
    CURRENT_TIMESTAMP()
FROM {staging}.stg_cclf8_beneficiary
WHERE part_ab_missing_partb_date = TRUE
