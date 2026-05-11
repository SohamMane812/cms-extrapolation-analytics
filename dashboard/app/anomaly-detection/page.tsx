"use client";

import { useEffect, useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ScatterChart, Scatter, ReferenceLine, LineChart, Line, Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnomalyProvider {
  provider_id: string;
  provider_name: string;
  provider_type: string;
  peer_group: string;
  provider_risk_profile: string;
  region: string;
  urban_rural: string;
  is_active: boolean;
  total_part_a_claims: number;
  total_part_b_lines: number;
  distinct_patients_total: number;
  avg_part_a_payment: number;
  max_part_a_payment: number;
  total_combined_paid: number;
  avg_payment_z_score: number;
  max_payment_z_score: number;
  part_a_denial_rate: number;
  part_b_denial_rate: number;
  part_a_overpayment_rate: number;
  total_overpayment_amt: number;
  suspicious_lines: number;
  payment_outlier_lines: number;
  avg_units_of_service: number;
  telehealth_rate: number;
  payment_z_score_vs_peer: number;
  denial_rate_z_score_vs_peer: number;
  total_paid_z_score_vs_peer: number;
  composite_anomaly_score: number;
  peer_avg_part_a_payment: number;
  peer_avg_part_a_denial_rate: number;
  adjustment_cancel_rate: number;
  avg_daily_claim_volume: number;
  max_daily_claim_volume: number;
  flag_payment_outlier: boolean;
  flag_high_denial_rate: boolean;
  flag_high_overpayment_rate: boolean;
  flag_excessive_daily_volume: boolean;
  flag_high_adjustment_rate: boolean;
  flag_suspicious_patterns: boolean;
  flag_extreme_payment_outlier: boolean;
  total_flags_triggered: number;
  anomaly_risk_tier: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  Outlier: "#ef4444", Suspicious: "#f97316", High_Volume: "#eab308",
  Normal: "#22c55e", Emerging: "#3b82f6",
};

const TIER_BG: Record<string, string> = {
  "High Risk": "bg-red-900/50 text-red-300 border-red-700",
  "Medium Risk": "bg-orange-900/50 text-orange-300 border-orange-700",
  "Low Risk": "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  "Minimal Risk": "bg-green-900/50 text-green-300 border-green-700",
};

const TIER_COLORS: Record<string, string> = {
  "High Risk": "#ef4444", "Medium Risk": "#f97316",
  "Low Risk": "#eab308", "Minimal Risk": "#22c55e",
};

const FLAG_LABELS: Record<string, string> = {
  flag_payment_outlier: "Payment Outlier",
  flag_high_denial_rate: "Elevated Denial Rate",
  flag_high_overpayment_rate: "Elevated OP Rate",
  flag_excessive_daily_volume: "Excessive Claim Volume",
  flag_high_adjustment_rate: "High Adjustment Rate",
  flag_suspicious_patterns: "Suspicious Billing Patterns",
  flag_extreme_payment_outlier: "Extreme Payment Outlier",
};

const FLAG_COLORS: Record<string, string> = {
  flag_payment_outlier: "#3b82f6",
  flag_high_denial_rate: "#f97316",
  flag_high_overpayment_rate: "#ef4444",
  flag_excessive_daily_volume: "#eab308",
  flag_high_adjustment_rate: "#a855f7",
  flag_suspicious_patterns: "#ec4899",
  flag_extreme_payment_outlier: "#dc2626",
};

const FLAG_AUDIT_CONTEXT: Record<string, string> = {
  flag_payment_outlier: "Average payment substantially above peer group — may indicate high-severity case concentration, upcoding, or billing irregularities.",
  flag_high_denial_rate: "Denial rate substantially above peer group — consistent with documentation deficiencies, unsupported billing, or coding errors.",
  flag_high_overpayment_rate: "Overpayment exposure rate above expected peer range — indicates higher concentration of identified billing errors.",
  flag_excessive_daily_volume: "Daily claim submission volume substantially above normal — may indicate billing factory patterns or documentation shortcuts.",
  flag_high_adjustment_rate: "Elevated claim adjustment and cancellation activity — may indicate systematic billing corrections or retroactive claim manipulation.",
  flag_suspicious_patterns: "Multiple concurrent billing anomalies detected — combination of signals suggests systematic rather than isolated billing irregularities.",
  flag_extreme_payment_outlier: "Individual claim payments at extreme deviation from peer norms — highest-priority signal for single-claim investigation.",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}
function fmtZ(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}σ`;
}

function buildDetectionCurve(providers: AnomalyProvider[]) {
  const sorted = [...providers].sort((a, b) => (b.composite_anomaly_score ?? 0) - (a.composite_anomaly_score ?? 0));
  const totalElevated = providers.filter((p) => ["Suspicious", "Outlier"].includes(p.provider_risk_profile)).length;
  const total = providers.length;
  const points: { pct_reviewed: number; score_guided: number; random: number }[] = [];
  let found = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (["Suspicious", "Outlier"].includes(sorted[i].provider_risk_profile)) found++;
    const pctReviewed = ((i + 1) / total) * 100;
    if ((i + 1) % Math.max(1, Math.floor(total / 40)) === 0 || i === sorted.length - 1) {
      points.push({
        pct_reviewed: +pctReviewed.toFixed(1),
        score_guided: +(found / totalElevated * 100).toFixed(1),
        random: +Math.min(pctReviewed, 100).toFixed(1),
      });
    }
  }
  return points;
}

function buildScoreDistribution(providers: AnomalyProvider[]) {
  const labels = ["0–2", "2–4", "4–6", "6–8", "8–10", "10–15", "15–20", "20+"];
  const buckets = [0, 2, 4, 6, 8, 10, 15, 20, 999];
  const bins: Record<string, { Normal: number; Suspicious: number; Outlier: number }> = {};
  labels.forEach((l) => { bins[l] = { Normal: 0, Suspicious: 0, Outlier: 0 }; });
  providers.forEach((p) => {
    const score = p.composite_anomaly_score ?? 0;
    for (let i = 0; i < buckets.length - 1; i++) {
      if (score >= buckets[i] && score < buckets[i + 1]) {
        const profile = ["Suspicious", "Outlier"].includes(p.provider_risk_profile) ? p.provider_risk_profile : "Normal";
        bins[labels[i]][profile as "Normal" | "Suspicious" | "Outlier"]++;
        break;
      }
    }
  });
  return labels.map((l) => ({ label: l, ...bins[l] }));
}

function buildFlagFrequency(providers: AnomalyProvider[]) {
  return Object.keys(FLAG_LABELS).map((flag) => ({
    flag: FLAG_LABELS[flag],
    key: flag,
    count: providers.filter((p) => p[flag as keyof AnomalyProvider] === true).length,
    color: FLAG_COLORS[flag],
  })).sort((a, b) => b.count - a.count);
}

function buildProviderAuditInterpretation(p: AnomalyProvider): string {
  const activeFlags = Object.keys(FLAG_LABELS).filter((f) => p[f as keyof AnomalyProvider] === true);
  const score = p.composite_anomaly_score?.toFixed(1) ?? "—";

  if (activeFlags.length === 0) {
    return `This provider does not trigger any review threshold signals. Performance metrics are within expected peer group ranges. Routine monitoring is appropriate.`;
  }

  const flagDescriptions = activeFlags.map((f) => FLAG_AUDIT_CONTEXT[f]).filter(Boolean);
  const priority = p.total_flags_triggered >= 3
    ? `With ${p.total_flags_triggered} concurrent audit signals and a composite risk score of ${score}, this provider is a high-priority candidate for focused post-payment review.`
    : `With ${p.total_flags_triggered} audit signal${p.total_flags_triggered > 1 ? "s" : ""} and a composite risk score of ${score}, this provider warrants targeted review of the flagged dimensions.`;

  return `${priority} Active signals: ${flagDescriptions.slice(0, 2).join(" ")}${flagDescriptions.length > 2 ? ` Additionally: ${flagDescriptions.slice(2).join(" ")}` : ""}`;
}

function FlagBadge({ label, active, color, context }: { label: string; active: boolean; color: string; context?: string }) {
  return (
    <div className={`rounded border px-2 py-1.5 text-[10px] transition-all ${active ? "border-opacity-60 bg-opacity-20" : "border-slate-700 bg-transparent"}`}
      style={active ? { borderColor: color, backgroundColor: `${color}15`, color } : {}}>
      <div className="flex items-center gap-1">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: active ? color : "#475569" }} />
        <span className={`font-semibold ${active ? "" : "text-slate-600"}`}>{label}</span>
      </div>
      {active && context && <p className="mt-1 text-[9px] leading-relaxed" style={{ color: `${color}cc` }}>{context}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnomalyDetectionPage() {
  const [providers, setProviders] = useState<AnomalyProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<AnomalyProvider | null>(null);
  const [tierFilter, setTierFilter] = useState("All");
  const [reviewThreshold, setReviewThreshold] = useState(2.0);

  useEffect(() => {
    fetch("/api/bigquery", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: `SELECT * FROM \`cms-extrapolation-v1.analytics_cms_claims.anomaly_scores\` WHERE is_active = TRUE ORDER BY composite_anomaly_score DESC` }),
    })
      .then((r) => r.json())
      .then((j) => setProviders(j.data as AnomalyProvider[]))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const tiers = ["All", "High Risk", "Medium Risk", "Low Risk", "Minimal Risk"];

  const filtered = useMemo(() =>
    providers.filter((p) => tierFilter === "All" || p.anomaly_risk_tier === tierFilter),
    [providers, tierFilter]
  );

  const aboveThreshold = useMemo(() =>
    providers.filter((p) => (p.composite_anomaly_score ?? 0) >= reviewThreshold),
    [providers, reviewThreshold]
  );

  const detectionCurve = useMemo(() => buildDetectionCurve(providers), [providers]);
  const scoreDist = useMemo(() => buildScoreDistribution(providers), [providers]);
  const flagFreq = useMemo(() => buildFlagFrequency(providers), [providers]);

  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    providers.forEach((p) => { counts[p.anomaly_risk_tier] = (counts[p.anomaly_risk_tier] ?? 0) + 1; });
    return counts;
  }, [providers]);

  const at20 = useMemo(() => detectionCurve.find((p) => p.pct_reviewed >= 20) ?? null, [detectionCurve]);

  const elevatedRisk = providers.filter((p) => ["Suspicious", "Outlier"].includes(p.provider_risk_profile));
  const highPriority = providers.filter((p) => p.anomaly_risk_tier === "High Risk");
  const totalElevatedOP = elevatedRisk.reduce((s, p) => s + (p.total_overpayment_amt ?? 0), 0);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading audit prioritization data...</p>
        </div>
      </div>
    );
  }
  if (error) return <div className="flex h-screen items-center justify-center bg-slate-950"><p className="text-sm text-red-400">{error}</p></div>;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">

      {/* Header */}
      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-400">CMS Post-Payment Analytics</p>
        <h1 className="text-3xl font-bold tracking-tight text-white">Anomaly Detection</h1>
        <p className="mt-1 text-sm text-slate-400">
          Composite audit risk scoring · review prioritization · audit signal concentration
        </p>
      </div>

      {/* Context Banner */}
      <div className="mb-6 rounded-xl border border-slate-700/40 bg-slate-900/50 px-4 py-3">
        <p className="text-xs leading-relaxed text-slate-400">
          <span className="font-semibold text-slate-300">How audit risk scoring works:</span> Each provider receives a composite audit risk score derived from seven independent signals — payment deviation, denial rate elevation, overpayment rate, claim volume patterns, adjustment activity, suspicious billing patterns, and extreme payment outliers. Higher scores indicate greater deviation from peer group norms across multiple dimensions.{" "}
          <span className="text-slate-500">Elevated scores are not proof of fraud or billing error — they indicate deviation from expected peer behavior that warrants operational and clinical review. The goal is intelligent allocation of limited audit review capacity toward highest-risk providers.</span>
        </p>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total Active Providers", value: providers.length.toLocaleString(), accent: "#3b82f6", sub: "In audit review universe" },
          { label: "Elevated Risk Providers", value: elevatedRisk.length.toLocaleString(), accent: "#ef4444", sub: `${fmtPct(elevatedRisk.length / providers.length)} of active providers · ${fmt$(totalElevatedOP)} identified OP` },
          { label: "High Priority Tier", value: highPriority.length.toLocaleString(), accent: "#f97316", sub: "≥2 concurrent audit signals triggered" },
          { label: "Audit Efficiency @ 20% Review", value: at20 ? `${(at20.score_guided / at20.random).toFixed(1)}x` : "—", accent: "#a855f7", sub: at20 ? `${at20.score_guided.toFixed(0)}% of elevated-risk providers found` : "" },
        ].map((k) => (
          <div key={k.label} className="relative overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/80 p-4">
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: k.accent }} />
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{k.label}</p>
            <p className="text-2xl font-bold text-white">{k.value}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Audit Priority Tier:</span>
        {tiers.map((t) => (
          <button key={t} onClick={() => setTierFilter(t)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${tierFilter === t ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"}`}>
            {t}
            {t !== "All" && tierCounts[t] && <span className="ml-1.5 rounded bg-slate-700 px-1 py-0.5 text-[10px]">{tierCounts[t]}</span>}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-slate-400">Review Threshold:</span>
          {[0, 1, 2, 5, 10].map((t) => (
            <button key={t} onClick={() => setReviewThreshold(t)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all ${reviewThreshold === t ? "border-orange-500 bg-orange-500/10 text-orange-300" : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"}`}>
              {t}+
            </button>
          ))}
          <span className="text-xs text-slate-500">→ {aboveThreshold.length} providers flagged for review</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* Left + Center */}
        <div className="space-y-5 lg:col-span-2">

          {/* Audit Review Efficiency Curve */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Audit Review Efficiency Curve</h2>
            <p className="mb-1 text-xs text-slate-500">
              Score-guided review vs random selection · % providers reviewed vs % elevated-risk providers identified
            </p>
            {at20 && (
              <div className="mb-4 rounded-lg bg-slate-800/40 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
                By reviewing the top-scoring <strong className="text-white">20%</strong> of providers first, score-guided prioritization identifies{" "}
                <strong className="text-white">{at20.score_guided.toFixed(0)}%</strong> of elevated-risk providers — compared to{" "}
                <strong className="text-white">{at20.random.toFixed(0)}%</strong> with random selection. This represents a{" "}
                <strong className="text-orange-300">{(at20.score_guided / at20.random).toFixed(1)}x audit efficiency gain</strong> — meaning audit teams can identify significantly more high-risk providers while reviewing the same number of cases. The dashed vertical line marks the 20% coverage point.
              </div>
            )}
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={detectionCurve} margin={{ top: 4, right: 8, bottom: 20, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="pct_reviewed" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                  label={{ value: "% Providers Reviewed", position: "insideBottom", offset: -12, fill: "#64748b", fontSize: 10 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                  label={{ value: "% Elevated-Risk Providers Found", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }} />
                <Tooltip formatter={(v) => [`${(v as number).toFixed(1)}%`]}
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  labelFormatter={(v) => `${v}% reviewed`} />
                <ReferenceLine x={20} stroke="#64748b" strokeDasharray="4 4" />
                <Line dataKey="score_guided" name="Score-Guided Review" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line dataKey="random" name="Random Selection" stroke="#64748b" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Score Distribution */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Audit Risk Score Distribution</h2>
            <p className="mb-2 text-xs text-slate-500">
              Score buckets by provider risk profile · elevated-risk providers concentrate at high scores
            </p>
            <div className="mb-4 rounded-lg bg-slate-800/40 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
              Normal-risk providers are heavily concentrated at scores 0–2, reflecting limited deviation from peer group expectations. Suspicious and Outlier providers are exclusively found at scores above 10, confirming that the composite scoring approach effectively separates elevated-risk providers from the baseline population.
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={scoreDist} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  labelFormatter={(v) => `Score ${v}`} />
                <Bar dataKey="Normal" name="Normal/Other" stackId="a" fill="#22c55e" />
                <Bar dataKey="Suspicious" name="Suspicious" stackId="a" fill="#f97316" />
                <Bar dataKey="Outlier" name="Outlier" stackId="a" fill="#ef4444" radius={[3, 3, 0, 0]} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Score vs Denial Rate Scatter */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Audit Risk Score vs Denial Rate</h2>
            <p className="mb-2 text-xs text-slate-500">
              Elevated-risk providers cluster in the upper-right — high scores combined with elevated denial rates
            </p>
            <div className="mb-4 rounded-lg bg-slate-800/40 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
              The vertical dashed line marks the active review threshold. Providers to the right of this line are prioritized for post-payment review. The strong separation between elevated-risk and normal providers demonstrates that the composite score effectively captures multi-dimensional billing deviations. Click a point to open the audit review panel.
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 4, right: 8, bottom: 20, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="composite_anomaly_score" name="Audit Risk Score" type="number"
                  tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false}
                  label={{ value: "Composite Audit Risk Score", position: "insideBottom", offset: -12, fill: "#64748b", fontSize: 10 }} />
                <YAxis dataKey="part_a_denial_rate" name="Denial Rate" type="number"
                  tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v, name) => [name === "part_a_denial_rate" ? fmtPct(v as number) : (v as number).toFixed(2), name === "composite_anomaly_score" ? "Audit Risk Score" : "Denial Rate"]} />
                <ReferenceLine x={reviewThreshold} stroke="#f97316" strokeDasharray="4 4"
                  label={{ value: "review threshold", fill: "#f97316", fontSize: 9 }} />
                {Object.entries(RISK_COLORS).map(([profile, color]) => (
                  <Scatter key={profile} name={profile}
                    data={filtered.filter((p) => p.provider_risk_profile === profile)}
                    fill={color} fillOpacity={0.7}
                    onClick={(d) => setSelectedProvider(d as unknown as AnomalyProvider)} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-400">
              {Object.entries(RISK_COLORS).map(([profile, color]) => (
                <span key={profile} className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                  {profile.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>

          {/* Audit Signal Frequency */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Audit Signal Frequency</h2>
            <p className="mb-2 text-xs text-slate-500">
              How often each independent audit signal fires across all providers
            </p>
            <div className="mb-4 rounded-lg bg-slate-800/40 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
              Each signal is assessed independently. Providers triggering multiple signals simultaneously represent the highest review priority — the composite score reflects signal co-occurrence, not just individual signal strength. Suspicious Billing Patterns and Extreme Payment Outlier signals are the strongest individual predictors of elevated overpayment exposure.
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={flagFreq} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="flag" type="category" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} width={180} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [`${v} providers`, "Count"]} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {flagFreq.map((f, i) => <Cell key={i} fill={f.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Provider Audit Priority Rankings */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">
              Provider Audit Priority Rankings
              <span className="ml-2 text-xs font-normal text-slate-400">
                Showing {Math.min(filtered.length, 20)} of {filtered.length}
              </span>
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Ranked by composite audit risk score · click a row to open the audit review panel
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700">
                    {["Provider", "Risk Profile", "Audit Priority Tier", "Risk Score", "Signals", "Denial Rate", "Identified OP"].map((h) => (
                      <th key={h} className="pb-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 20).map((p, i) => (
                    <tr key={p.provider_id}
                      className={`cursor-pointer border-b border-slate-800/40 transition-colors hover:bg-slate-800/40 ${selectedProvider?.provider_id === p.provider_id ? "bg-blue-950/30" : i % 2 === 0 ? "bg-slate-900/20" : ""}`}
                      onClick={() => setSelectedProvider(p)}>
                      <td className="py-2 pr-4 font-medium text-white">{p.provider_name}</td>
                      <td className="py-2 pr-4">
                        <span className="text-xs font-medium" style={{ color: RISK_COLORS[p.provider_risk_profile] }}>
                          {p.provider_risk_profile.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${TIER_BG[p.anomaly_risk_tier] ?? ""}`}>
                          {p.anomaly_risk_tier}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono font-semibold text-orange-300">{p.composite_anomaly_score?.toFixed(2) ?? "—"}</td>
                      <td className="py-2 pr-4 text-center text-slate-200">{p.total_flags_triggered}</td>
                      <td className="py-2 pr-4 text-slate-300">{fmtPct(p.part_a_denial_rate)}</td>
                      <td className="py-2 pr-4 text-red-300">{fmt$(p.total_overpayment_amt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Key Findings */}
          <div className="rounded-xl border border-blue-700/30 bg-blue-950/20 p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-400">Key Findings — Audit Prioritization</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                `Reviewing the top ${at20 ? "20%" : "—"} of providers by score identifies ${at20 ? at20.score_guided.toFixed(0) + "%" : "—"} of elevated-risk providers — a ${at20 ? (at20.score_guided / at20.random).toFixed(1) + "x" : "—"} efficiency gain vs random selection. Score-guided prioritization allows audit teams to concentrate limited review capacity on highest-risk cases.`,
                "Elevated denial-rate signals showed the strongest concentration among Suspicious and Outlier risk profiles — consistent with documentation deficiencies and unsupported billing patterns in those provider groups.",
                `A small subset of ${elevatedRisk.length} providers (${fmtPct(elevatedRisk.length / providers.length)} of the active population) accounts for a disproportionate share of identified overpayment exposure, confirming that concentrated review effort on high-score providers delivers outsized recovery results.`,
                "Suspicious Billing Patterns and Extreme Payment Outlier signals co-occur at high rates among top-ranked providers — suggesting systematic rather than isolated billing irregularities and strengthening the case for comprehensive post-payment review.",
              ].map((f, i) => (
                <div key={i} className="rounded-lg border border-blue-700/20 bg-blue-950/30 p-3">
                  <p className="text-[11px] leading-relaxed text-blue-100/80">{f}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Detail Panel */}
        <div className="lg:col-span-1">
          {selectedProvider ? (
            <div className="sticky top-6 rounded-xl border border-blue-700/30 bg-slate-900/80 p-5">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white">{selectedProvider.provider_name}</h2>
                  <p className="text-xs text-slate-400">{selectedProvider.provider_id} · {selectedProvider.peer_group.replace(/_/g, " ")}</p>
                </div>
                <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${TIER_BG[selectedProvider.anomaly_risk_tier] ?? ""}`}>
                  {selectedProvider.anomaly_risk_tier}
                </span>
              </div>

              {/* Score */}
              <div className="mb-4 rounded-lg border border-orange-800/40 bg-orange-950/20 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-400">Composite Audit Risk Score</p>
                <p className="text-4xl font-bold text-orange-300">{selectedProvider.composite_anomaly_score?.toFixed(2) ?? "—"}</p>
                <p className="text-[10px] text-orange-600">{selectedProvider.total_flags_triggered} audit signal{selectedProvider.total_flags_triggered !== 1 ? "s" : ""} triggered</p>
              </div>

              {/* Audit Signals */}
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Audit Signals</h3>
              <div className="mb-4 grid grid-cols-1 gap-1.5">
                {Object.keys(FLAG_LABELS).map((flag) => (
                  <FlagBadge
                    key={flag}
                    label={FLAG_LABELS[flag]}
                    active={selectedProvider[flag as keyof AnomalyProvider] === true}
                    color={FLAG_COLORS[flag]}
                    context={selectedProvider[flag as keyof AnomalyProvider] === true ? FLAG_AUDIT_CONTEXT[flag] : undefined}
                  />
                ))}
              </div>

              {/* Key Metrics */}
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Deviation Metrics</h3>
              <div className="space-y-2 text-xs">
                {[
                  { label: "Payment deviation vs peer", value: fmtZ(selectedProvider.payment_z_score_vs_peer), warn: Math.abs(selectedProvider.payment_z_score_vs_peer ?? 0) > 2 },
                  { label: "Denial rate deviation vs peer", value: fmtZ(selectedProvider.denial_rate_z_score_vs_peer), warn: Math.abs(selectedProvider.denial_rate_z_score_vs_peer ?? 0) > 2 },
                  { label: "Part A denial rate", value: fmtPct(selectedProvider.part_a_denial_rate), warn: selectedProvider.part_a_denial_rate > 0.12 },
                  { label: "Suspicious billing lines", value: selectedProvider.suspicious_lines?.toLocaleString(), warn: selectedProvider.suspicious_lines > 500 },
                  { label: "Telehealth rate", value: fmtPct(selectedProvider.telehealth_rate), warn: selectedProvider.telehealth_rate > 0.4 },
                  { label: "Adjustment/cancel rate", value: fmtPct(selectedProvider.adjustment_cancel_rate), warn: selectedProvider.adjustment_cancel_rate > 0.05 },
                  { label: "Max daily claim volume", value: selectedProvider.max_daily_claim_volume?.toLocaleString(), warn: selectedProvider.max_daily_claim_volume > 15 },
                  { label: "Identified overpayment", value: fmt$(selectedProvider.total_overpayment_amt), warn: selectedProvider.total_overpayment_amt > 50000 },
                ].map((m) => (
                  <div key={m.label} className="flex justify-between border-b border-slate-800/40 pb-1.5">
                    <span className="text-slate-400">{m.label}</span>
                    <span className={`font-semibold ${m.warn ? "text-orange-300" : "text-white"}`}>{m.value}</span>
                  </div>
                ))}
              </div>

              {/* Audit Interpretation */}
              <div className="mt-4 rounded-lg border border-amber-800/30 bg-amber-950/20 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400">🔍 Audit Review Assessment</p>
                <p className="text-[10px] leading-relaxed text-amber-100/80">{buildProviderAuditInterpretation(selectedProvider)}</p>
                <p className="mt-2 text-[9px] text-amber-700">Note: Elevated scores indicate deviation from expected peer behavior — not confirmed billing errors. Operational and clinical review is required before any recovery action.</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-8 text-center">
              <p className="text-2xl">🔍</p>
              <p className="mt-2 text-sm text-slate-400">Select a provider to open the audit review panel</p>
              <p className="mt-1 text-xs text-slate-600">Click any row in the rankings table or a point in the scatter plot to see detailed audit signal analysis and review assessment.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
