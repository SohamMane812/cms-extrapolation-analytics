-- =============================================================================
-- payment_summary.sql
-- Payment aggregations by provider, claim type, region, and time period.
--
-- Source  : {curated}.fact_part_a_claims
--           {curated}.fact_part_b_claim_lines
-- Target  : {analytics}.payment_summary
--
-- Used by: Executive Overview dashboard, Claims Explorer dashboard
-- =============================================================================

CREATE OR REPLACE TABLE {analytics}.payment_summary
AS

-- -------------------------------------------------------------------------
-- Part A payment summary by provider and claim type
-- -------------------------------------------------------------------------
WITH part_a AS (
    SELECT
        'Part_A'                        AS claim_source,
        provider_id,
        provider_type,
        peer_group,
        provider_risk_profile,
        provider_region                 AS region,
        claim_type,
        claim_year,
        claim_quarter,
        claim_year_month,

        COUNT(*)                        AS total_claims,
        COUNTIF(is_paid)                AS paid_claims,
        COUNTIF(is_denied)              AS denied_claims,
        COUNTIF(has_overpayment)        AS overpayment_claims,
        COUNTIF(is_audit_eligible)      AS audit_eligible_claims,

        SUM(payment_amount)             AS total_payment,
        SUM(CASE WHEN is_paid THEN payment_amount ELSE 0 END) AS total_paid_amount,
        SUM(overpayment_amount)         AS total_overpayment,

        AVG(CASE WHEN is_paid THEN payment_amount END) AS avg_payment,
        MAX(CASE WHEN is_paid THEN payment_amount END) AS max_payment,
        MIN(CASE WHEN is_paid AND payment_amount > 0
                THEN payment_amount END)               AS min_payment,

        SAFE_DIVIDE(
            COUNTIF(is_denied),
            COUNT(*)
        )                               AS denial_rate,

        SAFE_DIVIDE(
            COUNTIF(has_overpayment),
            COUNTIF(is_paid)
        )                               AS overpayment_rate,

        SAFE_DIVIDE(
            SUM(overpayment_amount),
            SUM(CASE WHEN is_paid THEN payment_amount ELSE 0 END)
        )                               AS overpayment_pct_of_paid

    FROM {curated}.fact_part_a_claims
    GROUP BY 1,2,3,4,5,6,7,8,9,10
),

-- -------------------------------------------------------------------------
-- Part B payment summary by provider and service category
-- -------------------------------------------------------------------------
part_b AS (
    SELECT
        'Part_B'                        AS claim_source,
        provider_id,
        provider_type,
        peer_group,
        provider_risk_profile,
        provider_region                 AS region,
        service_category                AS claim_type,
        claim_year,
        claim_quarter,
        claim_year_month,

        COUNT(*)                        AS total_claims,
        COUNTIF(is_paid)                AS paid_claims,
        COUNTIF(is_denied)              AS denied_claims,
        COUNTIF(has_overpayment)        AS overpayment_claims,
        0                               AS audit_eligible_claims,

        SUM(paid_amount)                AS total_payment,
        SUM(CASE WHEN is_paid THEN paid_amount ELSE 0 END) AS total_paid_amount,
        SUM(overpayment_amount)         AS total_overpayment,

        AVG(CASE WHEN is_paid THEN paid_amount END) AS avg_payment,
        MAX(CASE WHEN is_paid THEN paid_amount END) AS max_payment,
        MIN(CASE WHEN is_paid AND paid_amount > 0
                THEN paid_amount END)               AS min_payment,

        SAFE_DIVIDE(
            COUNTIF(is_denied),
            COUNT(*)
        )                               AS denial_rate,

        SAFE_DIVIDE(
            COUNTIF(has_overpayment),
            COUNTIF(is_paid)
        )                               AS overpayment_rate,

        SAFE_DIVIDE(
            SUM(overpayment_amount),
            SUM(CASE WHEN is_paid THEN paid_amount ELSE 0 END)
        )                               AS overpayment_pct_of_paid

    FROM {curated}.fact_part_b_claim_lines
    GROUP BY 1,2,3,4,5,6,7,8,9,10
)

SELECT * FROM part_a
UNION ALL
SELECT * FROM part_b
