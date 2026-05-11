-- =============================================================================
-- peer_group_summary.sql
-- Materialized peer group benchmark statistics.
-- Pass 1 of 2 in the provider benchmarking pipeline.
--
-- Source  : {curated}.fact_part_a_claims
--           {curated}.fact_part_b_claim_lines
-- Target  : {analytics}.peer_group_summary
--
-- Used by: provider_benchmark_summary.sql (pass 2)
--          anomaly detection notebooks
--          clustering feature engineering
--          dashboard benchmark overlays
--
-- Design: Each row is one peer group. Provides the baseline statistics
-- that individual providers are compared against in pass 2.
-- =============================================================================

CREATE OR REPLACE TABLE {analytics}.peer_group_summary
AS

WITH

provider_part_a AS (
    SELECT
        provider_id,
        peer_group,
        provider_risk_profile,
        COUNT(*)                                                        AS total_part_a_claims,
        COUNTIF(is_paid)                                                AS paid_part_a_claims,
        COUNTIF(is_denied)                                              AS denied_part_a_claims,
        COUNTIF(has_overpayment)                                        AS overpayment_part_a_claims,
        SUM(CASE WHEN is_paid THEN payment_amount ELSE 0 END)           AS total_part_a_paid,
        AVG(CASE WHEN is_paid THEN payment_amount END)                  AS avg_part_a_payment,
        SAFE_DIVIDE(COUNTIF(is_denied), COUNT(*))                       AS part_a_denial_rate,
        SAFE_DIVIDE(COUNTIF(has_overpayment), COUNTIF(is_paid))         AS part_a_overpayment_rate,
        AVG(CASE WHEN is_paid THEN length_of_stay END)                  AS avg_length_of_stay,
        COUNTIF(claim_type = 'Inpatient')                               AS inpatient_claims,
        COUNTIF(claim_type = 'Outpatient')                              AS outpatient_claims
    FROM {curated}.fact_part_a_claims
    GROUP BY 1, 2, 3
),

provider_part_b AS (
    SELECT
        provider_id,
        peer_group,
        COUNT(*)                                                        AS total_part_b_lines,
        COUNTIF(is_denied)                                              AS denied_part_b_lines,
        COUNTIF(is_suspicious_pattern)                                  AS suspicious_lines,
        COUNTIF(is_payment_outlier)                                     AS payment_outlier_lines,
        SUM(CASE WHEN is_paid THEN paid_amount ELSE 0 END)              AS total_part_b_paid,
        AVG(CASE WHEN is_paid THEN paid_amount END)                     AS avg_part_b_line_payment,
        SAFE_DIVIDE(COUNTIF(is_denied), COUNT(*))                       AS part_b_denial_rate,
        AVG(payment_z_score)                                            AS avg_payment_z_score,
        COUNTIF(is_telehealth)                                          AS telehealth_lines,
        SAFE_DIVIDE(COUNTIF(is_telehealth), COUNT(*))                   AS telehealth_rate
    FROM {curated}.fact_part_b_claim_lines
    GROUP BY 1, 2
),

provider_combined AS (
    SELECT
        a.provider_id,
        a.peer_group,
        a.provider_risk_profile,
        a.total_part_a_claims,
        a.paid_part_a_claims,
        a.denied_part_a_claims,
        a.overpayment_part_a_claims,
        a.total_part_a_paid,
        a.avg_part_a_payment,
        a.part_a_denial_rate,
        a.part_a_overpayment_rate,
        a.avg_length_of_stay,
        a.inpatient_claims,
        a.outpatient_claims,
        COALESCE(b.total_part_b_lines, 0)                               AS total_part_b_lines,
        COALESCE(b.denied_part_b_lines, 0)                              AS denied_part_b_lines,
        COALESCE(b.suspicious_lines, 0)                                 AS suspicious_lines,
        COALESCE(b.payment_outlier_lines, 0)                            AS payment_outlier_lines,
        COALESCE(b.total_part_b_paid, 0)                                AS total_part_b_paid,
        b.avg_part_b_line_payment,
        b.part_b_denial_rate,
        b.avg_payment_z_score,
        COALESCE(b.telehealth_lines, 0)                                 AS telehealth_lines,
        COALESCE(b.telehealth_rate, 0)                                  AS telehealth_rate,
        COALESCE(a.total_part_a_paid, 0)
            + COALESCE(b.total_part_b_paid, 0)                         AS total_combined_paid
    FROM provider_part_a a
    LEFT JOIN provider_part_b b ON b.provider_id = a.provider_id
),

peer_agg AS (
    SELECT
        peer_group,
        COUNT(DISTINCT provider_id)                                     AS peer_group_size,
        AVG(total_part_a_claims)                                        AS peer_avg_part_a_claims,
        STDDEV(total_part_a_claims)                                     AS peer_stddev_part_a_claims,
        APPROX_QUANTILES(total_part_a_claims, 100)[OFFSET(50)]          AS peer_p50_part_a_claims,
        APPROX_QUANTILES(total_part_a_claims, 100)[OFFSET(90)]          AS peer_p90_part_a_claims,
        AVG(avg_part_a_payment)                                         AS peer_avg_part_a_payment,
        STDDEV(avg_part_a_payment)                                      AS peer_stddev_part_a_payment,
        APPROX_QUANTILES(avg_part_a_payment, 100)[OFFSET(50)]           AS peer_p50_part_a_payment,
        APPROX_QUANTILES(avg_part_a_payment, 100)[OFFSET(90)]           AS peer_p90_part_a_payment,
        AVG(part_a_denial_rate)                                         AS peer_avg_part_a_denial_rate,
        STDDEV(part_a_denial_rate)                                      AS peer_stddev_part_a_denial_rate,
        AVG(part_a_overpayment_rate)                                    AS peer_avg_overpayment_rate,
        STDDEV(part_a_overpayment_rate)                                 AS peer_stddev_overpayment_rate,
        AVG(avg_length_of_stay)                                         AS peer_avg_los,
        STDDEV(avg_length_of_stay)                                      AS peer_stddev_los,
        AVG(avg_part_b_line_payment)                                    AS peer_avg_part_b_payment,
        STDDEV(avg_part_b_line_payment)                                 AS peer_stddev_part_b_payment,
        AVG(part_b_denial_rate)                                         AS peer_avg_part_b_denial_rate,
        STDDEV(part_b_denial_rate)                                      AS peer_stddev_part_b_denial_rate,
        AVG(avg_payment_z_score)                                        AS peer_avg_payment_z_score,
        AVG(telehealth_rate)                                            AS peer_avg_telehealth_rate,
        AVG(total_combined_paid)                                        AS peer_avg_total_paid,
        STDDEV(total_combined_paid)                                     AS peer_stddev_total_paid,
        APPROX_QUANTILES(total_combined_paid, 100)[OFFSET(50)]          AS peer_p50_total_paid,
        APPROX_QUANTILES(total_combined_paid, 100)[OFFSET(90)]          AS peer_p90_total_paid,
        CURRENT_TIMESTAMP()                                             AS computed_at
    FROM provider_combined
    WHERE provider_risk_profile NOT IN ('Suspicious', 'Outlier')
    GROUP BY peer_group
)

SELECT * FROM peer_agg