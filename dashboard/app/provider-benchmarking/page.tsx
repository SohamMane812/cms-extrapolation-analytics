"use client";

import { useEffect, useState, useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell, Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Provider {
  provider_id: string;
  provider_name: string;
  provider_type: string;
  peer_group: string;
  provider_risk_profile: string;
  region: string;
  state: string;
  urban_rural: string;
  total_part_a_claims: number;
  total_part_a_paid: number;
  avg_part_a_payment: number;
  part_a_denial_rate: number;
  part_a_overpayment_rate: number;
  total_overpayment_amt: number;
  payment_z_score_vs_peer: number;
  denial_rate_z_score_vs_peer: number;
  total_paid_z_score_vs_peer: number;
  payment_percentile_in_peer: number;
  denial_rate_percentile_in_peer: number;
  composite_anomaly_score: number | null;
  peer_avg_part_a_payment: number;
  peer_avg_part_a_denial_rate: number;
  peer_avg_overpayment_rate: number;
  peer_avg_total_paid: number;
  inpatient_claims: number;
  outpatient_claims: number;
  avg_length_of_stay: number;
  provider_tenure_bucket: string;
  is_active: boolean;
}

interface PeerGroup {
  peer_group: string;
  peer_group_size: number;
  peer_avg_part_a_payment: number;
  peer_p50_part_a_payment: number;
  peer_p90_part_a_payment: number;
  peer_avg_part_a_denial_rate: number;
  peer_avg_overpayment_rate: number;
  peer_avg_total_paid: number;
  peer_p90_total_paid: number;
  peer_avg_los: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  Outlier: "#ef4444", Suspicious: "#f97316", High_Volume: "#eab308",
  Normal: "#22c55e", Emerging: "#3b82f6",
};

const RISK_BG: Record<string, string> = {
  Outlier: "bg-red-900/50 text-red-300 border-red-700",
  Suspicious: "bg-orange-900/50 text-orange-300 border-orange-700",
  High_Volume: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  Normal: "bg-green-900/50 text-green-300 border-green-700",
  Emerging: "bg-blue-900/50 text-blue-300 border-blue-700",
};

const RISK_PROFILE_DESCRIPTIONS: Record<string, string> = {
  Outlier: "Extreme deviation from peer benchmarks across multiple dimensions. Highest priority for post-payment review.",
  Suspicious: "Elevated risk signals across payment patterns, denial rates, or billing behavior. Warrants targeted audit review.",
  High_Volume: "Above-average claim volume with moderate risk indicators. Monitor for pattern changes.",
  Normal: "Performance within expected peer group ranges. Routine monitoring sufficient.",
  Emerging: "Newer or lower-volume providers with insufficient history for full benchmarking.",
};

const ALL_PEER_GROUPS = "All Peer Groups";

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

function getDeviationSeverity(z: number): { label: string; color: string } {
  const abs = Math.abs(z);
  if (abs > 3) return { label: "Extreme", color: "text-red-400" };
  if (abs > 2) return { label: "High", color: "text-orange-400" };
  if (abs > 1) return { label: "Elevated", color: "text-yellow-400" };
  return { label: "Normal", color: "text-green-400" };
}

function buildProviderInterpretation(p: Provider): string[] {
  const insights: string[] = [];
  const payZ = p.payment_z_score_vs_peer ?? 0;
  const denZ = p.denial_rate_z_score_vs_peer ?? 0;

  if (Math.abs(payZ) > 2) {
    insights.push(`Average payment of ${fmt$(p.avg_part_a_payment)} is ${fmtZ(payZ)} from peer group mean (${fmt$(p.peer_avg_part_a_payment)}) — ${payZ > 0 ? "significantly above" : "significantly below"} expected range. ${payZ > 0 ? "Elevated payments may indicate upcoding, high-severity case concentration, or billing irregularities." : "Below-average payments with normal volumes may indicate claim denials suppressing paid amounts."}`);
  }
  if (Math.abs(denZ) > 2) {
    insights.push(`Denial rate of ${fmtPct(p.part_a_denial_rate)} is ${fmtZ(denZ)} from peer group mean (${fmtPct(p.peer_avg_part_a_denial_rate)}) — ${denZ > 0 ? "substantially elevated" : "substantially below"}. ${denZ > 0 ? "Elevated denial rates may indicate documentation deficiencies, unsupported billing, or payer pattern mismatches requiring further review." : "Below-peer denial rates in combination with high payments may indicate billing irregularities that are not being caught by standard payer edits."}`);
  }
  if (p.part_a_overpayment_rate > 0.09) {
    insights.push(`Overpayment exposure rate of ${fmtPct(p.part_a_overpayment_rate)} exceeds the peer group average of ${fmtPct(p.peer_avg_overpayment_rate)}. Combined with total identified overpayment of ${fmt$(p.total_overpayment_amt)}, this provider represents concentrated recovery exposure.`);
  }
  if (["Suspicious", "Outlier"].includes(p.provider_risk_profile)) {
    insights.push(`Risk profile: ${p.provider_risk_profile}. ${RISK_PROFILE_DESCRIPTIONS[p.provider_risk_profile]} Composite audit risk score of ${p.composite_anomaly_score?.toFixed(1) ?? "—"} reflects multi-dimensional deviation across payment, denial, and billing pattern dimensions.`);
  }
  if (insights.length === 0) {
    insights.push(`This provider's performance metrics fall within expected peer group ranges. No significant deviations identified across payment, denial rate, or overpayment dimensions. Routine monitoring is appropriate.`);
  }
  return insights;
}

// ── Scatter Tooltip ───────────────────────────────────────────────────────────

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: { payload: Provider }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs shadow-xl max-w-xs">
      <p className="mb-1 font-semibold text-white">{p.provider_name}</p>
      <p className="text-slate-400 mb-2">{p.peer_group?.replace(/_/g, " ")}</p>
      <div className="space-y-0.5">
        <p className="text-slate-300">Payment deviation: <span className="text-white">{fmtZ(p.payment_z_score_vs_peer)}</span></p>
        <p className="text-slate-300">Denial deviation: <span className="text-white">{fmtZ(p.denial_rate_z_score_vs_peer)}</span></p>
        <p className="text-slate-300">OP exposure rate: <span className="text-white">{fmtPct(p.part_a_overpayment_rate)}</span></p>
        <p className="text-slate-300">Audit risk score: <span className="font-semibold text-orange-300">{p.composite_anomaly_score?.toFixed(1) ?? "—"}</span></p>
      </div>
      <span className={`mt-2 inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${RISK_BG[p.provider_risk_profile] ?? ""}`}>
        {p.provider_risk_profile}
      </span>
    </div>
  );
}

// ── Metric Row ────────────────────────────────────────────────────────────────

function MetricRow({ label, value, peer, zScore }: { label: string; value: string; peer: string; zScore: number | null }) {
  const z = zScore ?? 0;
  const { color } = getDeviationSeverity(z);
  return (
    <div className="flex items-center justify-between border-b border-slate-800/60 py-2">
      <div>
        <p className="text-xs font-medium text-slate-300">{label}</p>
        <p className="text-[10px] text-slate-500">Peer avg: {peer}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-white">{value}</p>
        {zScore != null && <p className={`text-[10px] font-semibold ${color}`}>{fmtZ(zScore)} vs peer</p>}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProviderBenchmarkingPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [peerGroups, setPeerGroups] = useState<PeerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeerGroup, setSelectedPeerGroup] = useState(ALL_PEER_GROUPS);
  const [selectedRiskProfile, setSelectedRiskProfile] = useState("All");
  const [sortBy, setSortBy] = useState<"composite_anomaly_score" | "part_a_denial_rate" | "total_overpayment_amt" | "payment_z_score_vs_peer">("composite_anomaly_score");
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [provRes, peerRes] = await Promise.all([
          fetch("/api/bigquery", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sql: `SELECT provider_id, provider_name, provider_type, peer_group,
                provider_risk_profile, region, state, urban_rural,
                total_part_a_claims, total_part_a_paid, avg_part_a_payment,
                part_a_denial_rate, part_a_overpayment_rate, total_overpayment_amt,
                payment_z_score_vs_peer, denial_rate_z_score_vs_peer,
                total_paid_z_score_vs_peer, payment_percentile_in_peer,
                denial_rate_percentile_in_peer, composite_anomaly_score,
                peer_avg_part_a_payment, peer_avg_part_a_denial_rate,
                peer_avg_overpayment_rate, peer_avg_total_paid,
                inpatient_claims, outpatient_claims, avg_length_of_stay,
                provider_tenure_bucket, is_active
              FROM \`cms-extrapolation-v1.analytics_cms_claims.provider_benchmark_summary\`
              WHERE is_active = TRUE`,
            }),
          }),
          fetch("/api/bigquery", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sql: `SELECT peer_group, peer_group_size,
                peer_avg_part_a_payment, peer_p50_part_a_payment, peer_p90_part_a_payment,
                peer_avg_part_a_denial_rate, peer_avg_overpayment_rate,
                peer_avg_total_paid, peer_p90_total_paid, peer_avg_los
              FROM \`cms-extrapolation-v1.analytics_cms_claims.peer_group_summary\`
              ORDER BY peer_group`,
            }),
          }),
        ]);
        const provJson = await provRes.json();
        const peerJson = await peerRes.json();
        setProviders(provJson.data as Provider[]);
        setPeerGroups(peerJson.data as PeerGroup[]);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const peerGroupOptions = useMemo(
    () => [ALL_PEER_GROUPS, ...Array.from(new Set(providers.map((p) => p.peer_group))).sort()],
    [providers]
  );

  const filtered = useMemo(() =>
    providers
      .filter((p) => selectedPeerGroup === ALL_PEER_GROUPS || p.peer_group === selectedPeerGroup)
      .filter((p) => selectedRiskProfile === "All" || p.provider_risk_profile === selectedRiskProfile)
      .sort((a, b) => ((b[sortBy] ?? 0) as number) - ((a[sortBy] ?? 0) as number)),
    [providers, selectedPeerGroup, selectedRiskProfile, sortBy]
  );

  const scatterByProfile = useMemo(() => {
    const groups: Record<string, Provider[]> = {};
    filtered.forEach((p) => {
      if (!groups[p.provider_risk_profile]) groups[p.provider_risk_profile] = [];
      groups[p.provider_risk_profile].push(p);
    });
    return groups;
  }, [filtered]);

  const peerBarData = useMemo(() =>
    peerGroups.map((pg) => ({
      name: pg.peer_group.replace(/_/g, " "),
      denial_rate: +(pg.peer_avg_part_a_denial_rate * 100).toFixed(2),
      op_rate: +(pg.peer_avg_overpayment_rate * 100).toFixed(2),
    })),
    [peerGroups]
  );

  const suspiciousOutlier = useMemo(() =>
    providers.filter((p) => ["Suspicious", "Outlier"].includes(p.provider_risk_profile)),
    [providers]
  );

  const totalOP = useMemo(() =>
    filtered.reduce((s, p) => s + (p.total_overpayment_amt ?? 0), 0),
    [filtered]
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading provider benchmarking data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="flex h-screen items-center justify-center bg-slate-950"><p className="text-sm text-red-400">{error}</p></div>;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">

      {/* Header */}
      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-400">CMS Post-Payment Analytics</p>
        <h1 className="text-3xl font-bold tracking-tight text-white">Provider Benchmarking</h1>
        <p className="mt-1 text-sm text-slate-400">
          {providers.length} active providers · peer group comparison · audit risk stratification
        </p>
      </div>

      {/* Context Banner */}
      <div className="mb-6 rounded-xl border border-slate-700/40 bg-slate-900/50 px-4 py-3">
        <p className="text-xs leading-relaxed text-slate-400">
          <span className="font-semibold text-slate-300">How peer benchmarking supports audit prioritization:</span> Each provider is compared against peers in the same specialty and facility type group. Deviations from peer norms — in payment levels, denial rates, and overpayment exposure — are quantified as z-scores. Providers with significant multi-dimensional deviations receive elevated audit risk scores and are prioritized for post-payment review.{" "}
          <span className="text-slate-500">Peer group baselines exclude Suspicious and Outlier providers to prevent high-risk providers from inflating the normal range.</span>
        </p>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Providers in View", value: filtered.length.toLocaleString(), accent: "#3b82f6", sub: "Active, matching filters" },
          { label: "Elevated Audit Risk", value: suspiciousOutlier.length.toLocaleString(), accent: "#ef4444", sub: `${((suspiciousOutlier.length / providers.length) * 100).toFixed(1)}% of active providers` },
          { label: "Avg Denial Rate", value: fmtPct(filtered.reduce((s, p) => s + (p.part_a_denial_rate ?? 0), 0) / (filtered.length || 1)), accent: "#f97316", sub: "Across filtered providers" },
          { label: "Total Overpayment Exposure", value: fmt$(totalOP), accent: "#a855f7", sub: "Identified in filtered view" },
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
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Peer Group:</span>
          <select value={selectedPeerGroup} onChange={(e) => setSelectedPeerGroup(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none">
            {peerGroupOptions.map((pg) => <option key={pg} value={pg}>{pg.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Risk Profile:</span>
          <div className="flex gap-1">
            {["All", "Outlier", "Suspicious", "High_Volume", "Normal", "Emerging"].map((rp) => (
              <button key={rp} onClick={() => setSelectedRiskProfile(rp)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${selectedRiskProfile === rp ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"}`}>
                {rp.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400">Sort by:</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none">
            <option value="composite_anomaly_score">Audit Risk Score</option>
            <option value="part_a_denial_rate">Denial Rate</option>
            <option value="total_overpayment_amt">Overpayment Exposure</option>
            <option value="payment_z_score_vs_peer">Payment Deviation</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* Left: Charts + Table */}
        <div className="space-y-5 lg:col-span-2">

          {/* Scatter Plot */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">
              Payment &amp; Denial Rate Deviation from Peer Benchmarks
            </h2>
            <p className="mb-2 text-xs text-slate-500">
              Z-scores vs peer group mean · providers in upper-right quadrant show both elevated payments and elevated denials
            </p>
            <div className="mb-4 rounded-lg bg-slate-800/40 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
              Each point represents one provider. Position reflects deviation from peer group norms — not absolute values. Providers in the upper-right quadrant combine elevated payment levels with elevated denial rates, suggesting a billing pattern inconsistent with peer group expectations. The dashed lines mark the 2σ threshold — providers beyond these lines warrant prioritized audit review.
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 8, right: 8, bottom: 20, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="payment_z_score_vs_peer" name="Payment deviation" type="number" domain={["auto", "auto"]}
                  tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false}
                  label={{ value: "Payment deviation from peer (σ)", position: "insideBottom", offset: -12, fill: "#64748b", fontSize: 10 }} />
                <YAxis dataKey="denial_rate_z_score_vs_peer" name="Denial rate deviation" type="number" domain={["auto", "auto"]}
                  tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false}
                  label={{ value: "Denial rate deviation (σ)", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }} />
                <Tooltip content={<ScatterTooltip />} />
                <ReferenceLine x={0} stroke="#334155" strokeDasharray="4 4" />
                <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 4" />
                <ReferenceLine x={2} stroke="#ef444440" strokeDasharray="4 4" />
                <ReferenceLine y={2} stroke="#ef444440" strokeDasharray="4 4" />
                <ReferenceLine x={-2} stroke="#ef444440" strokeDasharray="4 4" />
                {Object.entries(scatterByProfile).map(([profile, data]) => (
                  <Scatter key={profile} name={profile} data={data}
                    fill={RISK_COLORS[profile] ?? "#64748b"} fillOpacity={0.7}
                    onClick={(d) => setSelectedProvider(d as unknown as Provider)} />
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
              <span className="text-slate-600">· dashed lines = 2σ audit review threshold</span>
            </div>
          </div>

          {/* Peer Group Chart */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">
              Denial Rate &amp; Overpayment Exposure by Provider Peer Group
            </h2>
            <p className="mb-2 text-xs text-slate-500">
              Average rates by peer group · baselines exclude Suspicious and Outlier providers
            </p>
            <div className="mb-4 rounded-lg bg-slate-800/40 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
              Peer group baselines represent expected behavior for normal-risk providers within each specialty and facility type. Outpatient facility groups show comparatively higher average denial and overpayment rates — consistent with higher billing complexity in that care setting.
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={peerBarData} margin={{ top: 4, right: 8, bottom: 48, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v) => [`${(v as number).toFixed(2)}%`]}
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: "#fff" }} />
                <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8", paddingTop: 8 }} />
                <Bar dataKey="denial_rate" name="Denial Rate %" fill="#f97316" radius={[3, 3, 0, 0]} />
                <Bar dataKey="op_rate" name="Overpayment Exposure %" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Provider Audit Risk Rankings Table */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Provider Audit Risk Rankings</h2>
            <p className="mb-4 text-xs text-slate-500">
              Ranked by selected sort dimension · showing top 20 · click a row to open the audit review panel
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700">
                    {["Provider", "Peer Group", "Risk Profile", "Denial Rate", "OP Exposure Rate", "Payment Deviation", "Identified OP", "Audit Risk Score"].map((h) => (
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
                      <td className="py-2 pr-4 text-slate-400 text-[10px]">{p.peer_group.replace(/_/g, " ")}</td>
                      <td className="py-2 pr-4">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${RISK_BG[p.provider_risk_profile] ?? ""}`}>
                          {p.provider_risk_profile.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-slate-300">{fmtPct(p.part_a_denial_rate)}</td>
                      <td className="py-2 pr-4 text-slate-300">{fmtPct(p.part_a_overpayment_rate)}</td>
                      <td className={`py-2 pr-4 font-mono font-semibold ${getDeviationSeverity(p.payment_z_score_vs_peer ?? 0).color}`}>
                        {fmtZ(p.payment_z_score_vs_peer)}
                      </td>
                      <td className="py-2 pr-4 text-red-300">{fmt$(p.total_overpayment_amt)}</td>
                      <td className="py-2 pr-4 font-mono font-semibold text-orange-300">
                        {p.composite_anomaly_score?.toFixed(1) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > 20 && (
                <p className="mt-2 text-[10px] text-slate-500">Showing top 20 of {filtered.length} providers. Refine filters to narrow results.</p>
              )}
            </div>
          </div>

          {/* Key Findings */}
          <div className="rounded-xl border border-blue-700/30 bg-blue-950/20 p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-400">Key Findings — Provider Risk Concentration</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                "Outpatient Facility providers show the greatest concentration of elevated audit risk scores and overpayment exposure — consistent with higher billing complexity and more diverse claim type patterns in that care setting.",
                "Providers with denial rates more than 1.5x peer group benchmarks were overwhelmingly concentrated among Suspicious and Outlier risk profiles, suggesting a systematic relationship between billing behavior and documentation deficiencies.",
                "High-volume providers with moderate per-claim overpayment rates still represent substantial total recoverable exposure due to payment scale — volume alone is an independent audit prioritization signal.",
                "Peer group payment baselines converge tightly across facility types ($3.9K–$4.0K avg), making denial rate deviation and billing pattern flags the primary differentiating signals for audit targeting rather than payment level alone.",
              ].map((f, i) => (
                <div key={i} className="rounded-lg border border-blue-700/20 bg-blue-950/30 p-3">
                  <p className="text-[11px] leading-relaxed text-blue-100/80">{f}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Provider Detail Panel */}
        <div className="lg:col-span-1">
          {selectedProvider ? (
            <div className="sticky top-6 rounded-xl border border-blue-700/30 bg-slate-900/80 p-5">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white">{selectedProvider.provider_name}</h2>
                  <p className="text-xs text-slate-400">{selectedProvider.provider_id}</p>
                </div>
                <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${RISK_BG[selectedProvider.provider_risk_profile] ?? ""}`}>
                  {selectedProvider.provider_risk_profile}
                </span>
              </div>

              {/* Audit Risk Score */}
              <div className="mb-4 rounded-lg border border-orange-800/40 bg-orange-950/20 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-400">Composite Audit Risk Score</p>
                <p className="text-4xl font-bold text-orange-300">{selectedProvider.composite_anomaly_score?.toFixed(1) ?? "—"}</p>
                <p className="text-[10px] text-orange-600">{RISK_PROFILE_DESCRIPTIONS[selectedProvider.provider_risk_profile]}</p>
              </div>

              {/* Provider Meta */}
              <div className="mb-4 grid grid-cols-2 gap-2 text-[10px]">
                {[
                  { label: "Type", value: selectedProvider.provider_type },
                  { label: "Region", value: selectedProvider.region },
                  { label: "State", value: selectedProvider.state },
                  { label: "Urban/Rural", value: selectedProvider.urban_rural },
                  { label: "Tenure", value: selectedProvider.provider_tenure_bucket },
                  { label: "Peer Group Size", value: (selectedProvider as unknown as Record<string, unknown>).peer_group_size as number ?? "—" },
                ].map((m) => (
                  <div key={m.label} className="rounded bg-slate-800/50 p-2">
                    <p className="text-slate-500">{m.label}</p>
                    <p className="font-semibold text-slate-200">{String(m.value)}</p>
                  </div>
                ))}
              </div>

              {/* Peer Group Comparison */}
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Peer Group Comparison</h3>
              <MetricRow label="Avg Part A Payment" value={fmt$(selectedProvider.avg_part_a_payment)} peer={fmt$(selectedProvider.peer_avg_part_a_payment)} zScore={selectedProvider.payment_z_score_vs_peer} />
              <MetricRow label="Denial Rate" value={fmtPct(selectedProvider.part_a_denial_rate)} peer={fmtPct(selectedProvider.peer_avg_part_a_denial_rate)} zScore={selectedProvider.denial_rate_z_score_vs_peer} />
              <MetricRow label="Overpayment Exposure Rate" value={fmtPct(selectedProvider.part_a_overpayment_rate)} peer={fmtPct(selectedProvider.peer_avg_overpayment_rate)} zScore={null} />
              <MetricRow label="Total Paid" value={fmt$(selectedProvider.total_part_a_paid)} peer={fmt$(selectedProvider.peer_avg_total_paid)} zScore={selectedProvider.total_paid_z_score_vs_peer} />

              {/* Claim Breakdown */}
              <h3 className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Claim Breakdown</h3>
              <div className="space-y-2 text-xs">
                {[
                  { label: "Total Claims", value: selectedProvider.total_part_a_claims?.toLocaleString() },
                  { label: "Inpatient", value: selectedProvider.inpatient_claims?.toLocaleString() },
                  { label: "Outpatient", value: selectedProvider.outpatient_claims?.toLocaleString() },
                  { label: "Avg Length of Stay", value: selectedProvider.avg_length_of_stay ? `${selectedProvider.avg_length_of_stay.toFixed(1)} days` : "—" },
                  { label: "Identified Overpayment", value: fmt$(selectedProvider.total_overpayment_amt) },
                ].map((m) => (
                  <div key={m.label} className="flex justify-between border-b border-slate-800/40 pb-1.5">
                    <span className="text-slate-400">{m.label}</span>
                    <span className="font-semibold text-white">{m.value}</span>
                  </div>
                ))}
              </div>

              {/* Percentile Bars */}
              <h3 className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Percentile in Peer Group</h3>
              {[
                { label: "Payment Level", value: selectedProvider.payment_percentile_in_peer, color: "#3b82f6" },
                { label: "Denial Rate", value: selectedProvider.denial_rate_percentile_in_peer, color: "#f97316" },
              ].map((bar) => (
                <div key={bar.label} className="mb-2">
                  <div className="mb-1 flex justify-between text-[10px]">
                    <span className="text-slate-400">{bar.label}</span>
                    <span className="text-white">{bar.value != null ? `${(bar.value * 100).toFixed(0)}th percentile` : "—"}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-800">
                    <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${(bar.value ?? 0) * 100}%`, background: bar.color }} />
                  </div>
                </div>
              ))}

              {/* Audit Interpretation */}
              <div className="mt-4 rounded-lg border border-amber-800/30 bg-amber-950/20 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400">🔍 Audit Review Assessment</p>
                <div className="space-y-2">
                  {buildProviderInterpretation(selectedProvider).map((insight, i) => (
                    <p key={i} className="text-[10px] leading-relaxed text-amber-100/80">{insight}</p>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-8 text-center">
              <p className="text-2xl">🏥</p>
              <p className="mt-2 text-sm text-slate-400">Select a provider to open the audit review panel</p>
              <p className="mt-1 text-xs text-slate-600">Click any row in the rankings table or a point in the scatter plot to see peer comparison, deviation analysis, and audit interpretation.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
