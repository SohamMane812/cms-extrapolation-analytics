-- =============================================================================
-- coding_intensity_summary.sql
-- Diagnosis capture and HCC trend analysis for coding intensity detection.
--
-- Source  : {curated}.fact_diagnoses
--           {curated}.dim_beneficiary
--           {analytics}.patient_risk_summary
-- Target  : {analytics}.coding_intensity_summary
--
-- Used by: Risk Adjustment dashboard, EDA notebook 02
--
-- Core question: Are MA-like patients coded with more diagnoses than
-- clinically similar non-MA patients? Is risk score increasing without
-- matching utilization increases?
-- =============================================================================

CREATE OR REPLACE TABLE {analytics}.coding_intensity_summary
AS

WITH

-- -------------------------------------------------------------------------
-- Per-patient per-year diagnosis burden
-- -------------------------------------------------------------------------
patient_year_dx AS (
    SELECT
        patient_id,
        claim_year,
        COUNT(*)                            AS dx_count,
        COUNTIF(is_hcc_mapped)              AS hcc_count,
        COUNTIF(is_chronic)                 AS chronic_count,
        COUNTIF(is_high_value_hcc)          AS high_value_count,
        COUNTIF(is_suspected_unsupported)   AS unsupported_count,
        SUM(COALESCE(hcc_weight, 0))        AS total_hcc_weight
    FROM {curated}.fact_diagnoses
    GROUP BY 1, 2
),

-- -------------------------------------------------------------------------
-- Join patient demographics for MA flag and utilization segment
-- -------------------------------------------------------------------------
patient_year_enriched AS (
    SELECT
        py.*,
        b.is_ma_plan,
        b.utilization_segment,
        b.annual_cost_bucket,
        b.risk_score,
        prs.total_combined_paid,
        prs.total_part_a_claims
    FROM patient_year_dx py
    JOIN {curated}.dim_beneficiary b
        ON b.patient_id = py.patient_id
    LEFT JOIN {analytics}.patient_risk_summary prs
        ON prs.patient_id = py.patient_id
),

-- -------------------------------------------------------------------------
-- Annual diagnosis capture trends grouped by MA flag and utilization
-- -------------------------------------------------------------------------
annual_dx_trend AS (
    SELECT
        claim_year,
        is_ma_plan,
        utilization_segment,
        annual_cost_bucket,

        COUNT(DISTINCT patient_id)              AS distinct_patients,
        SUM(dx_count)                           AS total_diagnosis_rows,
        AVG(dx_count)                           AS avg_diagnoses_per_patient,
        AVG(hcc_count)                          AS avg_hcc_diagnoses_per_patient,
        AVG(chronic_count)                      AS avg_chronic_per_patient,
        AVG(high_value_count)                   AS avg_high_value_hcc_per_patient,
        AVG(unsupported_count)                  AS avg_unsupported_per_patient,
        AVG(total_hcc_weight)                   AS avg_hcc_weight_per_patient,

        SAFE_DIVIDE(
            SUM(unsupported_count), SUM(dx_count)
        )                                       AS unsupported_dx_rate,

        SAFE_DIVIDE(
            SUM(high_value_count), SUM(dx_count)
        )                                       AS high_value_hcc_rate,

        -- Risk and utilization signals
        AVG(risk_score)                         AS avg_risk_score,
        AVG(total_combined_paid)                AS avg_combined_paid,
        AVG(CAST(total_part_a_claims AS FLOAT64)) AS avg_part_a_claims,

        -- Coding intensity signal: high risk relative to actual spend
        SAFE_DIVIDE(
            AVG(risk_score),
            NULLIF(AVG(total_combined_paid), 0)
        ) * 10000                               AS risk_per_10k_paid

    FROM patient_year_enriched
    GROUP BY 1, 2, 3, 4
)

SELECT
    *,
    CURRENT_TIMESTAMP()                         AS computed_at
FROM annual_dx_trend
ORDER BY claim_year, is_ma_plan, utilization_segment
