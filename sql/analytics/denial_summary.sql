-- =============================================================================
-- denial_summary.sql
-- Denial rate analysis by provider, claim type, procedure, and time period.
--
-- Source  : {curated}.fact_part_a_claims
--           {curated}.fact_part_b_claim_lines
-- Target  : {analytics}.denial_summary
--
-- Used by: Provider Benchmarking dashboard, Anomaly Detection dashboard
-- =============================================================================

CREATE OR REPLACE TABLE {analytics}.denial_summary
AS

-- -------------------------------------------------------------------------
-- Part A denials
-- -------------------------------------------------------------------------
WITH part_a_denials AS (
    SELECT
        'Part_A'                        AS claim_source,
        provider_id,
        peer_group,
        provider_risk_profile,
        provider_type,
        provider_region                 AS region,
        claim_type,
        denial_reason_code,
        claim_year,
        claim_year_month,

        COUNT(*)                        AS total_claims,
        COUNTIF(is_denied)              AS denied_claims,
        SAFE_DIVIDE(COUNTIF(is_denied), COUNT(*)) AS denial_rate,
        SUM(CASE WHEN is_denied THEN 0
                 ELSE payment_amount END) AS paid_when_not_denied

    FROM {curated}.fact_part_a_claims
    GROUP BY 1,2,3,4,5,6,7,8,9,10
),

-- -------------------------------------------------------------------------
-- Part B denials
-- -------------------------------------------------------------------------
part_b_denials AS (
    SELECT
        'Part_B'                        AS claim_source,
        provider_id,
        peer_group,
        provider_risk_profile,
        provider_type,
        provider_region                 AS region,
        service_category                AS claim_type,
        denial_code                     AS denial_reason_code,
        claim_year,
        claim_year_month,

        COUNT(*)                        AS total_claims,
        COUNTIF(is_denied)              AS denied_claims,
        SAFE_DIVIDE(COUNTIF(is_denied), COUNT(*)) AS denial_rate,
        SUM(CASE WHEN is_denied THEN 0
                 ELSE paid_amount END)  AS paid_when_not_denied

    FROM {curated}.fact_part_b_claim_lines
    GROUP BY 1,2,3,4,5,6,7,8,9,10
)

SELECT * FROM part_a_denials
UNION ALL
SELECT * FROM part_b_denials
