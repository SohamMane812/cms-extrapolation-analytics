export const QUERIES = {
  executiveKPIs: `
    SELECT
        SUM(total_paid_amount)                                      AS total_paid,
        SUM(total_overpayment)                                      AS total_overpayment,
        SUM(total_claims)                                           AS total_claims,
        SUM(total_overpayment) / NULLIF(SUM(total_paid_amount), 0) AS true_op_rate
    FROM \`cms-extrapolation-v1.analytics_cms_claims.payment_summary\`
    WHERE claim_source = 'Part_A'
    `,

  flaggedProviders: `
    SELECT COUNT(*) AS flagged_count
    FROM \`cms-extrapolation-v1.analytics_cms_claims.anomaly_scores\`
    WHERE total_flags_triggered >= 2
  `,

  overpaymentByRiskProfile: `
    SELECT
        provider_risk_profile,
        SUM(total_overpayment)  AS total_overpayment,
        AVG(overpayment_rate)   AS avg_overpayment_rate,
        COUNT(DISTINCT provider_id) AS provider_count
    FROM \`cms-extrapolation-v1.analytics_cms_claims.payment_summary\`
    WHERE claim_source = 'Part_A'
        AND provider_risk_profile IS NOT NULL
    GROUP BY provider_risk_profile
    ORDER BY total_overpayment DESC
    `,

  extrapolationComparison: `
    SELECT
      sample_type,
      sample_size,
      extrapolated_overpayment,
      universe_true_overpayment,
      estimation_error_pct,
      sample_overpayment_rate
    FROM \`cms-extrapolation-v1.analytics_cms_claims.extrapolation_results\`
    ORDER BY sample_type
  `,

  topFlaggedProviders: `
    SELECT
      provider_id,
      provider_name,
      provider_type,
      peer_group,
      composite_anomaly_score,
      total_flags_triggered,
      anomaly_risk_tier,
      part_a_overpayment_rate,
      total_overpayment_amt,
      total_combined_paid
    FROM \`cms-extrapolation-v1.analytics_cms_claims.anomaly_scores\`
    WHERE total_flags_triggered >= 2
    ORDER BY composite_anomaly_score DESC
    LIMIT 10
  `,
};
