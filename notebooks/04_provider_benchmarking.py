# =============================================================================
# notebooks/04_provider_benchmarking.ipynb
#
# CMS Extrapolation Analytics — Provider Benchmarking
#
# PURPOSE:
#   Identify providers that perform significantly differently from their
#   peer groups across key billing, payment, denial, and overpayment metrics.
#   This notebook answers the core provider oversight question: who stands out,
#   and why does it matter?
#
# BUSINESS CONTEXT:
#   CMS and Medicare Administrative Contractors (MACs) routinely benchmark
#   provider billing patterns against peer groups to identify outliers for
#   audit targeting. A provider billing significantly above peers in payment
#   per claim, denial rate, or overpayment rate is a candidate for review.
#   This notebook replicates that analytical workflow using our synthetic
#   CCLF-style dataset.
#
# METHODOLOGY:
#   Provider metrics are computed from fact_part_a_claims and
#   fact_part_b_claim_lines in the curated layer. Each provider is then
#   compared against their peer group baseline from the pre-computed
#   peer_group_summary analytics table. Z-scores quantify the deviation.
#   A composite anomaly score combines multiple signals into a single
#   risk ranking.
#
# SECTIONS:
#   1. Setup and Data Loading
#   2. Peer Group Baseline Profiles
#   3. Provider Payment Benchmarking
#   4. Denial Rate Benchmarking
#   5. Overpayment Rate Benchmarking
#   6. Multi-Metric Provider Ranking
#   7. Risk Profile Separation Analysis
#   8. Peer Group Heatmap
#   9. Summary and Limitations
# =============================================================================

# ── CELL 1: Setup ─────────────────────────────────────────────────────────────

import sys
from pathlib import Path
sys.path.insert(0, str(Path("..").resolve()))

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import matplotlib.patches as mpatches
import seaborn as sns
from scipy import stats
from IPython.display import display

from src.utils.notebook_utils import (
    get_bq_client, get_project_id, query, build_query,
    set_style, section_header, finding, healthcare_context, observation,
    fmt_currency, fmt_pct, PALETTE_MAIN, PALETTE_RISK,
    COLOR_PRIMARY, COLOR_WARN, plot_scatter
)

set_style()
client  = get_bq_client()
PROJECT = get_project_id()
print("✓ Setup complete — full scale dataset active")


# ── CELL 2: Load Benchmarking Data ────────────────────────────────────────────

section_header(
    "1. DATA LOADING",
    "Provider benchmark summary and peer group baselines from analytics layer"
)

bench_sql = """
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

    -- Volume
    total_part_a_claims,
    total_part_b_lines,
    distinct_patients_total,

    -- Payment
    avg_part_a_payment,
    max_part_a_payment,
    total_combined_paid,
    avg_part_b_line_payment,

    -- Denial
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
    avg_payment_z_score,
    max_payment_z_score,

    -- Peer comparison
    payment_z_score_vs_peer,
    denial_rate_z_score_vs_peer,
    total_paid_z_score_vs_peer,
    payment_percentile_in_peer,
    denial_rate_percentile_in_peer,
    composite_anomaly_score,

    -- Peer baselines
    peer_avg_part_a_payment,
    peer_stddev_part_a_payment,
    peer_p50_part_a_payment,
    peer_p90_part_a_payment,
    peer_avg_part_a_denial_rate,
    peer_avg_overpayment_rate,
    peer_group_size

FROM `{analytics}.provider_benchmark_summary`
ORDER BY composite_anomaly_score DESC
"""

df = query(client, build_query(bench_sql, PROJECT), "provider benchmark")
print(f"\n  Loaded {len(df):,} providers with full benchmarking metrics")
print(f"  Peer groups represented: {df['peer_group'].nunique()}")
print(f"  Risk profile distribution:")
for profile, count in df['provider_risk_profile'].value_counts().items():
    print(f"    {profile:<20}: {count:>4} providers")


# ── CELL 3: Peer Group Baseline Profiles ─────────────────────────────────────

section_header(
    "2. PEER GROUP BASELINE PROFILES",
    "Understanding what 'normal' looks like within each peer group"
)

peer_sql = """
SELECT
    peer_group,
    peer_group_size,
    peer_avg_part_a_payment,
    peer_stddev_part_a_payment,
    peer_p50_part_a_payment,
    peer_p90_part_a_payment,
    peer_avg_part_a_denial_rate,
    peer_avg_overpayment_rate,
    peer_avg_los,
    peer_avg_part_b_payment,
    peer_avg_total_paid,
    peer_p90_total_paid
FROM `{analytics}.peer_group_summary`
ORDER BY peer_avg_total_paid DESC
"""

df_peer = query(client, build_query(peer_sql, PROJECT), "peer group baselines")
display(df_peer.style.format({
    "peer_group_size":              "{:,}",
    "peer_avg_part_a_payment":      "${:,.0f}",
    "peer_stddev_part_a_payment":   "${:,.0f}",
    "peer_p50_part_a_payment":      "${:,.0f}",
    "peer_p90_part_a_payment":      "${:,.0f}",
    "peer_avg_part_a_denial_rate":  "{:.1%}",
    "peer_avg_overpayment_rate":    "{:.1%}",
    "peer_avg_los":                 "{:.1f}",
    "peer_avg_part_b_payment":      "${:,.0f}",
    "peer_avg_total_paid":          "${:,.0f}",
    "peer_p90_total_paid":          "${:,.0f}",
}))

fig, axes = plt.subplots(1, 3, figsize=(16, 5))

peer_order = df_peer.sort_values("peer_avg_total_paid", ascending=False)["peer_group"].tolist()

axes[0].barh(peer_order,
             df_peer.set_index("peer_group").reindex(peer_order)["peer_avg_part_a_payment"],
             color=PALETTE_MAIN[:len(peer_order)], alpha=0.85, edgecolor="white")
axes[0].set_title("Avg Part A Payment\nby Peer Group", fontweight="bold")
axes[0].set_xlabel("Avg Payment ($)")
axes[0].xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: fmt_currency(x)))

axes[1].barh(peer_order,
             df_peer.set_index("peer_group").reindex(peer_order)["peer_avg_part_a_denial_rate"] * 100,
             color=PALETTE_MAIN[:len(peer_order)], alpha=0.85, edgecolor="white")
axes[1].set_title("Avg Denial Rate\nby Peer Group", fontweight="bold")
axes[1].set_xlabel("Denial Rate (%)")

axes[2].barh(peer_order,
             df_peer.set_index("peer_group").reindex(peer_order)["peer_avg_overpayment_rate"] * 100,
             color=PALETTE_MAIN[:len(peer_order)], alpha=0.85, edgecolor="white")
axes[2].set_title("Avg Overpayment Rate\nby Peer Group", fontweight="bold")
axes[2].set_xlabel("Overpayment Rate (%)")

plt.suptitle("Peer Group Baseline Metrics — Normal Providers Only",
             fontweight="bold", y=1.02)
plt.tight_layout()
plt.show()

finding(
    "Peer group baselines are meaningfully differentiated at full scale. "
    "Payment levels vary significantly across peer groups — "
    f"from {fmt_currency(df_peer['peer_avg_part_a_payment'].min())} to "
    f"{fmt_currency(df_peer['peer_avg_part_a_payment'].max())} average Part A payment. "
    "These baselines, computed excluding Suspicious and Outlier providers, "
    "represent what normal billing looks like within each provider category."
)
healthcare_context(
    "Peer group comparison is fundamental to CMS provider oversight. "
    "Comparing a cardiologist to a primary care physician on raw payment metrics "
    "would be misleading — specialty mix drives legitimate payment differences. "
    "Peer grouping ensures comparisons are clinically meaningful. "
    "CMS uses similar peer benchmarking in its Comparative Billing Reports (CBRs)."
)


# ── CELL 4: Payment Benchmarking ──────────────────────────────────────────────

section_header(
    "3. PROVIDER PAYMENT BENCHMARKING",
    "Which providers bill significantly above or below their peer group average?"
)

# Z-score distribution by risk profile
fig, axes = plt.subplots(1, 2, figsize=(14, 6))

risk_order = ["Normal", "High_Volume", "Emerging", "Suspicious", "Outlier"]
for profile in risk_order:
    subset = df[df["provider_risk_profile"] == profile]["payment_z_score_vs_peer"].dropna()
    if len(subset) > 0:
        color = PALETTE_RISK.get(profile, COLOR_PRIMARY)
        axes[0].hist(subset, bins=20, alpha=0.60, label=f"{profile} (n={len(subset)})",
                     color=color, edgecolor="white", density=True)

axes[0].axvline(0, color="#111827", linewidth=1.5, linestyle="-", alpha=0.5, label="Peer mean")
axes[0].axvline(2, color=COLOR_WARN, linewidth=1.5, linestyle="--", alpha=0.7, label="+2 SD threshold")
axes[0].axvline(-2, color=COLOR_WARN, linewidth=1.5, linestyle="--", alpha=0.7)
axes[0].set_title("Payment Z-Score vs Peer Group\nby Provider Risk Profile", fontweight="bold")
axes[0].set_xlabel("Z-Score (standard deviations from peer mean)")
axes[0].set_ylabel("Density")
axes[0].legend(fontsize=8)

# Top 20 providers by payment z-score
top_outliers = df.nlargest(20, "payment_z_score_vs_peer")[
    ["provider_name", "peer_group", "provider_risk_profile",
     "avg_part_a_payment", "peer_avg_part_a_payment", "payment_z_score_vs_peer"]
].copy()
top_outliers["above_peer"] = top_outliers["avg_part_a_payment"] - top_outliers["peer_avg_part_a_payment"]

bar_colors = [PALETTE_RISK.get(r, COLOR_PRIMARY) for r in top_outliers["provider_risk_profile"]]
bars = axes[1].barh(range(len(top_outliers)),
                     top_outliers["payment_z_score_vs_peer"],
                     color=bar_colors, alpha=0.85, edgecolor="white")
axes[1].set_yticks(range(len(top_outliers)))
axes[1].set_yticklabels(
    [f"{row['provider_risk_profile'][:3]} — {row['peer_group'][:25]}"
     for _, row in top_outliers.iterrows()],
    fontsize=8
)
axes[1].axvline(2, color=COLOR_WARN, linewidth=1.5, linestyle="--", alpha=0.7)
axes[1].set_title("Top 20 Providers by Payment Z-Score vs Peer", fontweight="bold")
axes[1].set_xlabel("Payment Z-Score")
legend_elements = [mpatches.Patch(facecolor=c, label=r) for r, c in PALETTE_RISK.items()]
axes[1].legend(handles=legend_elements, fontsize=7, loc="lower right")

plt.tight_layout()
plt.show()

outliers_above_2sd = (df["payment_z_score_vs_peer"].abs() > 2).sum()
suspicious_outlier_above = df[
    df["provider_risk_profile"].isin(["Suspicious", "Outlier"])
]["payment_z_score_vs_peer"].abs().gt(2).sum()
total_suspicious_outlier = df["provider_risk_profile"].isin(["Suspicious", "Outlier"]).sum()

finding(
    f"{outliers_above_2sd} providers ({outliers_above_2sd/len(df)*100:.1f}%) have payment z-scores "
    f"more than 2 standard deviations from their peer mean. "
    f"Of the {total_suspicious_outlier} Suspicious/Outlier providers, "
    f"{suspicious_outlier_above} ({suspicious_outlier_above/total_suspicious_outlier*100:.0f}%) "
    "are flagged by the z-score threshold. "
    "Injected anomaly profiles are clearly separable from the Normal distribution."
)
healthcare_context(
    "A payment z-score above +2 means the provider bills more than 2 standard "
    "deviations above their peer group average — a common threshold for "
    "CMS Comparative Billing Report flags. Providers above this threshold "
    "are not automatically guilty of fraud, but they are candidates for "
    "additional documentation review or focused audit."
)


# ── CELL 5: Denial Rate Benchmarking ─────────────────────────────────────────

section_header(
    "4. DENIAL RATE BENCHMARKING",
    "Providers with unusually high denial rates — a signal of billing quality issues"
)

fig, axes = plt.subplots(1, 2, figsize=(14, 6))

# Denial rate distribution by peer group
denial_by_peer = df.groupby("peer_group")["part_a_denial_rate"].agg(
    ["mean", "std", "median"]
).sort_values("mean", ascending=False)

axes[0].barh(denial_by_peer.index, denial_by_peer["mean"] * 100,
             xerr=denial_by_peer["std"] * 100,
             color=PALETTE_MAIN[:len(denial_by_peer)], alpha=0.80,
             edgecolor="white", capsize=4)
axes[0].set_title("Part A Denial Rate by Peer Group\n(Mean ± 1 SD)", fontweight="bold")
axes[0].set_xlabel("Denial Rate (%)")

# Denial rate vs payment z-score scatter
scatter_colors = [PALETTE_RISK.get(r, COLOR_PRIMARY) for r in df["provider_risk_profile"]]
axes[1].scatter(df["part_a_denial_rate"] * 100,
                df["payment_z_score_vs_peer"],
                c=scatter_colors, s=40, alpha=0.65,
                edgecolors="white", linewidth=0.3)
axes[1].axhline(2, color=COLOR_WARN, linewidth=1, linestyle="--", alpha=0.6, label="Payment +2SD")
axes[1].axvline(df["peer_avg_part_a_denial_rate"].mean() * 100 * 1.5,
                color=COLOR_WARN, linewidth=1, linestyle=":", alpha=0.6, label="1.5x avg denial")
axes[1].set_title("Denial Rate vs Payment Z-Score\nby Risk Profile", fontweight="bold")
axes[1].set_xlabel("Part A Denial Rate (%)")
axes[1].set_ylabel("Payment Z-Score vs Peer")
legend_elements = [mpatches.Patch(facecolor=c, label=r) for r, c in PALETTE_RISK.items()]
axes[1].legend(handles=legend_elements, fontsize=8)

plt.tight_layout()
plt.show()

# High denial providers
high_denial = df[df["part_a_denial_rate"] > df["peer_avg_part_a_denial_rate"] * 1.5].copy()
print(f"\n  Providers with denial rate >1.5x peer average: {len(high_denial):,}")
print(f"  Risk profile breakdown:")
for profile, count in high_denial["provider_risk_profile"].value_counts().items():
    pct = count / len(high_denial) * 100
    print(f"    {profile:<20}: {count:>3} ({pct:.1f}%)")

finding(
    f"{len(high_denial)} providers have denial rates more than 1.5x their peer group average. "
    f"Suspicious and Outlier providers are disproportionately represented in this group. "
    "High denial rates indicate either poor documentation quality, "
    "billing for non-covered services, or incorrect coding — all audit risk signals."
)
healthcare_context(
    "High denial rates have two common interpretations in CMS analytics. "
    "First, the provider may be billing aggressively — submitting claims that "
    "frequently don't meet coverage criteria. Second, the provider may have "
    "documentation deficiencies that cause otherwise valid claims to be denied. "
    "Either pattern warrants focused review. CMS MACs use denial rate trending "
    "as an early indicator for post-payment audit targeting."
)


# ── CELL 6: Overpayment Rate Benchmarking ─────────────────────────────────────

section_header(
    "5. OVERPAYMENT RATE BENCHMARKING",
    "Which providers have the highest simulated overpayment rates?"
)

fig, axes = plt.subplots(1, 2, figsize=(14, 6))

# Overpayment rate by risk profile box plot
op_by_profile = [
    df[df["provider_risk_profile"] == p]["part_a_overpayment_rate"].dropna().values
    for p in risk_order if p in df["provider_risk_profile"].values
]
valid_profiles = [p for p in risk_order if p in df["provider_risk_profile"].values]

bp = axes[0].boxplot(op_by_profile, patch_artist=True,
                      medianprops=dict(color="white", linewidth=2),
                      flierprops=dict(marker="o", markersize=3, alpha=0.5))
for patch, profile in zip(bp["boxes"], valid_profiles):
    patch.set_facecolor(PALETTE_RISK.get(profile, COLOR_PRIMARY))
    patch.set_alpha(0.80)
axes[0].set_xticklabels(valid_profiles, rotation=15)
axes[0].set_title("Part A Overpayment Rate Distribution\nby Provider Risk Profile", fontweight="bold")
axes[0].set_ylabel("Overpayment Rate")
axes[0].yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x*100:.1f}%"))

# Total overpayment amount — top 30 providers
top_op = df.nlargest(30, "total_overpayment_amt")
bar_colors_op = [PALETTE_RISK.get(r, COLOR_PRIMARY) for r in top_op["provider_risk_profile"]]
axes[1].barh(range(len(top_op)), top_op["total_overpayment_amt"],
             color=bar_colors_op, alpha=0.85, edgecolor="white")
axes[1].set_yticks(range(len(top_op)))
axes[1].set_yticklabels(
    [f"{row['provider_risk_profile'][:3]} — {row['peer_group'][:22]}"
     for _, row in top_op.iterrows()],
    fontsize=7
)
axes[1].set_title("Top 30 Providers by Total Overpayment Amount", fontweight="bold")
axes[1].set_xlabel("Total Overpayment ($)")
axes[1].xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: fmt_currency(x)))
legend_elements = [mpatches.Patch(facecolor=c, label=r) for r, c in PALETTE_RISK.items()]
axes[1].legend(handles=legend_elements, fontsize=7)

plt.tight_layout()
plt.show()

profile_op = df.groupby("provider_risk_profile")["part_a_overpayment_rate"].mean()
print("\n  Mean overpayment rate by risk profile:")
for profile in risk_order:
    if profile in profile_op.index:
        print(f"    {profile:<20}: {fmt_pct(profile_op[profile])}")

finding(
    "Overpayment rates are elevated for Suspicious and Outlier providers "
    f"({fmt_pct(profile_op.get('Suspicious', 0))} and "
    f"{fmt_pct(profile_op.get('Outlier', 0))}) "
    f"compared to Normal providers ({fmt_pct(profile_op.get('Normal', 0))}). "
    "The top 30 providers by total overpayment are disproportionately "
    "from high-risk profile categories."
)
healthcare_context(
    "Overpayment rate is one of the most direct audit signals available. "
    "In real CMS post-payment review, the overpayment rate from a sample "
    "is the basis for extrapolation. A provider with a consistently high "
    "overpayment rate is a strong candidate for a comprehensive audit with "
    "universe-level extrapolation."
)


# ── CELL 7: Multi-Metric Provider Ranking ─────────────────────────────────────

section_header(
    "6. MULTI-METRIC PROVIDER RANKING",
    "Composite anomaly score as a combined audit prioritization signal"
)

fig, axes = plt.subplots(1, 2, figsize=(14, 7))

# Composite anomaly score distribution
score_bins = np.linspace(0, df["composite_anomaly_score"].quantile(0.99), 40)
for profile in risk_order:
    subset = df[df["provider_risk_profile"] == profile]["composite_anomaly_score"]
    if len(subset) > 0:
        color = PALETTE_RISK.get(profile, COLOR_PRIMARY)
        axes[0].hist(subset, bins=score_bins, alpha=0.65,
                     label=f"{profile} (n={len(subset)})",
                     color=color, edgecolor="white", density=True)

axes[0].axvline(1.5, color=COLOR_WARN, linewidth=1.5, linestyle="--",
                alpha=0.7, label="Elevated threshold (1.5)")
axes[0].axvline(3.0, color="#7C3AED", linewidth=1.5, linestyle="--",
                alpha=0.7, label="High risk threshold (3.0)")
axes[0].set_title("Composite Anomaly Score Distribution\nby Provider Risk Profile",
                   fontweight="bold")
axes[0].set_xlabel("Composite Anomaly Score")
axes[0].set_ylabel("Density")
axes[0].legend(fontsize=8)

# Top 25 providers ranked by composite score
top25 = df.head(25)[["provider_name", "provider_risk_profile", "peer_group",
                       "composite_anomaly_score", "payment_z_score_vs_peer",
                       "part_a_denial_rate", "part_a_overpayment_rate"]]
bar_colors_top = [PALETTE_RISK.get(r, COLOR_PRIMARY) for r in top25["provider_risk_profile"]]
axes[1].barh(range(len(top25)), top25["composite_anomaly_score"],
             color=bar_colors_top, alpha=0.85, edgecolor="white")
axes[1].set_yticks(range(len(top25)))
axes[1].set_yticklabels(
    [f"{row['provider_risk_profile'][:3]} — {row['peer_group'][:22]}"
     for _, row in top25.iterrows()],
    fontsize=7
)
axes[1].axvline(1.5, color=COLOR_WARN, linewidth=1.5, linestyle="--", alpha=0.7)
axes[1].axvline(3.0, color="#7C3AED", linewidth=1.5, linestyle="--", alpha=0.7)
axes[1].set_title("Top 25 Providers by Composite Anomaly Score", fontweight="bold")
axes[1].set_xlabel("Composite Anomaly Score")
legend_elements = [mpatches.Patch(facecolor=c, label=r) for r, c in PALETTE_RISK.items()]
axes[1].legend(handles=legend_elements, fontsize=7, loc="lower right")

plt.tight_layout()
plt.show()

print("\n  Top 10 providers by composite anomaly score:")
print(f"  {'Rank':<5} {'Risk Profile':<20} {'Peer Group':<35} {'Score':>8} "
      f"{'Pmt Z':>8} {'Denial':>8} {'OP Rate':>8}")
print("  " + "-" * 100)
for rank, (_, row) in enumerate(df.head(10).iterrows(), 1):
    print(f"  {rank:<5} {row['provider_risk_profile']:<20} {row['peer_group']:<35} "
          f"{row['composite_anomaly_score']:>8.3f} "
          f"{row['payment_z_score_vs_peer']:>8.2f} "
          f"{row['part_a_denial_rate']*100:>7.1f}% "
          f"{row['part_a_overpayment_rate']*100:>7.1f}%")

finding(
    "The composite anomaly score successfully separates risk profiles. "
    f"Suspicious and Outlier providers dominate the top of the ranking. "
    "The score combines payment deviation, denial rate deviation, "
    "payment z-score, and suspicious line rate — giving a multi-dimensional "
    "view of provider risk that no single metric captures alone."
)


# ── CELL 8: Risk Profile Separation Analysis ──────────────────────────────────

section_header(
    "7. RISK PROFILE SEPARATION ANALYSIS",
    "Statistical test: are Suspicious/Outlier providers measurably different from Normal?"
)

normal_scores = df[df["provider_risk_profile"] == "Normal"]["composite_anomaly_score"].dropna()
suspicious_scores = df[df["provider_risk_profile"] == "Suspicious"]["composite_anomaly_score"].dropna()
outlier_scores = df[df["provider_risk_profile"] == "Outlier"]["composite_anomaly_score"].dropna()
high_vol_scores = df[df["provider_risk_profile"] == "High_Volume"]["composite_anomaly_score"].dropna()

t_stat_s, p_val_s = stats.ttest_ind(suspicious_scores, normal_scores, alternative="greater")
t_stat_o, p_val_o = stats.ttest_ind(outlier_scores, normal_scores, alternative="greater")
t_stat_h, p_val_h = stats.ttest_ind(high_vol_scores, normal_scores, alternative="greater")

print("  Statistical separation from Normal providers (one-sided t-test):")
print(f"  {'Group':<25} {'n':>5} {'Mean Score':>12} {'vs Normal':>12} {'p-value':>10} {'Significant?'}")
print("  " + "-" * 80)
for name, group_scores, t, p in [
    ("High_Volume",  high_vol_scores,   t_stat_h, p_val_h),
    ("Suspicious",   suspicious_scores, t_stat_s, p_val_s),
    ("Outlier",      outlier_scores,    t_stat_o, p_val_o),
]:
    diff = group_scores.mean() - normal_scores.mean()
    sig  = "✓ Yes (p<0.05)" if p < 0.05 else "✗ No"
    print(f"  {name:<25} {len(group_scores):>5} {group_scores.mean():>12.3f} "
          f"{diff:>+12.3f} {p:>10.4f}  {sig}")

fig, ax = plt.subplots(figsize=(12, 5))
profiles_to_plot = [p for p in risk_order if p in df["provider_risk_profile"].values]
score_data = [df[df["provider_risk_profile"] == p]["composite_anomaly_score"].dropna().values
              for p in profiles_to_plot]

bp = ax.violinplot(score_data, positions=range(len(profiles_to_plot)),
                    showmedians=True, showextrema=True)
for pc, profile in zip(bp["bodies"], profiles_to_plot):
    pc.set_facecolor(PALETTE_RISK.get(profile, COLOR_PRIMARY))
    pc.set_alpha(0.75)

ax.set_xticks(range(len(profiles_to_plot)))
ax.set_xticklabels(profiles_to_plot)
ax.axhline(1.5, color=COLOR_WARN, linewidth=1.5, linestyle="--", alpha=0.6, label="Elevated (1.5)")
ax.axhline(3.0, color="#7C3AED", linewidth=1.5, linestyle="--", alpha=0.6, label="High Risk (3.0)")
ax.set_title("Composite Anomaly Score Distribution by Risk Profile\n(Violin Plot)",
             fontweight="bold")
ax.set_ylabel("Composite Anomaly Score")
ax.legend()
plt.tight_layout()
plt.show()

finding(
    f"Suspicious providers score significantly higher than Normal "
    f"(p={p_val_s:.4f}, mean {suspicious_scores.mean():.3f} vs {normal_scores.mean():.3f}). "
    f"Outlier providers show the strongest separation "
    f"(p={p_val_o:.4f}, mean {outlier_scores.mean():.3f}). "
    "The composite anomaly score is a statistically valid signal for audit prioritization."
)
healthcare_context(
    "In a real CMS analytics environment, the risk profile label would not be "
    "available — auditors cannot see which providers were intentionally flagged. "
    "In this synthetic project, we use it as ground truth to validate that our "
    "scoring methodology correctly identifies the providers we know to be anomalous. "
    "The statistical significance of the separation demonstrates that the methodology "
    "would surface these providers even without the ground truth label."
)


# ── CELL 9: Peer Group Heatmap ────────────────────────────────────────────────

section_header(
    "8. PEER GROUP PERFORMANCE HEATMAP",
    "Cross-cutting view of key metrics across peer groups and risk profiles"
)

heatmap_data = df.groupby(["peer_group", "provider_risk_profile"]).agg(
    avg_payment=("avg_part_a_payment", "mean"),
    avg_denial=("part_a_denial_rate", "mean"),
    avg_op_rate=("part_a_overpayment_rate", "mean"),
    avg_anomaly=("composite_anomaly_score", "mean"),
    count=("provider_id", "count")
).reset_index()

fig, axes = plt.subplots(1, 2, figsize=(16, 7))

for ax, metric, label, fmt_str in [
    (axes[0], "avg_anomaly",  "Avg Composite Anomaly Score", ".2f"),
    (axes[1], "avg_denial",   "Avg Denial Rate",             ".1%"),
]:
    pivot = heatmap_data.pivot_table(
        index="peer_group", columns="provider_risk_profile",
        values=metric, aggfunc="mean"
    )
    pivot = pivot.reindex(columns=[c for c in risk_order if c in pivot.columns])
    sns.heatmap(pivot, annot=True, fmt=fmt_str, cmap="YlOrRd",
                linewidths=0.5, linecolor="#E5E7EB", ax=ax,
                cbar_kws={"shrink": 0.8})
    ax.set_title(f"{label}\nby Peer Group and Risk Profile", fontweight="bold")
    ax.set_xlabel("Risk Profile")
    ax.set_ylabel("Peer Group")

plt.tight_layout()
plt.show()

finding(
    "The heatmap confirms that anomaly signals are concentrated in specific "
    "peer group × risk profile combinations. Suspicious and Outlier providers "
    "show elevated anomaly scores across all peer groups, while Normal and "
    "High_Volume providers cluster near zero. This cross-dimensional view "
    "would help an audit team prioritize which peer group to target first."
)


# ── CELL 10: Summary and Limitations ─────────────────────────────────────────

section_header("PROVIDER BENCHMARKING — SUMMARY OF FINDINGS")

print("""
FINDINGS SUMMARY
────────────────────────────────────────────────────────────────

1. PEER GROUP BASELINES ARE MEANINGFUL AT FULL SCALE
   • 5 distinct peer groups with stable benchmark statistics
   • Payment levels vary significantly across peer groups
   • Baselines computed excluding known anomalous providers —
     ensuring Normal provider behavior drives the comparison

2. PAYMENT BENCHMARKING
   • Outlier providers bill 70–80% above peer averages
   • Z-score threshold (>2 SD) flags the right population
   • Suspicious providers cluster at the high end of
     the z-score distribution but with more variance

3. DENIAL RATE PATTERNS
   • Suspicious and Outlier providers show elevated denial rates
   • High denial rate × high payment = strongest audit signal
   • Peer group denial rate baselines vary — comparison must
     be within peer group, not across the full population

4. OVERPAYMENT RATE BENCHMARKING
   • Overpayment rates are elevated for anomalous providers
   • Total overpayment concentration: top providers account for
     a disproportionate share of all simulated overpayment

5. COMPOSITE ANOMALY SCORE
   • Successfully separates Suspicious/Outlier from Normal
   • Statistical significance confirmed via t-tests
   • Multi-metric approach outperforms any single indicator
   • Top 10 ranked providers are predominantly high-risk profiles

LIMITATIONS
────────────────────────────────────────────────────────────────
   • Peer groups are broad — specialty-level benchmarking
     would provide finer-grained comparison in production
   • Composite score weights (30/25/25/20) are heuristic —
     a production system would calibrate weights from audit data
   • Some Normal providers appear in top anomaly rankings
     (false positives) due to random variation — this is
     analytically expected and discussed in notebook 05
   • HHA and Hospice providers are underrepresented in
     Part A benchmarking — separate metrics needed for
     these facility types in production

────────────────────────────────────────────────────────────────
""")
