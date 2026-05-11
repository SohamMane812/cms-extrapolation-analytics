-- =============================================================================
-- extrapolation_results.sql
-- Pre-computed extrapolation estimates by sample type.
--
-- Source  : {curated}.fact_part_a_claims
-- Target  : {analytics}.extrapolation_results
--
-- Simulates four audit sample types and computes extrapolated overpayment
-- estimates for each. The extrapolation simulator dashboard page reads
-- directly from this table.
--
-- Sample types simulated:
--   1. Random sample (2% of audit-eligible claims)
--   2. Biased high-cost sample (top 10% by payment)
--   3. Biased provider sample (Suspicious + Outlier providers only)
--   4. Stratified sample (proportional by claim type)
--
-- For each sample the extrapolated overpayment is:
--   (sample_overpayment_rate) x (universe_total_payment)
-- =============================================================================

CREATE OR REPLACE TABLE {analytics}.extrapolation_results
AS

WITH

-- -------------------------------------------------------------------------
-- Universe: all audit-eligible paid original claims
-- -------------------------------------------------------------------------
universe AS (
    SELECT
        claim_id,
        provider_id,
        peer_group,
        provider_risk_profile,
        claim_type,
        patient_id,
        payment_amount,
        overpayment_amount,
        has_overpayment,
        is_true_error,
        patient_risk_score,
        claim_year
    FROM {curated}.fact_part_a_claims
    WHERE is_audit_eligible = TRUE
      AND is_paid = TRUE
),

universe_totals AS (
    SELECT
        COUNT(*)                AS universe_claim_count,
        SUM(payment_amount)     AS universe_total_payment,
        SUM(overpayment_amount) AS universe_true_overpayment,
        SAFE_DIVIDE(
            SUM(overpayment_amount),
            SUM(payment_amount)
        )                       AS universe_true_op_rate
    FROM universe
),

-- -------------------------------------------------------------------------
-- Sample 1: Random sample (~2% of audit-eligible claims)
-- Uses FARM_FINGERPRINT for deterministic pseudo-random sampling
-- -------------------------------------------------------------------------
random_sample AS (
    SELECT
        'Random_Sample'         AS sample_type,
        u.*
    FROM universe u
    WHERE ABS(MOD(FARM_FINGERPRINT(claim_id), 50)) = 0  -- ~2%
),

-- -------------------------------------------------------------------------
-- Sample 2: Biased high-cost sample (top 10% by payment amount)
-- -------------------------------------------------------------------------
high_cost_threshold AS (
    SELECT PERCENTILE_CONT(payment_amount, 0.90) OVER () AS p90_payment
    FROM universe
    LIMIT 1
),

high_cost_sample AS (
    SELECT
        'Biased_High_Cost'      AS sample_type,
        u.*
    FROM universe u
    JOIN high_cost_threshold h ON u.payment_amount >= h.p90_payment
    WHERE ABS(MOD(FARM_FINGERPRINT(claim_id), 5)) = 0  -- ~20% of top decile ≈ 2% total
),

-- -------------------------------------------------------------------------
-- Sample 3: Biased provider sample (Suspicious + Outlier providers)
-- -------------------------------------------------------------------------
provider_sample AS (
    SELECT
        'Biased_Provider'       AS sample_type,
        u.*
    FROM universe u
    WHERE provider_risk_profile IN ('Suspicious', 'Outlier')
),

-- -------------------------------------------------------------------------
-- Sample 4: Stratified sample (proportional by claim type, ~2% per stratum)
-- -------------------------------------------------------------------------
stratified_sample AS (
    SELECT
        'Stratified_By_Type'    AS sample_type,
        u.*
    FROM universe u
    WHERE ABS(MOD(FARM_FINGERPRINT(CONCAT(claim_id, claim_type)), 50)) = 0
),

-- -------------------------------------------------------------------------
-- Combine all samples
-- -------------------------------------------------------------------------
all_samples AS (
    SELECT * FROM random_sample
    UNION ALL
    SELECT * FROM high_cost_sample
    UNION ALL
    SELECT * FROM provider_sample
    UNION ALL
    SELECT * FROM stratified_sample
),

-- -------------------------------------------------------------------------
-- Compute extrapolation metrics per sample type
-- -------------------------------------------------------------------------
sample_metrics AS (
    SELECT
        s.sample_type,

        COUNT(*)                            AS sample_size,
        SUM(s.payment_amount)               AS sample_total_payment,
        SUM(s.overpayment_amount)           AS sample_overpayment_found,
        COUNTIF(s.has_overpayment)          AS sample_op_claims,

        SAFE_DIVIDE(
            SUM(s.overpayment_amount),
            SUM(s.payment_amount)
        )                                   AS sample_overpayment_rate,

        SAFE_DIVIDE(
            COUNTIF(s.has_overpayment),
            COUNT(*)
        )                                   AS sample_op_claim_rate,

        -- Extrapolated overpayment = sample_rate x universe_total_payment
        SAFE_DIVIDE(
            SUM(s.overpayment_amount),
            SUM(s.payment_amount)
        ) * t.universe_total_payment        AS extrapolated_overpayment,

        -- True population overpayment for comparison
        t.universe_true_overpayment,
        t.universe_total_payment,
        t.universe_claim_count,
        t.universe_true_op_rate,

        -- Estimation error
        SAFE_DIVIDE(
            SUM(s.overpayment_amount),
            SUM(s.payment_amount)
        ) * t.universe_total_payment
        - t.universe_true_overpayment       AS estimation_error_amt,

        SAFE_DIVIDE(
            ABS(
                SAFE_DIVIDE(
                    SUM(s.overpayment_amount),
                    SUM(s.payment_amount)
                ) * t.universe_total_payment
                - t.universe_true_overpayment
            ),
            NULLIF(t.universe_true_overpayment, 0)
        )                                   AS estimation_error_pct,

        -- Sample-to-universe ratio
        SAFE_DIVIDE(COUNT(*), t.universe_claim_count) AS sample_coverage_rate

    FROM all_samples s
    CROSS JOIN universe_totals t
    GROUP BY s.sample_type, t.universe_total_payment,
             t.universe_true_overpayment, t.universe_claim_count,
             t.universe_true_op_rate
)

SELECT
    sample_type,
    sample_size,
    sample_total_payment,
    sample_overpayment_found,
    sample_op_claims,
    sample_overpayment_rate,
    sample_op_claim_rate,
    extrapolated_overpayment,
    universe_true_overpayment,
    universe_total_payment,
    universe_claim_count,
    universe_true_op_rate,
    estimation_error_amt,
    estimation_error_pct,
    sample_coverage_rate,
    CURRENT_TIMESTAMP()             AS computed_at
FROM sample_metrics
ORDER BY sample_type
