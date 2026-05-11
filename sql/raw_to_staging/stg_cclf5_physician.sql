-- =============================================================================
-- stg_cclf5_physician.sql
-- Staging transformation for Part B physician claim lines table.
--
-- Source  : {raw}.raw_cclf5_physician
-- Target  : {staging}.stg_cclf5_physician
--
-- Transformations applied:
--   - Resolve adjustment/cancellation chains with is_latest_version flag
--   - Validate HCPCS codes against procedure reference
--   - Validate payment logic (allowed >= paid)
--   - Add service date calendar dimensions
--   - Add payment variance from expected (z-score input)
--   - Flag suspicious patterns for anomaly detection
-- =============================================================================

CREATE OR REPLACE TABLE {staging}.stg_cclf5_physician
PARTITION BY clm_from_dt
CLUSTER BY bene_mbi_id, provider_id, clm_line_hcpcs_cd
AS

WITH

source AS (
    SELECT * FROM {raw}.raw_cclf5_physician
),

-- -------------------------------------------------------------------------
-- Resolve adjustment/cancellation chains (same logic as CCLF1)
-- -------------------------------------------------------------------------

adjustments AS (
    SELECT
        clm_orig_clm_id,
        cur_clm_uniq_id AS adj_clm_id,
        ROW_NUMBER() OVER (
            PARTITION BY clm_orig_clm_id
            ORDER BY clm_from_dt DESC, clm_line_num DESC
        ) AS adj_rank
    FROM source
    WHERE clm_adjsmt_type_cd IN ('1', '2')
),

latest_adj AS (
    SELECT * FROM adjustments WHERE adj_rank = 1
),

-- -------------------------------------------------------------------------
-- Procedure reference for payment benchmarking
-- -------------------------------------------------------------------------

proc_ref AS (
    SELECT
        hcpcs_cd,
        expected_allowed_amt,
        allowed_amt_std_dev,
        high_risk_billing_flag,
        procedure_category,
        inpatient_only_flag
    FROM {raw}.raw_procedure_ref
),

enriched AS (
    SELECT
        s.cur_clm_uniq_id,
        s.clm_line_num,
        s.bene_mbi_id,
        s.provider_id,
        s.clm_from_dt,
        s.clm_thru_dt,
        s.clm_line_from_dt,
        s.clm_line_dgns_cd,
        s.clm_dgns_1_cd,
        s.clm_dgns_2_cd,
        s.clm_dgns_3_cd,
        s.clm_dgns_4_cd,
        s.clm_line_hcpcs_cd,
        s.clm_carr_pmt_dnl_cd,
        s.clm_adjsmt_type_cd,
        s.clm_orig_clm_id,
        s.dgns_prcdr_icd_ind,
        s.line_allowed_amt,
        s.line_paid_amt,
        s.units_of_service,
        s.place_of_service_cd,
        s.modifier_1,
        s.modifier_2,
        s.service_category,
        s.overpayment_flag,
        s.overpayment_amt,
        s.true_error_flag,
        s.suspicious_pattern_flag,

        -- ---------------------------------------------------------------
        -- is_latest_version: same chain resolution logic as CCLF1
        -- ---------------------------------------------------------------
        CASE
            WHEN s.clm_adjsmt_type_cd = '0' THEN
                CASE WHEN la.clm_orig_clm_id IS NULL THEN TRUE ELSE FALSE END
            WHEN s.clm_adjsmt_type_cd IN ('1','2') THEN
                CASE WHEN la2.adj_clm_id = s.cur_clm_uniq_id THEN TRUE ELSE FALSE END
            ELSE FALSE
        END AS is_latest_version,

        COALESCE(s.clm_orig_clm_id, s.cur_clm_uniq_id) AS chain_root_id,

        -- ---------------------------------------------------------------
        -- Calendar dimensions
        -- ---------------------------------------------------------------
        EXTRACT(YEAR    FROM s.clm_from_dt) AS claim_year,
        EXTRACT(MONTH   FROM s.clm_from_dt) AS claim_month,
        EXTRACT(QUARTER FROM s.clm_from_dt) AS claim_quarter,
        FORMAT_DATE('%Y-%m', s.clm_from_dt) AS claim_year_month,

        -- ---------------------------------------------------------------
        -- Payment flags
        -- ---------------------------------------------------------------
        CASE WHEN s.clm_carr_pmt_dnl_cd IS NULL
                  AND s.clm_adjsmt_type_cd = '0' THEN TRUE ELSE FALSE END AS is_paid,
        CASE WHEN s.clm_carr_pmt_dnl_cd IS NOT NULL THEN TRUE ELSE FALSE END AS is_denied,

        -- ---------------------------------------------------------------
        -- Payment benchmarking vs procedure reference
        -- ---------------------------------------------------------------
        pr.expected_allowed_amt,
        pr.allowed_amt_std_dev,
        pr.high_risk_billing_flag,
        pr.inpatient_only_flag AS proc_inpatient_only,

        -- Payment deviation from expected (raw difference)
        CASE
            WHEN pr.expected_allowed_amt IS NOT NULL AND pr.expected_allowed_amt > 0
            THEN s.line_allowed_amt - pr.expected_allowed_amt
            ELSE NULL
        END AS payment_deviation_amt,

        -- Z-score: how many std devs above/below expected
        CASE
            WHEN pr.allowed_amt_std_dev IS NOT NULL AND pr.allowed_amt_std_dev > 0
            THEN SAFE_DIVIDE(
                s.line_allowed_amt - pr.expected_allowed_amt,
                pr.allowed_amt_std_dev
            )
            ELSE NULL
        END AS payment_z_score,

        -- Flag lines where payment is more than 2 std devs above expected
        CASE
            WHEN pr.allowed_amt_std_dev IS NOT NULL AND pr.allowed_amt_std_dev > 0
             AND SAFE_DIVIDE(
                    s.line_allowed_amt - pr.expected_allowed_amt,
                    pr.allowed_amt_std_dev
                 ) > 2.0
            THEN TRUE
            ELSE FALSE
        END AS payment_outlier_flag,

        -- ---------------------------------------------------------------
        -- Validity and data quality flags
        -- ---------------------------------------------------------------
        CASE WHEN pr.hcpcs_cd IS NOT NULL THEN TRUE ELSE FALSE END AS is_valid_hcpcs,

        CASE
            WHEN s.cur_clm_uniq_id IS NULL      THEN TRUE
            WHEN s.bene_mbi_id IS NULL           THEN TRUE
            WHEN s.provider_id IS NULL           THEN TRUE
            WHEN s.clm_line_hcpcs_cd IS NULL     THEN TRUE
            WHEN s.clm_from_dt IS NULL           THEN TRUE
            ELSE FALSE
        END AS has_critical_null,

        CASE
            WHEN s.clm_adjsmt_type_cd = '0'
             AND s.clm_carr_pmt_dnl_cd IS NULL
             AND s.line_paid_amt > s.line_allowed_amt
            THEN TRUE
            ELSE FALSE
        END AS paid_exceeds_allowed,

        CASE
            WHEN s.clm_adjsmt_type_cd = '0'
             AND s.clm_carr_pmt_dnl_cd IS NOT NULL
             AND s.line_paid_amt != 0
            THEN TRUE
            ELSE FALSE
        END AS denied_nonzero_paid,

        CASE
            WHEN s.clm_thru_dt < s.clm_from_dt THEN TRUE
            ELSE FALSE
        END AS invalid_date_range,

        CASE
            WHEN s.units_of_service < 1 THEN TRUE
            ELSE FALSE
        END AS invalid_units,

        CURRENT_TIMESTAMP() AS stg_loaded_at

    FROM source s

    LEFT JOIN latest_adj la
        ON la.clm_orig_clm_id = s.cur_clm_uniq_id
        AND s.clm_adjsmt_type_cd = '0'

    LEFT JOIN latest_adj la2
        ON la2.adj_clm_id = s.cur_clm_uniq_id
        AND s.clm_adjsmt_type_cd IN ('1','2')

    LEFT JOIN proc_ref pr
        ON pr.hcpcs_cd = s.clm_line_hcpcs_cd
)

SELECT * FROM enriched
WHERE has_critical_null = FALSE
  AND invalid_date_range = FALSE
  AND invalid_units = FALSE
  