-- =============================================================================
-- stg_cclf4_diagnosis.sql
-- Staging transformation for Part A diagnosis codes table.
--
-- Source  : {raw}.raw_cclf4_diagnosis
-- Target  : {staging}.stg_cclf4_diagnosis
--
-- Transformations applied:
--   - Join to staging claims to inherit is_latest_version flag
--   - Only retain diagnoses for original claims (not adj/cancel)
--   - Validate ICD-10 codes against diagnosis reference
--   - Add HCC summary flags for risk adjustment queries
--   - Add diagnosis rank categories for analytics
-- =============================================================================

CREATE OR REPLACE TABLE {staging}.stg_cclf4_diagnosis
PARTITION BY clm_from_dt
CLUSTER BY bene_mbi_id, clm_dgns_cd
AS

WITH

source AS (
    SELECT * FROM {raw}.raw_cclf4_diagnosis
),

-- Only diagnoses on original claims (adj/cancel don't have diagnosis rows)
staging_claims AS (
    SELECT
        cur_clm_uniq_id,
        clm_type_cd,
        is_latest_version,
        is_paid,
        claim_year,
        claim_month,
        claim_quarter,
        claim_year_month
    FROM {staging}.stg_cclf1_claims_header
    WHERE clm_adjsmt_type_cd = '0'
),

-- Validate codes against diagnosis reference
dx_ref AS (
    SELECT icd10_cd FROM {raw}.raw_diagnosis_ref
),

enriched AS (
    SELECT
        s.cur_clm_uniq_id,
        s.bene_mbi_id,
        s.clm_dgns_cd,
        s.clm_val_sqnc_num,
        s.clm_prod_type_cd,
        s.clm_from_dt,
        s.clm_thru_dt,
        s.clm_poa_ind,
        s.dgns_prcdr_icd_ind,
        s.hcc_category,
        s.hcc_weight,
        s.chronic_condition_flag,
        s.high_value_hcc_flag,
        s.suspected_unsupported_dx_flag,

        -- Inherit claim context from staging
        c.clm_type_cd,
        c.is_latest_version,
        c.is_paid,
        c.claim_year,
        c.claim_month,
        c.claim_quarter,
        c.claim_year_month,

        -- Derived: is this the principal diagnosis?
        CASE WHEN s.clm_val_sqnc_num = 1 THEN TRUE ELSE FALSE END AS is_principal_dx,

        -- Derived: is this an HCC-mapped diagnosis?
        CASE WHEN s.hcc_category IS NOT NULL THEN TRUE ELSE FALSE END AS is_hcc_mapped,

        -- Derived: is this a validated code (exists in reference table)?
        CASE WHEN dr.icd10_cd IS NOT NULL THEN TRUE ELSE FALSE END AS is_valid_icd10,

        -- Data quality flags
        CASE
            WHEN s.cur_clm_uniq_id IS NULL  THEN TRUE
            WHEN s.bene_mbi_id IS NULL      THEN TRUE
            WHEN s.clm_dgns_cd IS NULL      THEN TRUE
            WHEN s.clm_val_sqnc_num IS NULL THEN TRUE
            ELSE FALSE
        END AS has_critical_null,

        CASE
            WHEN s.hcc_category IS NOT NULL AND s.hcc_weight IS NULL THEN TRUE
            ELSE FALSE
        END AS hcc_cat_missing_weight,

        CASE
            WHEN c.clm_type_cd != '60' AND s.clm_poa_ind IS NOT NULL THEN TRUE
            ELSE FALSE
        END AS poa_on_non_inpatient,

        CURRENT_TIMESTAMP() AS stg_loaded_at

    FROM source s

    -- Join to staging claims for context
    INNER JOIN staging_claims c
        ON c.cur_clm_uniq_id = s.cur_clm_uniq_id

    -- Left join to validate ICD codes
    LEFT JOIN dx_ref dr
        ON dr.icd10_cd = s.clm_dgns_cd
)

SELECT * FROM enriched
WHERE has_critical_null = FALSE
