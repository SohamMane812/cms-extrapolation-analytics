-- =============================================================================
-- fact_part_b_claim_lines.sql
-- Clean, analytics-ready Part B physician claim lines fact table.
--
-- Source  : {staging}.stg_cclf5_physician
-- Target  : {curated}.fact_part_b_claim_lines
--
-- Filters applied:
--   - is_latest_version = TRUE
--   - has_critical_null = FALSE
--
-- Design principles:
--   - Payment z-scores pre-computed from staging
--   - Denormalized provider and patient attributes for dashboard queries
--   - Anomaly and suspicious pattern flags preserved for detection analysis
--   - Telehealth and service category ready for trend analysis
-- =============================================================================

CREATE OR REPLACE TABLE {curated}.fact_part_b_claim_lines
PARTITION BY claim_from_date
CLUSTER BY patient_id, provider_id, procedure_code
AS

WITH

clean_lines AS (
    SELECT *
    FROM {staging}.stg_cclf5_physician
    WHERE is_latest_version = TRUE
      AND has_critical_null = FALSE
),

prov AS (
    SELECT
        provider_id,
        provider_type,
        peer_group,
        provider_risk_profile,
        region        AS provider_region,
        urban_rural_flag,
        specialty
    FROM {staging}.stg_provider_dim
),

bene AS (
    SELECT
        bene_mbi_id,
        bene_age,
        age_bucket,
        utilization_segment,
        ma_plan_flag,
        risk_score,
        chronic_condition_count,
        annual_cost_bucket,
        region        AS patient_region,
        dual_eligibility_label
    FROM {staging}.stg_cclf8_beneficiary
),

proc_ref AS (
    SELECT
        hcpcs_cd,
        procedure_desc,
        procedure_category,
        high_risk_billing_flag,
        inpatient_only_flag
    FROM {raw}.raw_procedure_ref
)

SELECT
    -- -----------------------------------------------------------------------
    -- Keys
    -- -----------------------------------------------------------------------
    l.cur_clm_uniq_id                   AS claim_id,
    l.clm_line_num                      AS line_number,
    l.bene_mbi_id                       AS patient_id,
    l.provider_id,
    l.chain_root_id,

    -- -----------------------------------------------------------------------
    -- Procedure
    -- -----------------------------------------------------------------------
    l.clm_line_hcpcs_cd                 AS procedure_code,
    pr.procedure_desc                   AS procedure_description,
    l.service_category,
    pr.procedure_category,
    pr.high_risk_billing_flag           AS is_high_risk_procedure,
    l.units_of_service,
    l.modifier_1,
    l.modifier_2,

    -- -----------------------------------------------------------------------
    -- Diagnosis
    -- -----------------------------------------------------------------------
    l.clm_line_dgns_cd                  AS line_diagnosis_code,
    l.clm_dgns_1_cd                     AS claim_diagnosis_1,
    l.clm_dgns_2_cd                     AS claim_diagnosis_2,
    l.clm_dgns_3_cd                     AS claim_diagnosis_3,
    l.clm_dgns_4_cd                     AS claim_diagnosis_4,

    -- -----------------------------------------------------------------------
    -- Service location
    -- -----------------------------------------------------------------------
    l.place_of_service_cd,
    CASE l.place_of_service_cd
        WHEN '11' THEN 'Office'
        WHEN '22' THEN 'Outpatient Hospital'
        WHEN '21' THEN 'Inpatient Hospital'
        WHEN '02' THEN 'Telehealth'
        WHEN '31' THEN 'SNF'
        WHEN '32' THEN 'Nursing Facility'
        ELSE 'Other'
    END                                 AS place_of_service,
    CASE WHEN l.place_of_service_cd = '02'
        THEN TRUE ELSE FALSE
    END                                 AS is_telehealth,

    -- -----------------------------------------------------------------------
    -- Dates
    -- -----------------------------------------------------------------------
    l.clm_from_dt                       AS claim_from_date,
    l.clm_thru_dt                       AS claim_thru_date,
    l.clm_line_from_dt                  AS line_service_date,
    l.claim_year,
    l.claim_month,
    l.claim_quarter,
    l.claim_year_month,

    -- -----------------------------------------------------------------------
    -- Payment
    -- -----------------------------------------------------------------------
    l.line_allowed_amt                  AS allowed_amount,
    l.line_paid_amt                     AS paid_amount,
    l.clm_carr_pmt_dnl_cd              AS denial_code,
    l.is_paid,
    l.is_denied,

    -- Payment benchmarking
    l.expected_allowed_amt,
    l.allowed_amt_std_dev,
    l.payment_deviation_amt,
    l.payment_z_score,
    l.payment_outlier_flag              AS is_payment_outlier,

    -- -----------------------------------------------------------------------
    -- Overpayment and anomaly
    -- -----------------------------------------------------------------------
    l.overpayment_flag                  AS has_overpayment,
    l.overpayment_amt                   AS overpayment_amount,
    l.true_error_flag                   AS is_true_error,
    l.suspicious_pattern_flag          AS is_suspicious_pattern,

    -- -----------------------------------------------------------------------
    -- Denormalized provider attributes
    -- -----------------------------------------------------------------------
    p.provider_type,
    p.peer_group,
    p.provider_risk_profile,
    p.provider_region,
    p.urban_rural_flag                  AS provider_urban_rural,
    p.specialty                         AS provider_specialty,

    -- -----------------------------------------------------------------------
    -- Denormalized patient attributes
    -- -----------------------------------------------------------------------
    b.bene_age                          AS patient_age,
    b.age_bucket                        AS patient_age_bucket,
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
    l.stg_loaded_at                     AS loaded_at

FROM clean_lines l
LEFT JOIN prov     p  ON p.provider_id = l.provider_id
LEFT JOIN bene     b  ON b.bene_mbi_id = l.bene_mbi_id
LEFT JOIN proc_ref pr ON pr.hcpcs_cd   = l.clm_line_hcpcs_cd
