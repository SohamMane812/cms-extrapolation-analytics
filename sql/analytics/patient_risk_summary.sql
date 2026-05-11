-- =============================================================================
-- patient_risk_summary.sql
-- Patient-level risk, utilization, and cost summary for EDA and dashboards.
--
-- Source  : {curated}.fact_part_a_claims
--           {curated}.fact_part_b_claim_lines
--           {curated}.fact_diagnoses
--           {curated}.dim_beneficiary
-- Target  : {analytics}.patient_risk_summary
--
-- Used by: Risk Adjustment dashboard, EDA notebook 02
-- =============================================================================

CREATE OR REPLACE TABLE {analytics}.patient_risk_summary
AS

WITH

part_a_stats AS (
    SELECT
        patient_id,
        COUNT(*)                                AS total_part_a_claims,
        COUNTIF(is_paid)                        AS paid_part_a_claims,
        SUM(CASE WHEN is_paid
                THEN payment_amount ELSE 0 END) AS total_part_a_paid,
        AVG(CASE WHEN is_paid
                THEN payment_amount END)        AS avg_part_a_payment,
        MAX(CASE WHEN is_paid
                THEN payment_amount END)        AS max_part_a_payment,
        SUM(overpayment_amount)                 AS total_overpayment,
        AVG(length_of_stay)                     AS avg_length_of_stay,
        COUNTIF(claim_type = 'Inpatient')       AS inpatient_admissions
    FROM {curated}.fact_part_a_claims
    GROUP BY 1
),

part_b_stats AS (
    SELECT
        patient_id,
        COUNT(*)                                AS total_part_b_lines,
        COUNT(DISTINCT claim_id)                AS total_part_b_claims,
        SUM(CASE WHEN is_paid
                THEN paid_amount ELSE 0 END)    AS total_part_b_paid,
        COUNTIF(is_telehealth)                  AS telehealth_visits,
        COUNT(DISTINCT provider_id)             AS distinct_providers_seen
    FROM {curated}.fact_part_b_claim_lines
    GROUP BY 1
),

dx_stats AS (
    SELECT
        patient_id,
        COUNT(DISTINCT diagnosis_code)          AS distinct_diagnoses,
        COUNTIF(is_hcc_mapped)                  AS hcc_mapped_diagnoses,
        COUNTIF(is_chronic)                     AS chronic_diagnoses,
        COUNTIF(is_high_value_hcc)              AS high_value_hcc_diagnoses,
        COUNTIF(is_suspected_unsupported)       AS unsupported_diagnoses,
        SUM(COALESCE(hcc_weight, 0))            AS total_hcc_weight,
        COUNT(DISTINCT body_system)             AS distinct_body_systems
    FROM {curated}.fact_diagnoses
    GROUP BY 1
)

SELECT
    b.patient_id,

    -- Demographics
    b.age,
    b.age_bucket,
    b.sex,
    b.race,
    b.region,
    b.state,
    b.utilization_segment,
    b.is_ma_plan,
    b.is_dual_eligible,
    b.has_low_income_subsidy,
    b.is_high_risk,
    b.is_deceased,
    b.annual_cost_bucket,

    -- Risk
    b.risk_score,
    b.chronic_condition_count                   AS bene_chronic_count,

    -- Claim utilization
    COALESCE(a.total_part_a_claims, 0)          AS total_part_a_claims,
    COALESCE(a.paid_part_a_claims, 0)           AS paid_part_a_claims,
    COALESCE(a.inpatient_admissions, 0)         AS inpatient_admissions,
    COALESCE(b2.total_part_b_lines, 0)          AS total_part_b_lines,
    COALESCE(b2.total_part_b_claims, 0)         AS total_part_b_claims,
    COALESCE(b2.telehealth_visits, 0)           AS telehealth_visits,
    COALESCE(b2.distinct_providers_seen, 0)     AS distinct_providers_seen,

    -- Cost
    COALESCE(a.total_part_a_paid, 0)            AS total_part_a_paid,
    COALESCE(b2.total_part_b_paid, 0)           AS total_part_b_paid,
    COALESCE(a.total_part_a_paid, 0)
        + COALESCE(b2.total_part_b_paid, 0)    AS total_combined_paid,
    COALESCE(a.total_overpayment, 0)            AS total_overpayment_amt,
    a.avg_part_a_payment,
    a.max_part_a_payment,
    a.avg_length_of_stay,

    -- Diagnosis burden
    COALESCE(d.distinct_diagnoses, 0)           AS distinct_diagnoses,
    COALESCE(d.hcc_mapped_diagnoses, 0)         AS hcc_mapped_diagnoses,
    COALESCE(d.chronic_diagnoses, 0)            AS chronic_diagnoses,
    COALESCE(d.high_value_hcc_diagnoses, 0)     AS high_value_hcc_diagnoses,
    COALESCE(d.unsupported_diagnoses, 0)        AS unsupported_diagnoses,
    COALESCE(d.total_hcc_weight, 0)             AS total_hcc_weight,
    COALESCE(d.distinct_body_systems, 0)        AS distinct_body_systems,

    -- Coding intensity signal
    -- High risk score relative to actual diagnosis burden suggests coding inflation
    SAFE_DIVIDE(b.risk_score, NULLIF(d.distinct_diagnoses, 0))
                                                AS risk_score_per_diagnosis,
    SAFE_DIVIDE(b.risk_score, NULLIF(d.total_hcc_weight, 0))
                                                AS risk_score_per_hcc_weight,

    CURRENT_TIMESTAMP()                         AS computed_at

FROM {curated}.dim_beneficiary b
LEFT JOIN part_a_stats  a   ON a.patient_id  = b.patient_id
LEFT JOIN part_b_stats  b2  ON b2.patient_id = b.patient_id
LEFT JOIN dx_stats      d   ON d.patient_id  = b.patient_id
