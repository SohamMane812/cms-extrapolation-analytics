"use client";

import { useEffect, useState, useMemo } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
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
  Outlier: "#ef4444",
  Suspicious: "#f97316",
  High_Volume: "#eab308",
  Normal: "#22c55e",
  Emerging: "#3b82f6",
};

const RISK_BG: Record<string, string> = {
  Outlier: "bg-red-900/50 text-red-300 border-red-700",
  Suspicious: "bg-orange-900/50 text-orange-300 border-orange-700",
  High_Volume: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  Normal: "bg-green-900/50 text-green-300 border-green-700",
  Emerging: "bg-blue-900/50 text-blue-300 border-blue-700",
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

// ── Custom Scatter Tooltip ────────────────────────────────────────────────────

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: { payload: Provider }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs shadow-xl">
      <p className="mb-1 font-semibold text-white">{p.provider_name}</p>
      <p className="text-slate-400">{p.peer_group}</p>
      <div className="mt-2 space-y-0.5">
        <p className="text-slate-300">Payment Z-score: <span className="text-white">{fmtZ(p.payment_z_score_vs_peer)}</span></p>
        <p className="text-slate-300">Denial Rate Z-score: <span className="text-white">{fmtZ(p.denial_rate_z_score_vs_peer)}</span></p>
        <p className="text-slate-300">OP Rate: <span className="text-white">{fmtPct(p.part_a_overpayment_rate)}</span></p>
        <p className="text-slate-300">Total Paid: <span className="text-white">{fmt$(p.total_part_a_paid)}</span></p>
      </div>
      <span className={`mt-2 inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${RISK_BG[p.provider_risk_profile] ?? ""}`}>
        {p.provider_risk_profile}
      </span>
    </div>
  );
}

// ── Metric Row ────────────────────────────────────────────────────────────────

function MetricRow({
  label,
  value,
  peer,
  zScore,
}: {
  label: string;
  value: string;
  peer: string;
  zScore: number | null;
}) {
  const z = zScore ?? 0;
  const color = Math.abs(z) > 2 ? "text-red-400" : Math.abs(z) > 1 ? "text-yellow-400" : "text-green-400";
  return (
    <div className="flex items-center justify-between border-b border-slate-800/60 py-2">
      <div>
        <p className="text-xs font-medium text-slate-300">{label}</p>
        <p className="text-[10px] text-slate-500">Peer avg: {peer}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-white">{value}</p>
        {zScore != null && (
          <p className={`text-[10px] font-semibold ${color}`}>{fmtZ(zScore)} vs peer</p>
        )}
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

  // Filters
  const [selectedPeerGroup, setSelectedPeerGroup] = useState(ALL_PEER_GROUPS);
  const [selectedRiskProfile, setSelectedRiskProfile] = useState("All");
  const [sortBy, setSortBy] = useState<"composite_anomaly_score" | "part_a_denial_rate" | "total_overpayment_amt" | "payment_z_score_vs_peer">("composite_anomaly_score");
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [provRes, peerRes] = await Promise.all([
          fetch("/api/bigquery", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sql: `SELECT
                provider_id, provider_name, provider_type, peer_group,
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
            method: "POST",
            headers: { "Content-Type": "application/json" },
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

  // Unique values for filters
  const peerGroupOptions = useMemo(
    () => [ALL_PEER_GROUPS, ...Array.from(new Set(providers.map((p) => p.peer_group))).sort()],
    [providers]
  );
  const riskProfiles = ["All", "Outlier", "Suspicious", "High_Volume", "Normal", "Emerging"];

  // Filtered + sorted providers
  const filtered = useMemo(() => {
    return providers
      .filter((p) => selectedPeerGroup === ALL_PEER_GROUPS || p.peer_group === selectedPeerGroup)
      .filter((p) => selectedRiskProfile === "All" || p.provider_risk_profile === selectedRiskProfile)
      .sort((a, b) => {
        const av = a[sortBy] ?? 0;
        const bv = b[sortBy] ?? 0;
        return (bv as number) - (av as number);
      });
  }, [providers, selectedPeerGroup, selectedRiskProfile, sortBy]);

  // Scatter data
  const scatterByProfile = useMemo(() => {
    const groups: Record<string, Provider[]> = {};
    filtered.forEach((p) => {
      if (!groups[p.provider_risk_profile]) groups[p.provider_risk_profile] = [];
      groups[p.provider_risk_profile].push(p);
    });
    return groups;
  }, [filtered]);

  // Peer group bar data
  const peerBarData = useMemo(() =>
    peerGroups.map((pg) => ({
      name: pg.peer_group.replace(/_/g, " "),
      denial_rate: +(pg.peer_avg_part_a_denial_rate * 100).toFixed(2),
      op_rate: +(pg.peer_avg_overpayment_rate * 100).toFixed(2),
      avg_payment: +pg.peer_avg_part_a_payment.toFixed(0),
      size: pg.peer_group_size,
    })),
    [peerGroups]
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading provider data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      {/* Header */}
      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-400">
          CMS Post-Payment Analytics
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Provider Benchmarking
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {providers.length} active providers · peer group comparison · anomaly risk ranking
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {/* Peer Group */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Peer Group:</span>
          <select
            value={selectedPeerGroup}
            onChange={(e) => setSelectedPeerGroup(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
          >
            {peerGroupOptions.map((pg) => (
              <option key={pg} value={pg}>{pg.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>

        {/* Risk Profile */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Risk:</span>
          <div className="flex gap-1">
            {riskProfiles.map((rp) => (
              <button
                key={rp}
                onClick={() => setSelectedRiskProfile(rp)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                  selectedRiskProfile === rp
                    ? "border-blue-500 bg-blue-500/10 text-blue-300"
                    : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
                }`}
              >
                {rp}
              </button>
            ))}
          </div>
        </div>

        {/* Sort */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="composite_anomaly_score">Anomaly Score</option>
            <option value="part_a_denial_rate">Denial Rate</option>
            <option value="total_overpayment_amt">Total Overpayment</option>
            <option value="payment_z_score_vs_peer">Payment Z-Score</option>
          </select>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Providers Shown", value: filtered.length.toLocaleString(), accent: "#3b82f6" },
          {
            label: "Suspicious / Outlier",
            value: filtered.filter((p) => ["Suspicious", "Outlier"].includes(p.provider_risk_profile)).length.toLocaleString(),
            accent: "#ef4444",
          },
          {
            label: "Avg Denial Rate",
            value: fmtPct(filtered.reduce((s, p) => s + (p.part_a_denial_rate ?? 0), 0) / (filtered.length || 1)),
            accent: "#f97316",
          },
          {
            label: "Total Overpayment",
            value: fmt$(filtered.reduce((s, p) => s + (p.total_overpayment_amt ?? 0), 0)),
            accent: "#a855f7",
          },
        ].map((k) => (
          <div key={k.label} className="relative overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/80 p-4">
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: k.accent }} />
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{k.label}</p>
            <p className="text-2xl font-bold text-white">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Left: Scatter + Peer Group Chart ── */}
        <div className="space-y-5 lg:col-span-2">
          {/* Scatter Plot */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">
              Payment vs Denial Rate Deviation
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Z-scores vs peer group mean · click a provider to inspect · outliers in upper-right quadrant
            </p>
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="payment_z_score_vs_peer"
                  name="Payment Z-score"
                  type="number"
                  domain={["auto", "auto"]}
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: "Payment Z-score", position: "insideBottom", offset: -4, fill: "#64748b", fontSize: 10 }}
                />
                <YAxis
                  dataKey="denial_rate_z_score_vs_peer"
                  name="Denial Rate Z-score"
                  type="number"
                  domain={["auto", "auto"]}
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: "Denial Z-score", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }}
                />
                <Tooltip content={<ScatterTooltip />} />
                <ReferenceLine x={0} stroke="#334155" strokeDasharray="4 4" />
                <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 4" />
                <ReferenceLine x={2} stroke="#ef444440" strokeDasharray="4 4" />
                <ReferenceLine y={2} stroke="#ef444440" strokeDasharray="4 4" />
                {Object.entries(scatterByProfile).map(([profile, data]) => (
                  <Scatter
                    key={profile}
                    name={profile}
                    data={data}
                    fill={RISK_COLORS[profile] ?? "#64748b"}
                    fillOpacity={0.7}
                    onClick={(d) => setSelectedProvider(d as unknown as Provider)}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
            {/* Legend */}
            <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-400">
              {Object.entries(RISK_COLORS).map(([profile, color]) => (
                <span key={profile} className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                  {profile.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>

          {/* Peer Group Comparison */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">
              Peer Group Denial Rate vs Overpayment Rate
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Average rates by peer group · baselines exclude Suspicious and Outlier providers
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={peerBarData} margin={{ top: 4, right: 8, bottom: 40, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#94a3b8", fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  formatter={(v: number) => `${v.toFixed(2)}%`}
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: "#fff" }}
                />
                <Bar dataKey="denial_rate" name="Denial Rate %" fill="#f97316" radius={[3, 3, 0, 0]} />
                <Bar dataKey="op_rate" name="OP Rate %" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Provider Table */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">
              Provider Rankings
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700">
                    {["Provider", "Peer Group", "Risk", "Denial Rate", "OP Rate", "Payment Z", "Total OP", "Score"].map((h) => (
                      <th key={h} className="pb-2 pr-4 text-left font-semibold uppercase tracking-wider text-slate-400">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 20).map((p, i) => (
                    <tr
                      key={p.provider_id}
                      className={`cursor-pointer border-b border-slate-800/40 transition-colors hover:bg-slate-800/40 ${
                        selectedProvider?.provider_id === p.provider_id ? "bg-blue-950/30" : i % 2 === 0 ? "bg-slate-900/20" : ""
                      }`}
                      onClick={() => setSelectedProvider(p)}
                    >
                      <td className="py-2 pr-4 font-medium text-white">{p.provider_name}</td>
                      <td className="py-2 pr-4 text-slate-400">{p.peer_group.replace(/_/g, " ")}</td>
                      <td className="py-2 pr-4">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${RISK_BG[p.provider_risk_profile] ?? ""}`}>
                          {p.provider_risk_profile}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-slate-300">{fmtPct(p.part_a_denial_rate)}</td>
                      <td className="py-2 pr-4 text-slate-300">{fmtPct(p.part_a_overpayment_rate)}</td>
                      <td className={`py-2 pr-4 font-mono font-semibold ${
                        Math.abs(p.payment_z_score_vs_peer ?? 0) > 2 ? "text-red-400" :
                        Math.abs(p.payment_z_score_vs_peer ?? 0) > 1 ? "text-yellow-400" : "text-slate-300"
                      }`}>
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
                <p className="mt-2 text-[10px] text-slate-500">
                  Showing top 20 of {filtered.length} providers. Refine filters to narrow results.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Provider Detail Panel ── */}
        <div className="lg:col-span-1">
          {selectedProvider ? (
            <div className="sticky top-6 rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white">{selectedProvider.provider_name}</h2>
                  <p className="text-xs text-slate-400">{selectedProvider.provider_id}</p>
                </div>
                <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${RISK_BG[selectedProvider.provider_risk_profile] ?? ""}`}>
                  {selectedProvider.provider_risk_profile}
                </span>
              </div>

              {/* Provider Meta */}
              <div className="mb-4 grid grid-cols-2 gap-2 text-[10px]">
                {[
                  { label: "Type", value: selectedProvider.provider_type },
                  { label: "Region", value: selectedProvider.region },
                  { label: "State", value: selectedProvider.state },
                  { label: "Urban/Rural", value: selectedProvider.urban_rural },
                  { label: "Tenure", value: selectedProvider.provider_tenure_bucket },
                  { label: "Peer Group Size", value: selectedProvider.peer_group_size ?? "—" },
                ].map((m) => (
                  <div key={m.label} className="rounded bg-slate-800/50 p-2">
                    <p className="text-slate-500">{m.label}</p>
                    <p className="font-semibold text-slate-200">{m.value}</p>
                  </div>
                ))}
              </div>

              {/* Benchmark Metrics */}
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Peer Benchmarks
              </h3>
              <MetricRow
                label="Avg Part A Payment"
                value={fmt$(selectedProvider.avg_part_a_payment)}
                peer={fmt$(selectedProvider.peer_avg_part_a_payment)}
                zScore={selectedProvider.payment_z_score_vs_peer}
              />
              <MetricRow
                label="Denial Rate"
                value={fmtPct(selectedProvider.part_a_denial_rate)}
                peer={fmtPct(selectedProvider.peer_avg_part_a_denial_rate)}
                zScore={selectedProvider.denial_rate_z_score_vs_peer}
              />
              <MetricRow
                label="Overpayment Rate"
                value={fmtPct(selectedProvider.part_a_overpayment_rate)}
                peer={fmtPct(selectedProvider.peer_avg_overpayment_rate)}
                zScore={null}
              />
              <MetricRow
                label="Total Paid"
                value={fmt$(selectedProvider.total_part_a_paid)}
                peer={fmt$(selectedProvider.peer_avg_total_paid)}
                zScore={selectedProvider.total_paid_z_score_vs_peer}
              />

              {/* Claim Breakdown */}
              <h3 className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Claim Breakdown
              </h3>
              <div className="space-y-2 text-xs">
                {[
                  { label: "Total Claims", value: selectedProvider.total_part_a_claims?.toLocaleString() },
                  { label: "Inpatient", value: selectedProvider.inpatient_claims?.toLocaleString() },
                  { label: "Outpatient", value: selectedProvider.outpatient_claims?.toLocaleString() },
                  { label: "Avg Length of Stay", value: selectedProvider.avg_length_of_stay ? `${selectedProvider.avg_length_of_stay.toFixed(1)} days` : "—" },
                  { label: "Total Overpayment", value: fmt$(selectedProvider.total_overpayment_amt) },
                  { label: "Anomaly Score", value: selectedProvider.composite_anomaly_score?.toFixed(2) ?? "—" },
                ].map((m) => (
                  <div key={m.label} className="flex justify-between border-b border-slate-800/40 pb-1.5">
                    <span className="text-slate-400">{m.label}</span>
                    <span className="font-semibold text-white">{m.value}</span>
                  </div>
                ))}
              </div>

              {/* Percentile bars */}
              <h3 className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Percentile in Peer Group
              </h3>
              {[
                { label: "Payment", value: selectedProvider.payment_percentile_in_peer, color: "#3b82f6" },
                { label: "Denial Rate", value: selectedProvider.denial_rate_percentile_in_peer, color: "#f97316" },
              ].map((bar) => (
                <div key={bar.label} className="mb-2">
                  <div className="mb-1 flex justify-between text-[10px]">
                    <span className="text-slate-400">{bar.label}</span>
                    <span className="text-white">{bar.value != null ? `${(bar.value * 100).toFixed(0)}th` : "—"}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-800">
                    <div
                      className="h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${(bar.value ?? 0) * 100}%`, background: bar.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-8 text-center">
              <p className="text-2xl">🏥</p>
              <p className="mt-2 text-sm text-slate-400">Select a provider</p>
              <p className="mt-1 text-xs text-slate-600">
                Click any row in the table or a point in the scatter plot to see detailed benchmarking
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
