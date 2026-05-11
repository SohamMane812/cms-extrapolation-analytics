-- =============================================================================
-- stg_cclf8_beneficiary.sql
-- Staging transformation for beneficiary demographics table.
--
-- Source  : {raw}.raw_cclf8_beneficiary
-- Target  : {staging}.stg_cclf8_beneficiary
--
-- Transformations applied:
--   - Validate required fields
--   - Compute age bucket for analytics convenience
--   - Standardize dual eligibility display
--   - Flag known intentional missingness vs unexpected nulls
--   - Add data quality indicators
-- =============================================================================

CREATE OR REPLACE TABLE {staging}.stg_cclf8_beneficiary
CLUSTER BY region, utilization_segment
AS

WITH

source AS (
    SELECT * FROM {raw}.raw_cclf8_beneficiary
),

enriched AS (
    SELECT
        bene_mbi_id,
        bene_dob,
        bene_age,
        bene_sex_cd,
        bene_race_cd,
        bene_mdcr_stus_cd,
        bene_dual_stus_cd,
        bene_death_dt,
        bene_orgnl_entlmt_rsn_cd,
        bene_entlmt_buyin_ind,
        bene_part_a_enrlmt_bgn_dt,
        bene_part_b_enrlmt_bgn_dt,
        region,
        state,
        county,
        risk_score,
        chronic_condition_count,
        ma_plan_flag,
        high_risk_patient_flag,
        utilization_segment,
        low_income_subsidy_flag,
        annual_cost_bucket,

        -- Derived: age bucket for dashboard and cohort queries
        CASE
            WHEN bene_age BETWEEN 65 AND 69 THEN '65-69'
            WHEN bene_age BETWEEN 70 AND 74 THEN '70-74'
            WHEN bene_age BETWEEN 75 AND 79 THEN '75-79'
            WHEN bene_age BETWEEN 80 AND 84 THEN '80-84'
            WHEN bene_age >= 85             THEN '85+'
            ELSE 'Unknown'
        END AS age_bucket,

        -- Derived: deceased flag for cohort filtering
        CASE WHEN bene_death_dt IS NOT NULL THEN TRUE ELSE FALSE END AS is_deceased,

        -- Derived: dual eligibility label
        CASE
            WHEN bene_dual_stus_cd = '02' THEN 'Full Dual'
            WHEN bene_dual_stus_cd = '04' THEN 'Partial Dual'
            ELSE 'Not Dual'
        END AS dual_eligibility_label,

        -- Derived: Part B enrolled flag
        CASE
            WHEN bene_entlmt_buyin_ind = '3' THEN TRUE
            ELSE FALSE
        END AS has_part_b,

        -- Data quality flags
        CASE WHEN county IS NULL     THEN TRUE ELSE FALSE END AS county_missing,
        CASE WHEN bene_race_cd IS NULL THEN TRUE ELSE FALSE END AS race_missing,

        CASE
            WHEN bene_mbi_id IS NULL          THEN TRUE
            WHEN bene_dob IS NULL             THEN TRUE
            WHEN bene_age IS NULL             THEN TRUE
            WHEN bene_mdcr_stus_cd IS NULL    THEN TRUE
            WHEN risk_score IS NULL           THEN TRUE
            WHEN utilization_segment IS NULL  THEN TRUE
            ELSE FALSE
        END AS has_critical_null,

        CASE
            WHEN bene_age < 65 OR bene_age > 95 THEN TRUE
            ELSE FALSE
        END AS age_out_of_range,

        CASE
            WHEN bene_entlmt_buyin_ind = '3'
             AND bene_part_b_enrlmt_bgn_dt IS NULL
            THEN TRUE
            ELSE FALSE
        END AS part_ab_missing_partb_date,

        CURRENT_TIMESTAMP() AS stg_loaded_at

    FROM source
)

SELECT * FROM enriched
WHERE has_critical_null = FALSE
  AND age_out_of_range  = FALSE
  