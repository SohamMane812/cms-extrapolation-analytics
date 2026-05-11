-- =============================================================================
-- stg_cclf1_claims_header.sql
-- Staging transformation for Part A claims header table.
--
-- Source  : {raw}.raw_cclf1_claims_header
-- Target  : {staging}.stg_cclf1_claims_header
--
-- Transformations applied:
--   - Resolve adjustment/cancellation chains
--   - Add is_latest_version flag per claim lineage chain
--   - Validate required fields and date logic
--   - Flag inpatient-specific field consistency
--   - Add claim age bucket and year/month for time-series analysis
--   - Separate clean paid claims from problematic records
-- =============================================================================

CREATE OR REPLACE TABLE {staging}.stg_cclf1_claims_header
PARTITION BY clm_from_dt
CLUSTER BY bene_mbi_id, provider_id
AS

WITH

source AS (
    SELECT * FROM {raw}.raw_cclf1_claims_header
),

-- -------------------------------------------------------------------------
-- Step 1: Resolve adjustment lineage chains
-- For each original claim, determine if a later adjustment or cancellation
-- supersedes it. The latest record in the chain is is_latest_version = TRUE.
-- -------------------------------------------------------------------------

-- Collect all adjustment/cancellation records
adjustments AS (
    SELECT
        clm_orig_clm_id,
        cur_clm_uniq_id  AS adj_clm_id,
        clm_adjsmt_type_cd,
        claim_status,
        clm_pmt_amt      AS adj_pmt_amt,
        created_at       AS adj_created_at,
        -- Rank within each chain: highest rank = most recent adjustment
        ROW_NUMBER() OVER (
            PARTITION BY clm_orig_clm_id
            ORDER BY created_at DESC
        ) AS adj_rank
    FROM source
    WHERE clm_adjsmt_type_cd IN ('1', '2')
),

-- The single latest adjustment per original claim
latest_adj AS (
    SELECT * FROM adjustments WHERE adj_rank = 1
),

-- -------------------------------------------------------------------------
-- Step 2: Enrich all records with lineage context
-- -------------------------------------------------------------------------

enriched AS (
    SELECT
        s.cur_clm_uniq_id,
        s.bene_mbi_id,
        s.provider_id,
        s.clm_type_cd,
        s.clm_from_dt,
        s.clm_thru_dt,
        s.clm_mdcr_npmt_rsn_cd,
        s.clm_pmt_amt,
        s.clm_adjsmt_type_cd,
        s.clm_orig_clm_id,
        s.dgns_prcdr_icd_ind,
        s.facility_type,
        s.claim_status,
        s.drg_cd,
        s.length_of_stay,
        s.overpayment_flag,
        s.overpayment_amt,
        s.audit_eligible_flag,
        s.true_error_flag,
        s.created_at,

        -- ---------------------------------------------------------------
        -- is_latest_version logic:
        -- Original claims: TRUE unless a later adj/cancel exists
        -- Adjustment/cancel records: TRUE only if they are the latest
        -- ---------------------------------------------------------------
        CASE
            WHEN s.clm_adjsmt_type_cd = '0' THEN
                CASE WHEN la.clm_orig_clm_id IS NULL THEN TRUE ELSE FALSE END
            WHEN s.clm_adjsmt_type_cd IN ('1','2') THEN
                CASE WHEN la2.adj_clm_id = s.cur_clm_uniq_id THEN TRUE ELSE FALSE END
            ELSE FALSE
        END AS is_latest_version,

        -- Chain root: the original claim ID for the entire lineage chain
        COALESCE(s.clm_orig_clm_id, s.cur_clm_uniq_id) AS chain_root_id,

        -- ---------------------------------------------------------------
        -- Derived fields for analytics convenience
        -- ---------------------------------------------------------------

        -- Calendar dimensions
        EXTRACT(YEAR  FROM s.clm_from_dt) AS claim_year,
        EXTRACT(MONTH FROM s.clm_from_dt) AS claim_month,
        EXTRACT(QUARTER FROM s.clm_from_dt) AS claim_quarter,
        FORMAT_DATE('%Y-%m', s.clm_from_dt) AS claim_year_month,

        -- Claim duration in days
        DATE_DIFF(s.clm_thru_dt, s.clm_from_dt, DAY) AS claim_span_days,

        -- Paid flag for clean filtering
        CASE WHEN s.claim_status = 'Paid' THEN TRUE ELSE FALSE END AS is_paid,
        CASE WHEN s.claim_status = 'Denied' THEN TRUE ELSE FALSE END AS is_denied,

        -- ---------------------------------------------------------------
        -- Data quality flags
        -- ---------------------------------------------------------------
        CASE
            WHEN s.cur_clm_uniq_id IS NULL THEN TRUE
            WHEN s.bene_mbi_id IS NULL     THEN TRUE
            WHEN s.provider_id IS NULL     THEN TRUE
            WHEN s.clm_type_cd IS NULL     THEN TRUE
            WHEN s.clm_from_dt IS NULL     THEN TRUE
            ELSE FALSE
        END AS has_critical_null,

        CASE
            WHEN s.clm_thru_dt < s.clm_from_dt THEN TRUE
            ELSE FALSE
        END AS invalid_date_range,

        CASE
            WHEN s.clm_type_cd != '60' AND s.drg_cd IS NOT NULL THEN TRUE
            ELSE FALSE
        END AS drg_on_non_inpatient,

        CASE
            WHEN s.clm_type_cd != '60' AND s.length_of_stay IS NOT NULL THEN TRUE
            ELSE FALSE
        END AS los_on_non_inpatient,

        CASE
            WHEN s.claim_status = 'Denied' AND s.clm_pmt_amt != 0 THEN TRUE
            ELSE FALSE
        END AS denied_nonzero_payment,

        CURRENT_TIMESTAMP() AS stg_loaded_at

    FROM source s

    -- Join to detect if this original claim has been superseded
    LEFT JOIN latest_adj la
        ON la.clm_orig_clm_id = s.cur_clm_uniq_id
        AND s.clm_adjsmt_type_cd = '0'

    -- Join to detect if this adj/cancel record is the latest in its chain
    LEFT JOIN latest_adj la2
        ON la2.adj_clm_id = s.cur_clm_uniq_id
        AND s.clm_adjsmt_type_cd IN ('1','2')
)

-- -------------------------------------------------------------------------
-- Final output: all records retained, quality flags included
-- Downstream analytics filter on is_latest_version = TRUE
-- and has_critical_null = FALSE as needed
-- -------------------------------------------------------------------------
SELECT * FROM enriched
