-- =============================================================================
-- fact_part_a_claims.sql
-- Clean, analytics-ready Part A claims fact table.
--
-- Source  : {staging}.stg_cclf1_claims_header
-- Target  : {curated}.fact_part_a_claims
--
-- Filters applied:
--   - is_latest_version = TRUE  (deduplicated, no superseded originals)
--   - has_critical_null = FALSE (no records missing key fields)
--
-- Design principles:
--   - Business-friendly column names
--   - Pre-joined dimensional attributes for common queries
--   - Stable analytical flags for EDA, benchmarking, extrapolation
--   - Overpayment and audit fields ready for extrapolation simulator
-- =============================================================================

CREATE OR REPLACE TABLE {curated}.fact_part_a_claims
PARTITION BY claim_from_date
CLUSTER BY patient_id, provider_id
AS

WITH

clean_claims AS (
    SELECT *
    FROM {staging}.stg_cclf1_claims_header
    WHERE is_latest_version = TRUE
      AND has_critical_null = FALSE
),

-- Join provider attributes for denormalized convenience
prov AS (
    SELECT
        provider_id,
        provider_type,
        peer_group,
        provider_risk_profile,
        region        AS provider_region,
        urban_rural_flag
    FROM {staging}.stg_provider_dim
),

-- Join beneficiary attributes for common dashboard cuts
bene AS (
    SELECT
        bene_mbi_id,
        bene_age,
        age_bucket,
        bene_sex_cd,
        bene_race_cd,
        utilization_segment,
        ma_plan_flag,
        risk_score,
        chronic_condition_count,
        annual_cost_bucket,
        region        AS patient_region,
        dual_eligibility_label
    FROM {staging}.stg_cclf8_beneficiary
)

SELECT
    -- -----------------------------------------------------------------------
    -- Keys
    -- -----------------------------------------------------------------------
    c.cur_clm_uniq_id                   AS claim_id,
    c.bene_mbi_id                       AS patient_id,
    c.provider_id,
    c.chain_root_id,

    -- -----------------------------------------------------------------------
    -- Claim classification
    -- -----------------------------------------------------------------------
    c.clm_type_cd                       AS claim_type_code,
    CASE c.clm_type_cd
        WHEN '60' THEN 'Inpatient'
        WHEN '40' THEN 'Outpatient'
        WHEN '20' THEN 'SNF'
        WHEN '10' THEN 'Home Health'
        WHEN '50' THEN 'Hospice'
        ELSE 'Other'
    END                                 AS claim_type,
    c.facility_type,
    c.claim_status,
    c.clm_adjsmt_type_cd                AS adjustment_type,
    c.is_paid,
    c.is_denied,

    -- -----------------------------------------------------------------------
    -- Dates and time dimensions
    -- -----------------------------------------------------------------------
    c.clm_from_dt                       AS claim_from_date,
    c.clm_thru_dt                       AS claim_thru_date,
    c.claim_year,
    c.claim_month,
    c.claim_quarter,
    c.claim_year_month,
    c.claim_span_days,

    -- -----------------------------------------------------------------------
    -- Payment
    -- -----------------------------------------------------------------------
    c.clm_pmt_amt                       AS payment_amount,
    c.clm_mdcr_npmt_rsn_cd              AS denial_reason_code,

    -- -----------------------------------------------------------------------
    -- Inpatient-specific
    -- -----------------------------------------------------------------------
    c.drg_cd                            AS drg_code,
    c.length_of_stay,

    -- -----------------------------------------------------------------------
    -- Overpayment and audit fields
    -- -----------------------------------------------------------------------
    c.overpayment_flag                  AS has_overpayment,
    c.overpayment_amt                   AS overpayment_amount,
    c.audit_eligible_flag               AS is_audit_eligible,
    c.true_error_flag                   AS is_true_error,

    -- -----------------------------------------------------------------------
    -- Denormalized provider attributes
    -- -----------------------------------------------------------------------
    p.provider_type,
    p.peer_group,
    p.provider_risk_profile,
    p.provider_region,
    p.urban_rural_flag                  AS provider_urban_rural,

    -- -----------------------------------------------------------------------
    -- Denormalized patient attributes
    -- -----------------------------------------------------------------------
    b.bene_age                          AS patient_age,
    b.age_bucket                        AS patient_age_bucket,
    b.bene_sex_cd                       AS patient_sex,
    b.bene_race_cd                      AS patient_race,
    b.utilization_segment               AS patient_utilization_segment,
    b.ma_plan_flag                      AS patient_is_ma,
    b.risk_score                        AS patient_risk_score,
    b.chronic_condition_count           AS patient_chronic_count,
    b.annual_cost_bucket                AS patient_cost_bucket,
    b.patient_region,
    b.dual_eligibility_label            AS patient_dual_status,

    -- -----------------------------------------------------------------------
    -- Metadata
    -- -----------------------------------------------------------------------
    c.stg_loaded_at                     AS loaded_at

FROM clean_claims c
LEFT JOIN prov p ON p.provider_id = c.provider_id
LEFT JOIN bene b ON b.bene_mbi_id = c.bene_mbi_id
