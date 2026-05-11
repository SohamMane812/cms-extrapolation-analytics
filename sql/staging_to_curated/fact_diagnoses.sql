-- =============================================================================
-- fact_diagnoses.sql
-- Clean, analytics-ready Part A diagnosis fact table.
--
-- Source  : {staging}.stg_cclf4_diagnosis
-- Target  : {curated}.fact_diagnoses
--
-- Filters applied:
--   - is_latest_version = TRUE  (inherited from claim lineage)
--   - has_critical_null = FALSE
--
-- Design principles:
--   - Joined to diagnosis reference for HCC and clinical context
--   - Ready for risk adjustment analysis and coding intensity analysis
--   - Unsupported diagnosis patterns preserved and flagged clearly
-- =============================================================================

CREATE OR REPLACE TABLE {curated}.fact_diagnoses
PARTITION BY claim_from_date
CLUSTER BY patient_id, diagnosis_code
AS

WITH

clean_dx AS (
    SELECT *
    FROM {staging}.stg_cclf4_diagnosis
    WHERE is_latest_version = TRUE
      AND has_critical_null = FALSE
),

dx_ref AS (
    SELECT
        icd10_cd,
        diagnosis_desc,
        body_system,
        expected_care_pattern
    FROM {raw}.raw_diagnosis_ref
)

SELECT
    -- Keys
    d.cur_clm_uniq_id                   AS claim_id,
    d.bene_mbi_id                       AS patient_id,
    d.clm_dgns_cd                       AS diagnosis_code,
    d.clm_val_sqnc_num                  AS diagnosis_sequence,

    -- Diagnosis classification
    d.clm_prod_type_cd                  AS diagnosis_type,
    d.is_principal_dx,
    d.is_hcc_mapped,
    d.chronic_condition_flag            AS is_chronic,
    d.high_value_hcc_flag               AS is_high_value_hcc,
    d.suspected_unsupported_dx_flag     AS is_suspected_unsupported,

    -- HCC risk adjustment fields
    d.hcc_category,
    d.hcc_weight,

    -- Clinical reference context
    r.diagnosis_desc                    AS diagnosis_description,
    r.body_system,
    r.expected_care_pattern,

    -- Inpatient POA
    d.clm_poa_ind                       AS present_on_admission,
    d.clm_type_cd                       AS claim_type_code,

    -- Date dimensions
    d.clm_from_dt                       AS claim_from_date,
    d.clm_thru_dt                       AS claim_thru_date,
    d.claim_year,
    d.claim_month,
    d.claim_quarter,
    d.claim_year_month,

    -- Code validity
    d.is_valid_icd10,

    -- Metadata
    d.stg_loaded_at                     AS loaded_at

FROM clean_dx d
LEFT JOIN dx_ref r ON r.icd10_cd = d.clm_dgns_cd
