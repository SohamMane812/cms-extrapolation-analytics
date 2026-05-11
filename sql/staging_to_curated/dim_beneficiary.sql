-- =============================================================================
-- dim_beneficiary.sql
-- Clean beneficiary dimension for analytics consumption.
--
-- Source  : {staging}.stg_cclf8_beneficiary
-- Target  : {curated}.dim_beneficiary
--
-- Design principles:
--   - Business-friendly column names
--   - Pre-computed derived fields for common dashboard filters
--   - Stable patient segmentation attributes
-- =============================================================================

CREATE OR REPLACE TABLE {curated}.dim_beneficiary
CLUSTER BY region, utilization_segment
AS

SELECT
    -- Primary key
    bene_mbi_id                         AS patient_id,

    -- Demographics
    bene_dob                            AS date_of_birth,
    bene_age                            AS age,
    age_bucket,
    CASE bene_sex_cd
        WHEN '1' THEN 'Male'
        WHEN '2' THEN 'Female'
        ELSE 'Unknown'
    END                                 AS sex,
    CASE bene_race_cd
        WHEN '1' THEN 'White'
        WHEN '2' THEN 'Black'
        WHEN '3' THEN 'Other'
        WHEN '4' THEN 'Asian'
        WHEN '5' THEN 'Hispanic'
        WHEN '6' THEN 'Native American'
        ELSE 'Unknown'
    END                                 AS race,
    CASE WHEN bene_race_cd IS NULL
        THEN TRUE ELSE FALSE
    END                                 AS race_unknown,

    -- Medicare enrollment
    bene_mdcr_stus_cd                   AS medicare_status,
    CASE bene_orgnl_entlmt_rsn_cd
        WHEN '0' THEN 'Aged'
        WHEN '1' THEN 'Disabled'
        WHEN '2' THEN 'ESRD'
        ELSE 'Unknown'
    END                                 AS entitlement_reason,
    has_part_b,
    bene_part_a_enrlmt_bgn_dt           AS part_a_start_date,
    bene_part_b_enrlmt_bgn_dt           AS part_b_start_date,

    -- Eligibility flags
    dual_eligibility_label,
    CASE WHEN bene_dual_stus_cd IS NOT NULL
        THEN TRUE ELSE FALSE
    END                                 AS is_dual_eligible,
    ma_plan_flag                        AS is_ma_plan,
    low_income_subsidy_flag             AS has_low_income_subsidy,

    -- Mortality
    is_deceased,
    bene_death_dt                       AS death_date,

    -- Geography
    region,
    state,
    county,
    CASE WHEN county IS NULL
        THEN TRUE ELSE FALSE
    END                                 AS county_unknown,

    -- Risk and utilization
    risk_score,
    chronic_condition_count,
    utilization_segment,
    high_risk_patient_flag              AS is_high_risk,
    annual_cost_bucket,

    -- Data quality flags carried forward for transparency
    county_missing,
    race_missing,

    stg_loaded_at                       AS loaded_at

FROM {staging}.stg_cclf8_beneficiary
