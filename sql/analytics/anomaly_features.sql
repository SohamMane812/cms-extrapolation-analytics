-- =============================================================================
-- anomaly_features.sql
-- Pre-computed anomaly detection features per provider.
-- Designed to feed both the dashboard anomaly page and Python ML notebooks.
--
-- Source  : {analytics}.provider_benchmark_summary
--           {curated}.fact_part_a_claims
--           {curated}.fact_part_b_claim_lines
-- Target  : {analytics}.anomaly_scores
--
-- Used by: Anomaly Detection dashboard, EDA notebook 05
-- =============================================================================

CREATE OR REPLACE TABLE {analytics}.anomaly_scores
AS

WITH

-- -------------------------------------------------------------------------
-- Pull benchmark summary as base
-- -------------------------------------------------------------------------
base AS (
    SELECT
        provider_id,
        provider_name,
        provider_type,
        specialty,
        peer_group,
        provider_risk_profile,
        region,
        urban_rural,
        is_active,

        -- Volume metrics
        total_part_a_claims,
        total_part_b_lines,
        distinct_patients_total,

        -- Payment metrics
        avg_part_a_payment,
        max_part_a_payment,
        total_combined_paid,
        avg_part_b_line_payment,
        avg_payment_z_score,
        max_payment_z_score,

        -- Denial metrics
        part_a_denial_rate,
        part_b_denial_rate,

        -- Overpayment
        part_a_overpayment_rate,
        total_overpayment_amt,

        -- Anomaly signals
        suspicious_lines,
        payment_outlier_lines,
        avg_units_of_service,
        telehealth_rate,

        -- Z-scores vs peer
        payment_z_score_vs_peer,
        denial_rate_z_score_vs_peer,
        total_paid_z_score_vs_peer,
        composite_anomaly_score,

        -- Peer baselines
        peer_avg_part_a_payment,
        peer_avg_part_a_denial_rate,
        peer_avg_overpayment_rate

    FROM {analytics}.provider_benchmark_summary
),

-- -------------------------------------------------------------------------
-- Duplicate claim rate per provider (anomaly signal)
-- -------------------------------------------------------------------------
dup_rates AS (
    SELECT
        provider_id,
        SAFE_DIVIDE(
            COUNTIF(adjustment_type IN ('1','2')),
            COUNT(*)
        )                               AS adjustment_cancel_rate
    FROM {curated}.fact_part_a_claims
    GROUP BY 1
),

-- -------------------------------------------------------------------------
-- Daily claim volume stats (suspicious provider signal)
-- -------------------------------------------------------------------------
daily_volume AS (
    SELECT
        provider_id,
        AVG(daily_count)                AS avg_daily_claim_volume,
        MAX(daily_count)                AS max_daily_claim_volume,
        STDDEV(daily_count)             AS stddev_daily_volume
    FROM (
        SELECT
            provider_id,
            claim_from_date,
            COUNT(*)                    AS daily_count
        FROM {curated}.fact_part_b_claim_lines
        GROUP BY 1, 2
    ) daily
    GROUP BY 1
),

-- -------------------------------------------------------------------------
-- Rule-based anomaly flags
-- -------------------------------------------------------------------------
flagged AS (
    SELECT
        b.*,
        COALESCE(d.adjustment_cancel_rate, 0)   AS adjustment_cancel_rate,
        COALESCE(dv.avg_daily_claim_volume, 0)  AS avg_daily_claim_volume,
        COALESCE(dv.max_daily_claim_volume, 0)  AS max_daily_claim_volume,
        COALESCE(dv.stddev_daily_volume, 0)     AS stddev_daily_volume,

        -- Rule-based flags
        CASE WHEN ABS(b.payment_z_score_vs_peer) > 2.0
            THEN TRUE ELSE FALSE END            AS flag_payment_outlier,

        CASE WHEN b.part_a_denial_rate > b.peer_avg_part_a_denial_rate * 2.0
            THEN TRUE ELSE FALSE END            AS flag_high_denial_rate,

        CASE WHEN b.part_a_overpayment_rate > b.peer_avg_overpayment_rate * 2.0
            THEN TRUE ELSE FALSE END            AS flag_high_overpayment_rate,

        CASE WHEN COALESCE(dv.max_daily_claim_volume, 0) > 50
            THEN TRUE ELSE FALSE END            AS flag_excessive_daily_volume,

        CASE WHEN COALESCE(d.adjustment_cancel_rate, 0) > 0.15
            THEN TRUE ELSE FALSE END            AS flag_high_adjustment_rate,

        CASE WHEN b.suspicious_lines > 0
            THEN TRUE ELSE FALSE END            AS flag_suspicious_patterns,

        CASE WHEN b.max_payment_z_score > 3.0
            THEN TRUE ELSE FALSE END            AS flag_extreme_payment_outlier

    FROM base b
    LEFT JOIN dup_rates  d  ON d.provider_id  = b.provider_id
    LEFT JOIN daily_volume dv ON dv.provider_id = b.provider_id
)

SELECT
    *,

    -- Count of rule-based flags triggered
    (CAST(flag_payment_outlier      AS INT64)
     + CAST(flag_high_denial_rate   AS INT64)
     + CAST(flag_high_overpayment_rate AS INT64)
     + CAST(flag_excessive_daily_volume AS INT64)
     + CAST(flag_high_adjustment_rate AS INT64)
     + CAST(flag_suspicious_patterns AS INT64)
     + CAST(flag_extreme_payment_outlier AS INT64)
    )                               AS total_flags_triggered,

    -- Final risk tier classification
    CASE
        WHEN composite_anomaly_score > 3.0
          OR provider_risk_profile = 'Outlier'
        THEN 'High Risk'
        WHEN composite_anomaly_score > 1.5
          OR provider_risk_profile = 'Suspicious'
        THEN 'Elevated Risk'
        WHEN composite_anomaly_score > 0.5
        THEN 'Moderate Risk'
        ELSE 'Normal'
    END                             AS anomaly_risk_tier,

    CURRENT_TIMESTAMP()             AS computed_at

FROM flagged
