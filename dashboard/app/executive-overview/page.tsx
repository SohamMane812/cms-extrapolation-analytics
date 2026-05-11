"use client";

import { useEffect, useState } from "react";
import { QUERIES } from "@/lib/bigquery/queries";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ── Types ────────────────────────────────────────────────────────────────────

interface KPIData {
  total_paid: number;
  total_overpayment: number;
  total_claims: number;
  true_op_rate: number;  // was avg_overpayment_rate
}

interface FlaggedCount {
  flagged_count: number;
}

interface RiskProfileRow {
  provider_risk_profile: string;
  total_overpayment: number;
  avg_overpayment_rate: number;
  provider_count: number;
}

interface ExtrapolationRow {
  sample_type: string;
  sample_size: number;
  extrapolated_overpayment: number;
  universe_true_overpayment: number;
  estimation_error_pct: number;
  sample_overpayment_rate: number;
}

interface FlaggedProvider {
  provider_id: string;
  provider_name: string;
  provider_type: string;
  peer_group: string;
  composite_anomaly_score: number;
  total_flags_triggered: number;
  anomaly_risk_tier: string;
  part_a_overpayment_rate: number;
  total_overpayment_amt: number;
  total_combined_paid: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function query<T>(sql: string): Promise<T[]> {
  const res = await fetch("/api/bigquery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) throw new Error("Query failed");
  const json = await res.json();
  return json.data as T[];
}

function fmt$(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString();
}

const RISK_COLORS: Record<string, string> = {
  Outlier: "#ef4444",
  Suspicious: "#f97316",
  High_Volume: "#eab308",
  Normal: "#22c55e",
  Emerging: "#3b82f6",
};

const TIER_COLORS: Record<string, string> = {
  Critical: "bg-red-900/60 text-red-300 border border-red-700",
  High: "bg-orange-900/60 text-orange-300 border border-orange-700",
  Medium: "bg-yellow-900/60 text-yellow-300 border border-yellow-700",
  Low: "bg-green-900/60 text-green-300 border border-green-700",
};

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/80 p-5 backdrop-blur">
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: accent ?? "#3b82f6" }}
      />
      <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p className="text-3xl font-bold tracking-tight text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold tracking-tight text-white">
        {title}
      </h2>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; name: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs shadow-xl">
      <p className="mb-1 font-semibold text-white">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-slate-300">
          {p.name}: {typeof p.value === "number" && !isNaN(p.value) && p.value > 1000 ? fmt$(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ExecutiveOverviewPage() {
  const [kpi, setKpi] = useState<KPIData | null>(null);
  const [flagged, setFlagged] = useState<number | null>(null);
  const [riskData, setRiskData] = useState<RiskProfileRow[]>([]);
  const [extrapolation, setExtrapolation] = useState<ExtrapolationRow[]>([]);
  const [topProviders, setTopProviders] = useState<FlaggedProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [kpiRows, flagRows, riskRows, extRows, provRows] =
          await Promise.all([
            query<KPIData>(QUERIES.executiveKPIs),
            query<FlaggedCount>(QUERIES.flaggedProviders),
            query<RiskProfileRow>(QUERIES.overpaymentByRiskProfile),
            query<ExtrapolationRow>(QUERIES.extrapolationComparison),
            query<FlaggedProvider>(QUERIES.topFlaggedProviders),
          ]);
        setKpi(kpiRows[0]);
        setFlagged(flagRows[0]?.flagged_count ?? 0);
        setRiskData(riskRows);
        setExtrapolation(extRows);
        setTopProviders(provRows);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="rounded-xl border border-red-800 bg-red-950/40 p-6 text-center">
          <p className="text-sm font-semibold text-red-400">Query Error</p>
          <p className="mt-1 text-xs text-red-300/70">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      {/* Page Header */}
      <div className="mb-8">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-400">
          CMS Post-Payment Analytics
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Executive Overview
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Full-scale dataset · 5.1M rows · Part A claims analysis
        </p>
      </div>

      {/* KPI Cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          label="Total Paid Amount"
          value={kpi ? fmt$(kpi.total_paid) : "—"}
          sub="Part A claims universe"
          accent="#3b82f6"
        />
        <KPICard
          label="Total Overpayment"
          value={kpi ? fmt$(kpi.total_overpayment) : "—"}
          sub="Identified in dataset"
          accent="#ef4444"
        />
        <KPICard
          label="Overpayment Rate"
          value={kpi ? fmtPct(kpi.true_op_rate) : "—"}
          sub="Avg across providers"
          accent="#f97316"
        />
        <KPICard
          label="Providers Flagged"
          value={flagged !== null ? fmtNum(flagged) : "—"}
          sub="≥2 audit risk signals"
          accent="#a855f7"
        />
      </div>

      {/* Charts Row */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Overpayment by Risk Profile */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
          <SectionHeader
            title="Overpayment by Risk Profile"
            sub="Total overpayment dollars per provider risk category"
          />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={riskData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="provider_risk_profile"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => fmt$(v)}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="total_overpayment" name="Overpayment" radius={[4, 4, 0, 0]}>
                {riskData.map((row) => (
                  <Cell
                    key={row.provider_risk_profile}
                    fill={RISK_COLORS[row.provider_risk_profile] ?? "#64748b"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Extrapolation Comparison */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
          <SectionHeader
            title="Extrapolation Results"
            sub="Estimated vs true universe overpayment by sample method"
          />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={extrapolation}
              margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="sample_type"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => fmt$(v)}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                dataKey="extrapolated_overpayment"
                name="Extrapolated"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="universe_true_overpayment"
                name="True Universe"
                fill="#22c55e"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 flex gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
              Extrapolated estimate
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              True universe overpayment
            </span>
          </div>
        </div>
      </div>

      {/* Top Flagged Providers Table */}
      <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
        <SectionHeader
          title="Top Flagged Providers"
          sub="Ranked by composite anomaly score · showing top 10"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700/60">
                {[
                  "Provider",
                  "Type",
                  "Peer Group",
                  "Anomaly Score",
                  "Flags",
                  "Risk Tier",
                  "OP Rate",
                  "Total OP",
                ].map((h) => (
                  <th
                    key={h}
                    className="pb-2 pr-4 text-left font-semibold uppercase tracking-wider text-slate-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topProviders.map((p, i) => (
                <tr
                  key={p.provider_id}
                  className={`border-b border-slate-800/60 ${
                    i % 2 === 0 ? "bg-slate-900/20" : ""
                  }`}
                >
                  <td className="py-2 pr-4 font-medium text-white">
                    {p.provider_name ?? p.provider_id}
                  </td>
                  <td className="py-2 pr-4 text-slate-300">{p.provider_type}</td>
                  <td className="py-2 pr-4 text-slate-300">{p.peer_group}</td>
                  <td className="py-2 pr-4 font-mono font-semibold text-orange-300">
                    {p.composite_anomaly_score?.toFixed(1) ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-center text-slate-200">
                    {p.total_flags_triggered}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        TIER_COLORS[p.anomaly_risk_tier] ??
                        "bg-slate-800 text-slate-300"
                      }`}
                    >
                      {p.anomaly_risk_tier}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-slate-300">
                    {fmtPct(p.part_a_overpayment_rate ?? 0)}
                  </td>
                  <td className="py-2 pr-4 font-medium text-red-300">
                    {fmt$(p.total_overpayment_amt ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
