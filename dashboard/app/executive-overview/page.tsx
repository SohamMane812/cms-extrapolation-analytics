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

interface KPIData {
  total_paid: number;
  total_overpayment: number;
  total_claims: number;
  true_op_rate: number;
}
interface FlaggedCount { flagged_count: number; }
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

async function runQuery<T>(sql: string): Promise<T[]> {
  const res = await fetch("/api/bigquery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) throw new Error("Query failed");
  return (await res.json()).data as T[];
}

function fmt$(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
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
  Outlier: "#ef4444", Suspicious: "#f97316", High_Volume: "#eab308",
  Normal: "#22c55e", Emerging: "#3b82f6",
};
const TIER_STYLES: Record<string, string> = {
  "High Risk": "bg-red-900/60 text-red-300 border border-red-700",
  "Medium Risk": "bg-orange-900/60 text-orange-300 border border-orange-700",
  "Low Risk": "bg-yellow-900/60 text-yellow-300 border border-yellow-700",
  "Minimal Risk": "bg-green-900/60 text-green-300 border border-green-700",
};
const SAMPLE_LABELS: Record<string, string> = {
  Biased_High_Cost: "High-Cost Focused",
  Biased_Provider: "Provider-Focused",
  Random_Sample: "Random",
  Stratified_By_Type: "Stratified",
};

function KPICard({ label, value, sub, accent, helper }: {
  label: string; value: string; sub?: string; accent?: string; helper?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: accent ?? "#3b82f6" }} />
      <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-3xl font-bold tracking-tight text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      {helper && (
        <p className="mt-2 border-t border-slate-700/40 pt-2 text-[10px] leading-relaxed text-slate-500">
          {helper}
        </p>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number; name: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs shadow-xl">
      <p className="mb-1 font-semibold text-white">{SAMPLE_LABELS[label ?? ""] ?? label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-slate-300">
          {p.name}: {typeof p.value === "number" && !isNaN(p.value) && p.value > 1000 ? fmt$(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

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
        const [kpiRows, flagRows, riskRows, extRows, provRows] = await Promise.all([
          runQuery<KPIData>(QUERIES.executiveKPIs),
          runQuery<FlaggedCount>(QUERIES.flaggedProviders),
          runQuery<RiskProfileRow>(QUERIES.overpaymentByRiskProfile),
          runQuery<ExtrapolationRow>(QUERIES.extrapolationComparison),
          runQuery<FlaggedProvider>(QUERIES.topFlaggedProviders),
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
          <p className="text-sm text-slate-400">Loading audit analytics...</p>
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
        <h1 className="text-3xl font-bold tracking-tight text-white">Executive Overview</h1>
        <p className="mt-1 text-sm text-slate-400">
          400K Part A claims · 435 providers · 3-year post-payment audit simulation dataset
        </p>
      </div>

      {/* Context Banner */}
      <div className="mb-8 rounded-xl border border-slate-700/40 bg-slate-900/50 px-4 py-3">
        <p className="text-xs leading-relaxed text-slate-400">
          <span className="font-semibold text-slate-300">About this platform:</span> This dashboard simulates a Medicare post-payment audit analytics environment using a synthetic CMS CCLF-format dataset. It demonstrates how analytics supports overpayment detection, provider risk stratification, audit sampling strategy, and claim-level investigation.{" "}
          <span className="text-slate-500">Executive totals reflect all audit-eligible Part A claims. Extrapolation estimates in the Simulator are calculated against the audit-eligible claim universe and may differ from executive totals shown here.</span>
        </p>
      </div>

      {/* KPI Cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          label="Total Claims Paid"
          value={kpi ? fmt$(kpi.total_paid) : "—"}
          sub="All audit-eligible Part A claims"
          accent="#3b82f6"
        />
        <KPICard
          label="Estimated Recoverable Overpayment"
          value={kpi ? fmt$(kpi.total_overpayment) : "—"}
          sub="Identified across full claim population"
          accent="#ef4444"
          helper="Includes all Part A claims. Extrapolation estimates in the Simulator use the audit-eligible universe only (~$20.6M)."
        />
        <KPICard
          label="True Overpayment Rate"
          value={kpi ? fmtPct(kpi.true_op_rate) : "—"}
          sub="Total overpayment ÷ total paid"
          accent="#f97316"
          helper="Calculated at population level. Distinct from per-sample extrapolated rates shown in the Extrapolation Simulator."
        />
        <KPICard
          label="Providers Flagged for Audit Review"
          value={flagged !== null ? fmtNum(flagged) : "—"}
          sub="≥2 independent audit risk signals"
          accent="#a855f7"
          helper="Providers triggering multiple concurrent signals: payment outlier, elevated denial rate, suspicious billing patterns."
        />
      </div>

      {/* Charts */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* Overpayment by Risk Profile */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">
            Overpayment Exposure by Provider Risk Profile
          </h2>
          <p className="mb-2 text-xs text-slate-500">
            Total identified overpayment concentrated by provider risk category
          </p>
          <p className="mb-4 rounded-lg bg-slate-800/40 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
            Normal-profile providers represent the largest absolute overpayment volume due to their share of total claim volume. Suspicious and Outlier providers carry significantly higher overpayment risk per claim — the key target for focused audit effort.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={riskData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="provider_risk_profile" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => fmt$(v)} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="total_overpayment" name="Identified Overpayment" radius={[4, 4, 0, 0]}>
                {riskData.map((row) => (
                  <Cell key={row.provider_risk_profile} fill={RISK_COLORS[row.provider_risk_profile] ?? "#64748b"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Extrapolation Comparison */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">
            Audit Sample Strategy: Estimated vs True Recovery
          </h2>
          <p className="mb-2 text-xs text-slate-500">
            How sampling method affects projected overpayment recovery — audit-eligible universe
          </p>
          <p className="mb-4 rounded-lg bg-slate-800/40 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
            Stratified sampling most accurately tracks the true universe overpayment. Random sampling overestimates by 10.1%. Provider-focused sampling underestimates by 5.5% due to selection concentration bias.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={extrapolation} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="sample_type"
                tickFormatter={(v) => SAMPLE_LABELS[v] ?? v}
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tickFormatter={(v) => fmt$(v)} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="extrapolated_overpayment" name="Estimated Recovery" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="universe_true_overpayment" name="True Universe OP" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 flex gap-4 text-[10px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />Estimated recovery
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />True universe overpayment
            </span>
          </div>
        </div>
      </div>

      {/* Key Findings */}
      <div className="mb-8 rounded-xl border border-blue-700/30 bg-blue-950/20 p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-400">Key Audit Findings</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            "At a 1.77% true overpayment rate, this dataset contains an estimated $24.2M in recoverable overpayments across $1.37B in total Part A payments — a meaningful audit recovery opportunity.",
            "Stratified sampling achieves 2.0% estimation error vs 10.1% for random sampling — demonstrating how sample design directly affects projected audit recovery accuracy.",
            `${flagged ?? "—"} providers trigger ≥2 concurrent audit risk signals. These represent the highest-priority targets for focused post-payment review, with composite risk scores above 13.0.`,
          ].map((f, i) => (
            <div key={i} className="rounded-lg border border-blue-700/20 bg-blue-950/30 p-3">
              <p className="text-[11px] leading-relaxed text-blue-100/80">{f}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Priority Audit Targets */}
      <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
        <h2 className="mb-1 text-sm font-semibold text-white">Priority Audit Targets</h2>
        <p className="mb-4 text-xs text-slate-500">
          Providers ranked by composite audit risk score · top 10 by risk signal concentration
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700/60">
                {["Provider", "Type", "Peer Group", "Audit Risk Score", "Risk Signals", "Risk Tier", "OP Rate", "Identified OP"].map((h) => (
                  <th key={h} className="pb-2 pr-4 text-left font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topProviders.map((p, i) => (
                <tr key={p.provider_id} className={`border-b border-slate-800/60 ${i % 2 === 0 ? "bg-slate-900/20" : ""}`}>
                  <td className="py-2 pr-4 font-medium text-white">{p.provider_name ?? p.provider_id}</td>
                  <td className="py-2 pr-4 text-slate-300">{p.provider_type}</td>
                  <td className="py-2 pr-4 text-slate-300">{p.peer_group?.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4 font-mono font-semibold text-orange-300">{p.composite_anomaly_score?.toFixed(1) ?? "—"}</td>
                  <td className="py-2 pr-4 text-center text-slate-200">{p.total_flags_triggered}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${TIER_STYLES[p.anomaly_risk_tier] ?? "bg-slate-800 text-slate-300"}`}>
                      {p.anomaly_risk_tier}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-slate-300">{fmtPct(p.part_a_overpayment_rate ?? 0)}</td>
                  <td className="py-2 pr-4 font-medium text-red-300">{fmt$(p.total_overpayment_amt ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[10px] text-slate-500">
          Audit risk score is a composite of payment deviation from peer benchmarks, denial rate elevation, suspicious billing pattern flags, and daily claim volume anomalies. Scores above 10.0 indicate providers warranting immediate post-payment review.
        </p>
      </div>
    </main>
  );
}
