-- =============================================================================
-- provider_benchmark_summary.sql
-- Provider-level metrics compared against peer group baselines.
-- Pass 2 of 2 in the provider benchmarking pipeline.
--
-- Source  : {curated}.fact_part_a_claims
--           {curated}.fact_part_b_claim_lines
--           {curated}.dim_provider
--           {analytics}.peer_group_summary   ← pass 1 dependency
-- Target  : {analytics}.provider_benchmark_summary
--
-- Used by: Provider Benchmarking dashboard
--          Anomaly Detection dashboard
--          EDA notebook 04
-- =============================================================================

CREATE OR REPLACE TABLE {analytics}.provider_benchmark_summary
AS

WITH

-- -------------------------------------------------------------------------
-- Provider-level Part A metrics
-- -------------------------------------------------------------------------
provider_part_a AS (
    SELECT
        provider_id,
        peer_group,
        provider_risk_profile,

        COUNT(*)                            AS total_part_a_claims,
        COUNTIF(is_paid)                    AS paid_part_a_claims,
        COUNTIF(is_denied)                  AS denied_part_a_claims,
        COUNTIF(has_overpayment)            AS overpayment_part_a_claims,
        COUNTIF(is_audit_eligible)          AS audit_eligible_claims,

        SUM(CASE WHEN is_paid
                THEN payment_amount ELSE 0 END) AS total_part_a_paid,

        AVG(CASE WHEN is_paid
                THEN payment_amount END)    AS avg_part_a_payment,

        MAX(CASE WHEN is_paid
                THEN payment_amount END)    AS max_part_a_payment,

        SAFE_DIVIDE(
            COUNTIF(is_denied), COUNT(*)
        )                                   AS part_a_denial_rate,

        SAFE_DIVIDE(
            COUNTIF(has_overpayment), COUNTIF(is_paid)
        )                                   AS part_a_overpayment_rate,

        SUM(overpayment_amount)             AS total_overpayment_amt,

        AVG(CASE WHEN is_paid
                THEN length_of_stay END)    AS avg_length_of_stay,

        COUNTIF(claim_type = 'Inpatient')   AS inpatient_claims,
        COUNTIF(claim_type = 'Outpatient')  AS outpatient_claims,

        COUNT(DISTINCT patient_id)          AS distinct_patients_part_a

    FROM {curated}.fact_part_a_claims
    GROUP BY 1, 2, 3
),

-- -------------------------------------------------------------------------
-- Provider-level Part B metrics
-- -------------------------------------------------------------------------
provider_part_b AS (
    SELECT
        provider_id,
        peer_group,

        COUNT(*)                            AS total_part_b_lines,
        COUNT(DISTINCT claim_id)            AS total_part_b_claims,
        COUNTIF(is_denied)                  AS denied_part_b_lines,
        COUNTIF(is_suspicious_pattern)      AS suspicious_lines,
        COUNTIF(is_payment_outlier)         AS payment_outlier_lines,
        COUNTIF(is_telehealth)              AS telehealth_lines,

        SUM(CASE WHEN is_paid
                THEN paid_amount ELSE 0 END) AS total_part_b_paid,

        AVG(CASE WHEN is_paid
                THEN paid_amount END)        AS avg_part_b_line_payment,

        SAFE_DIVIDE(
            COUNTIF(is_denied), COUNT(*)
        )                                   AS part_b_denial_rate,

        AVG(payment_z_score)                AS avg_payment_z_score,
        MAX(payment_z_score)                AS max_payment_z_score,

        SAFE_DIVIDE(
            COUNTIF(is_telehealth), COUNT(*)
        )                                   AS telehealth_rate,

        COUNT(DISTINCT patient_id)          AS distinct_patients_part_b,

        AVG(units_of_service)               AS avg_units_of_service

    FROM {curated}.fact_part_b_claim_lines
    GROUP BY 1, 2
),

-- -------------------------------------------------------------------------
-- Combine provider metrics
-- -------------------------------------------------------------------------
provider_combined AS (
    SELECT
        a.provider_id,
        a.peer_group,
        a.provider_risk_profile,

        -- Part A
        a.total_part_a_claims,
        a.paid_part_a_claims,
        a.denied_part_a_claims,
        a.overpayment_part_a_claims,
        a.audit_eligible_claims,
        a.total_part_a_paid,
        a.avg_part_a_payment,
        a.max_part_a_payment,
        a.part_a_denial_rate,
        a.part_a_overpayment_rate,
        a.total_overpayment_amt,
        a.avg_length_of_stay,
        a.inpatient_claims,
        a.outpatient_claims,
        a.distinct_patients_part_a,

        -- Part B
        COALESCE(b.total_part_b_lines, 0)     AS total_part_b_lines,
        COALESCE(b.total_part_b_claims, 0)    AS total_part_b_claims,
        COALESCE(b.denied_part_b_lines, 0)    AS denied_part_b_lines,
        COALESCE(b.suspicious_lines, 0)       AS suspicious_lines,
        COALESCE(b.payment_outlier_lines, 0)  AS payment_outlier_lines,
        COALESCE(b.telehealth_lines, 0)       AS telehealth_lines,
        COALESCE(b.total_part_b_paid, 0)      AS total_part_b_paid,
        b.avg_part_b_line_payment,
        b.part_b_denial_rate,
        b.avg_payment_z_score,
        b.max_payment_z_score,
        COALESCE(b.telehealth_rate, 0)        AS telehealth_rate,
        COALESCE(b.distinct_patients_part_b, 0) AS distinct_patients_part_b,
        b.avg_units_of_service,

        -- Combined
        COALESCE(a.total_part_a_paid, 0)
            + COALESCE(b.total_part_b_paid, 0) AS total_combined_paid,

        GREATEST(
            COALESCE(a.distinct_patients_part_a, 0),
            COALESCE(b.distinct_patients_part_b, 0)
        )                                      AS distinct_patients_total

    FROM provider_part_a a
    LEFT JOIN provider_part_b b ON b.provider_id = a.provider_id
),

-- -------------------------------------------------------------------------
-- Join peer group baselines and compute z-scores
-- -------------------------------------------------------------------------
benchmarked AS (
    SELECT
        pc.*,
        p.provider_name,
        p.provider_type,
        p.specialty,
        p.region,
        p.state,
        p.urban_rural,
        p.facility_size_bucket,
        p.provider_tenure_bucket,
        p.is_active,

        -- Peer group baselines
        pg.peer_group_size,
        pg.peer_avg_part_a_payment,
        pg.peer_stddev_part_a_payment,
        pg.peer_p50_part_a_payment,
        pg.peer_p90_part_a_payment,
        pg.peer_avg_part_a_denial_rate,
        pg.peer_avg_overpayment_rate,
        pg.peer_avg_los,
        pg.peer_avg_total_paid,
        pg.peer_p50_total_paid,
        pg.peer_p90_total_paid,
        pg.peer_avg_part_b_payment,
        pg.peer_avg_part_b_denial_rate,
        pg.peer_avg_payment_z_score,
        pg.peer_avg_telehealth_rate,

        -- Z-scores: provider vs peer group
        SAFE_DIVIDE(
            pc.avg_part_a_payment - pg.peer_avg_part_a_payment,
            NULLIF(pg.peer_stddev_part_a_payment, 0)
        )                                       AS payment_z_score_vs_peer,

        SAFE_DIVIDE(
            pc.part_a_denial_rate - pg.peer_avg_part_a_denial_rate,
            NULLIF(pg.peer_stddev_part_a_denial_rate, 0)
        )                                       AS denial_rate_z_score_vs_peer,

        SAFE_DIVIDE(
            pc.total_combined_paid - pg.peer_avg_total_paid,
            NULLIF(pg.peer_stddev_total_paid, 0)
        )                                       AS total_paid_z_score_vs_peer,

        -- Payment percentile within peer group (window function)
        PERCENT_RANK() OVER (
            PARTITION BY pc.peer_group
            ORDER BY pc.avg_part_a_payment
        )                                       AS payment_percentile_in_peer,

        PERCENT_RANK() OVER (
            PARTITION BY pc.peer_group
            ORDER BY pc.part_a_denial_rate
        )                                       AS denial_rate_percentile_in_peer,

        PERCENT_RANK() OVER (
            PARTITION BY pc.peer_group
            ORDER BY pc.total_combined_paid
        )                                       AS total_paid_percentile_in_peer,

        -- Provider-level anomaly signal score (simple composite)
        -- Higher = more anomalous relative to peers
        ROUND(
            COALESCE(ABS(SAFE_DIVIDE(
                pc.avg_part_a_payment - pg.peer_avg_part_a_payment,
                NULLIF(pg.peer_stddev_part_a_payment, 0)
            )), 0) * 0.30
            + COALESCE(ABS(SAFE_DIVIDE(
                pc.part_a_denial_rate - pg.peer_avg_part_a_denial_rate,
                NULLIF(pg.peer_stddev_part_a_denial_rate, 0)
            )), 0) * 0.25
            + COALESCE(ABS(pc.avg_payment_z_score), 0) * 0.25
            + SAFE_DIVIDE(pc.suspicious_lines,
                NULLIF(pc.total_part_b_lines, 0)) * 100 * 0.20
        , 4)                                    AS composite_anomaly_score,

        CURRENT_TIMESTAMP()                     AS computed_at

    FROM provider_combined pc
    JOIN {curated}.dim_provider p
        ON p.provider_id = pc.provider_id
    LEFT JOIN {analytics}.peer_group_summary pg
        ON pg.peer_group = pc.peer_group
)

SELECT * FROM benchmarked
