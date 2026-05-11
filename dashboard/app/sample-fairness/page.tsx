"use client";

import { useEffect, useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
  ReferenceLine,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ByRace {
  race: string;
  patient_count: number;
  avg_risk_score: number;
  avg_combined_paid: number;
  avg_overpayment: number;
  dual_eligible_rate: number;
  low_income_rate: number;
  avg_chronic_count: number;
  high_risk_rate: number;
}

interface BySex {
  sex: string;
  patient_count: number;
  avg_risk_score: number;
  avg_combined_paid: number;
  avg_overpayment: number;
  dual_eligible_rate: number;
}

interface ByRegion {
  region: string;
  patient_count: number;
  avg_risk_score: number;
  avg_combined_paid: number;
  avg_overpayment: number;
  dual_eligible_rate: number;
  avg_chronic_count: number;
}

interface ByDualStatus {
  dual_status: string;
  patient_count: number;
  avg_risk_score: number;
  avg_combined_paid: number;
  avg_overpayment: number;
  avg_chronic_count: number;
}

interface ClaimFairness {
  race: string;
  claim_count: number;
  denial_rate: number;
  avg_payment: number;
  overpayment_rate: number;
  provider_risk_profile: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RACE_COLORS: Record<string, string> = {
  White: "#3b82f6",
  Black: "#a855f7",
  Hispanic: "#f97316",
  Asian: "#22c55e",
  Other: "#64748b",
  Unknown: "#475569",
};

const REGION_COLORS: Record<string, string> = {
  Northeast: "#3b82f6",
  Southeast: "#ef4444",
  Midwest: "#eab308",
  Southwest: "#f97316",
  West: "#22c55e",
};

const SEX_COLORS: Record<string, string> = {
  Male: "#3b82f6",
  Female: "#ec4899",
  Unknown: "#64748b",
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

function fmtNum(n: number | null | undefined, dec = 0): string {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtPct(n: number | null | undefined, dec = 1): string {
  if (n == null || isNaN(n)) return "—";
  return `${(n * 100).toFixed(dec)}%`;
}

async function runQuery<T>(sql: string): Promise<T[]> {
  const res = await fetch("/api/bigquery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) throw new Error("Query failed");
  const json = await res.json();
  return json.data as T[];
}

// ── Disparity Badge ───────────────────────────────────────────────────────────

function DisparityBadge({ ratio, label }: { ratio: number; label: string }) {
  const disparity = Math.abs(ratio - 1);
  const color = disparity > 0.2 ? "#ef4444" : disparity > 0.1 ? "#f97316" : "#22c55e";
  const text = disparity > 0.2 ? "High Disparity" : disparity > 0.1 ? "Moderate" : "Equitable";
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: `${color}40`, background: `${color}10` }}>
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className="text-lg font-bold text-white">{ratio.toFixed(2)}x</p>
      <p className="text-[10px] font-semibold" style={{ color }}>{text}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SampleFairnessPage() {
  const [byRace, setByRace] = useState<ByRace[]>([]);
  const [bySex, setBySex] = useState<BySex[]>([]);
  const [byRegion, setByRegion] = useState<ByRegion[]>([]);
  const [byDual, setByDual] = useState<ByDualStatus[]>([]);
  const [claimFairness, setClaimFairness] = useState<ClaimFairness[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"race" | "sex" | "region" | "dual">("race");

  useEffect(() => {
    async function load() {
      try {
        const [raceRows, sexRows, regionRows, dualRows, claimRows] = await Promise.all([
          runQuery<ByRace>(`
            SELECT
              race,
              COUNT(*)                          AS patient_count,
              AVG(risk_score)                   AS avg_risk_score,
              AVG(total_combined_paid)          AS avg_combined_paid,
              AVG(total_overpayment_amt)        AS avg_overpayment,
              AVG(CASE WHEN is_dual_eligible THEN 1.0 ELSE 0.0 END) AS dual_eligible_rate,
              AVG(CASE WHEN has_low_income_subsidy THEN 1.0 ELSE 0.0 END) AS low_income_rate,
              AVG(bene_chronic_count)           AS avg_chronic_count,
              AVG(CASE WHEN is_high_risk THEN 1.0 ELSE 0.0 END) AS high_risk_rate
            FROM \`cms-extrapolation-v1.analytics_cms_claims.patient_risk_summary\`
            WHERE race IS NOT NULL
            GROUP BY race
            ORDER BY patient_count DESC
          `),
          runQuery<BySex>(`
            SELECT
              sex,
              COUNT(*)                          AS patient_count,
              AVG(risk_score)                   AS avg_risk_score,
              AVG(total_combined_paid)          AS avg_combined_paid,
              AVG(total_overpayment_amt)        AS avg_overpayment,
              AVG(CASE WHEN is_dual_eligible THEN 1.0 ELSE 0.0 END) AS dual_eligible_rate
            FROM \`cms-extrapolation-v1.analytics_cms_claims.patient_risk_summary\`
            WHERE sex IS NOT NULL
            GROUP BY sex
            ORDER BY patient_count DESC
          `),
          runQuery<ByRegion>(`
            SELECT
              region,
              COUNT(*)                          AS patient_count,
              AVG(risk_score)                   AS avg_risk_score,
              AVG(total_combined_paid)          AS avg_combined_paid,
              AVG(total_overpayment_amt)        AS avg_overpayment,
              AVG(CASE WHEN is_dual_eligible THEN 1.0 ELSE 0.0 END) AS dual_eligible_rate,
              AVG(bene_chronic_count)           AS avg_chronic_count
            FROM \`cms-extrapolation-v1.analytics_cms_claims.patient_risk_summary\`
            WHERE region IS NOT NULL
            GROUP BY region
            ORDER BY patient_count DESC
          `),
          runQuery<ByDualStatus>(`
            SELECT
              CASE
                WHEN is_dual_eligible THEN 'Dual Eligible'
                WHEN has_low_income_subsidy THEN 'Low Income Subsidy'
                ELSE 'Standard'
              END AS dual_status,
              COUNT(*)                   AS patient_count,
              AVG(risk_score)            AS avg_risk_score,
              AVG(total_combined_paid)   AS avg_combined_paid,
              AVG(total_overpayment_amt) AS avg_overpayment,
              AVG(bene_chronic_count)    AS avg_chronic_count
            FROM \`cms-extrapolation-v1.analytics_cms_claims.patient_risk_summary\`
            GROUP BY dual_status
            ORDER BY avg_combined_paid DESC
          `),
          runQuery<ClaimFairness>(`
            SELECT
              p.race,
              COUNT(c.claim_id)          AS claim_count,
              AVG(CASE WHEN c.is_denied THEN 1.0 ELSE 0.0 END) AS denial_rate,
              AVG(c.payment_amount)       AS avg_payment,
              AVG(CASE WHEN c.has_overpayment THEN 1.0 ELSE 0.0 END) AS overpayment_rate,
              c.provider_risk_profile
            FROM \`cms-extrapolation-v1.curated_cms_claims.fact_part_a_claims\` c
            JOIN \`cms-extrapolation-v1.analytics_cms_claims.patient_risk_summary\` p
              ON c.patient_id = p.patient_id
            WHERE p.race IS NOT NULL
            GROUP BY p.race, c.provider_risk_profile
            ORDER BY p.race, c.provider_risk_profile
          `),
        ]);
        setByRace(raceRows);
        setBySex(sexRows);
        setByRegion(regionRows);
        setByDual(dualRows);
        setClaimFairness(claimRows);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Disparity ratios — compare each group to White baseline for race
  const raceDisparities = useMemo(() => {
    const white = byRace.find((r) => r.race === "White");
    if (!white) return [];
    return byRace.filter((r) => r.race !== "White").map((r) => ({
      race: r.race,
      payment_ratio: r.avg_combined_paid / (white.avg_combined_paid || 1),
      risk_ratio: r.avg_risk_score / (white.avg_risk_score || 1),
      denial_rate_ratio: 1, // will use claim fairness
    }));
  }, [byRace]);

  // Claim denial rates by race
  const denialByRace = useMemo(() => {
    const map: Record<string, { claims: number; denied: number; payment: number }> = {};
    claimFairness.forEach((r) => {
      if (!map[r.race]) map[r.race] = { claims: 0, denied: 0, payment: 0 };
      map[r.race].claims += r.claim_count;
      map[r.race].denied += r.claim_count * r.denial_rate;
      map[r.race].payment += r.avg_payment * r.claim_count;
    });
    return Object.entries(map).map(([race, d]) => ({
      race,
      denial_rate: d.denied / d.claims,
      avg_payment: d.payment / d.claims,
      claim_count: d.claims,
    })).sort((a, b) => b.denial_rate - a.denial_rate);
  }, [claimFairness]);

  // Radar data for race comparison
  const radarData = useMemo(() => {
    if (!byRace.length) return [];
    const maxRisk = Math.max(...byRace.map((r) => r.avg_risk_score));
    const maxPaid = Math.max(...byRace.map((r) => r.avg_combined_paid));
    const maxChronic = Math.max(...byRace.map((r) => r.avg_chronic_count));
    const maxDual = Math.max(...byRace.map((r) => r.dual_eligible_rate));
    const maxHighRisk = Math.max(...byRace.map((r) => r.high_risk_rate));

    return [
      { metric: "Risk Score", ...Object.fromEntries(byRace.map((r) => [r.race, +((r.avg_risk_score / maxRisk) * 100).toFixed(1)])) },
      { metric: "Avg Paid", ...Object.fromEntries(byRace.map((r) => [r.race, +((r.avg_combined_paid / maxPaid) * 100).toFixed(1)])) },
      { metric: "Chronic Burden", ...Object.fromEntries(byRace.map((r) => [r.race, +((r.avg_chronic_count / maxChronic) * 100).toFixed(1)])) },
      { metric: "Dual Eligible", ...Object.fromEntries(byRace.map((r) => [r.race, +((r.dual_eligible_rate / (maxDual || 1)) * 100).toFixed(1)])) },
      { metric: "High Risk", ...Object.fromEntries(byRace.map((r) => [r.race, +((r.high_risk_rate / (maxHighRisk || 1)) * 100).toFixed(1)])) },
    ];
  }, [byRace]);

  const totalPatients = useMemo(() => byRace.reduce((s, r) => s + r.patient_count, 0), [byRace]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading fairness analysis...</p>
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

  const whiteAvgPaid = byRace.find((r) => r.race === "White")?.avg_combined_paid ?? 1;
  const whiteAvgRisk = byRace.find((r) => r.race === "White")?.avg_risk_score ?? 1;
  const whiteDenialRate = denialByRace.find((r) => r.race === "White")?.denial_rate ?? 0;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      {/* Header */}
      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-400">
          CMS Post-Payment Analytics
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-white">Sample Fairness</h1>
        <p className="mt-1 text-sm text-slate-400">
          Demographic equity analysis · audit sample representation · disparity detection
        </p>
      </div>

      {/* Fairness Notice */}
      <div className="mb-6 rounded-xl border border-blue-700/40 bg-blue-950/20 p-4">
        <p className="text-xs leading-relaxed text-blue-200/80">
          <span className="font-semibold text-blue-300">About this analysis:</span> This page examines whether
          audit samples, payment patterns, and denial rates vary across demographic groups in ways that may
          indicate disparate treatment. Disparities in outcomes may reflect underlying health differences,
          socioeconomic factors, or systemic bias — all require investigation. This dataset is{" "}
          <span className="text-white">synthetic</span> and designed for portfolio demonstration.
        </p>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total Beneficiaries", value: fmtNum(totalPatients), accent: "#3b82f6", sub: "Across all demographic groups" },
          { label: "Race/Ethnicity Groups", value: byRace.length.toString(), accent: "#a855f7", sub: "Distinct categories" },
          { label: "Regions Analyzed", value: byRegion.length.toString(), accent: "#06b6d4", sub: "Geographic coverage" },
          { label: "Dual Eligible Rate", value: fmtPct((byDual.find((d) => d.dual_status === "Dual Eligible")?.patient_count ?? 0) / (totalPatients || 1)), accent: "#f97316", sub: "Medicare + Medicaid" },
        ].map((k) => (
          <div key={k.label} className="relative overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/80 p-4">
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: k.accent }} />
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{k.label}</p>
            <p className="text-2xl font-bold text-white">{k.value}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Disparity Summary Row */}
      <div className="mb-6 rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
        <h2 className="mb-3 text-sm font-semibold text-white">
          Payment Disparity Ratios vs White Beneficiaries
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          Ratio of avg combined payment relative to White beneficiaries · 1.0 = equal · values below indicate lower payments received
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {raceDisparities.map((r) => (
            <DisparityBadge
              key={r.race}
              label={r.race}
              ratio={r.payment_ratio}
            />
          ))}
        </div>
      </div>

      {/* Tab Selector */}
      <div className="mb-4 flex gap-2">
        {(["race", "sex", "region", "dual"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg border px-4 py-1.5 text-xs font-semibold capitalize transition-all ${
              activeTab === tab
                ? "border-blue-500 bg-blue-500/10 text-blue-300"
                : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
            }`}
          >
            {tab === "dual" ? "Dual Status" : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ── RACE TAB ── */}
      {activeTab === "race" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Payment by Race */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Avg Combined Payment by Race</h2>
            <p className="mb-4 text-xs text-slate-500">Average total Medicare payment per beneficiary</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byRace} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="race" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt$(v)} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [fmt$(v), "Avg Payment"]}
                />
                <ReferenceLine y={whiteAvgPaid} stroke="#3b82f680" strokeDasharray="4 4" />
                <Bar dataKey="avg_combined_paid" name="Avg Payment" radius={[4, 4, 0, 0]}>
                  {byRace.map((r) => <Cell key={r.race} fill={RACE_COLORS[r.race] ?? "#64748b"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Denial Rate by Race */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Claim Denial Rate by Race</h2>
            <p className="mb-4 text-xs text-slate-500">Proportion of claims denied per racial group</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={denialByRace} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="race" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [fmtPct(v), "Denial Rate"]}
                />
                <ReferenceLine y={whiteDenialRate} stroke="#3b82f680" strokeDasharray="4 4" />
                <Bar dataKey="denial_rate" name="Denial Rate" radius={[4, 4, 0, 0]}>
                  {denialByRace.map((r) => <Cell key={r.race} fill={RACE_COLORS[r.race] ?? "#64748b"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Risk Score by Race */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Risk Score &amp; Chronic Burden by Race</h2>
            <p className="mb-4 text-xs text-slate-500">Avg HCC risk score and chronic condition count</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byRace} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="race" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, name: string) => [v.toFixed(3), name]}
                />
                <ReferenceLine y={whiteAvgRisk} stroke="#3b82f680" strokeDasharray="4 4" />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Bar dataKey="avg_risk_score" name="Avg Risk Score" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="avg_chronic_count" name="Avg Chronic Count" fill="#a855f7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Dual Eligible Rate by Race */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Social Vulnerability by Race</h2>
            <p className="mb-4 text-xs text-slate-500">Dual eligible rate and low income subsidy rate per group</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byRace} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="race" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, name: string) => [fmtPct(v), name]}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Bar dataKey="dual_eligible_rate" name="Dual Eligible" fill="#f97316" radius={[4, 4, 0, 0]} />
                <Bar dataKey="low_income_rate" name="Low Income Subsidy" fill="#eab308" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── SEX TAB ── */}
      {activeTab === "sex" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Payment &amp; Risk by Sex</h2>
            <p className="mb-4 text-xs text-slate-500">Average combined payment and risk score by sex</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={bySex} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="sex" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt$(v)} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, name: string) => [name.includes("paid") ? fmt$(v) : v.toFixed(3), name]}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Bar dataKey="avg_combined_paid" name="Avg Payment" radius={[4, 4, 0, 0]}>
                  {bySex.map((r) => <Cell key={r.sex} fill={SEX_COLORS[r.sex] ?? "#64748b"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Sex Breakdown Summary</h2>
            <div className="space-y-3">
              {bySex.map((s) => (
                <div key={s.sex} className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold text-white" style={{ color: SEX_COLORS[s.sex] ?? "#fff" }}>{s.sex}</span>
                    <span className="text-xs text-slate-400">{fmtNum(s.patient_count)} patients ({fmtPct(s.patient_count / totalPatients)})</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {[
                      { label: "Avg Risk", value: fmtNum(s.avg_risk_score, 3) },
                      { label: "Avg Paid", value: fmt$(s.avg_combined_paid) },
                      { label: "Dual Rate", value: fmtPct(s.dual_eligible_rate) },
                    ].map((m) => (
                      <div key={m.label}>
                        <p className="text-[10px] text-slate-500">{m.label}</p>
                        <p className="font-semibold text-white">{m.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── REGION TAB ── */}
      {activeTab === "region" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Payment &amp; Risk by Region</h2>
            <p className="mb-4 text-xs text-slate-500">Geographic variation in payment and risk scores</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byRegion} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="region" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt$(v)} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [fmt$(v), "Avg Payment"]}
                />
                <Bar dataKey="avg_combined_paid" name="Avg Payment" radius={[4, 4, 0, 0]}>
                  {byRegion.map((r) => <Cell key={r.region} fill={REGION_COLORS[r.region] ?? "#64748b"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Dual Eligible Rate by Region</h2>
            <p className="mb-4 text-xs text-slate-500">Social vulnerability varies by geography</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byRegion} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="region" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [fmtPct(v), "Dual Eligible Rate"]}
                />
                <Bar dataKey="dual_eligible_rate" radius={[4, 4, 0, 0]}>
                  {byRegion.map((r) => <Cell key={r.region} fill={REGION_COLORS[r.region] ?? "#64748b"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── DUAL STATUS TAB ── */}
      {activeTab === "dual" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Payment by Dual Status</h2>
            <p className="mb-4 text-xs text-slate-500">Dual eligible beneficiaries have higher acuity and payment</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byDual} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="dual_status" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt$(v)} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [fmt$(v), "Avg Payment"]}
                />
                <Bar dataKey="avg_combined_paid" radius={[4, 4, 0, 0]}>
                  {byDual.map((_, i) => <Cell key={i} fill={["#ef4444", "#f97316", "#22c55e"][i % 3]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Dual Status Summary</h2>
            <div className="space-y-3">
              {byDual.map((d, i) => (
                <div key={d.dual_status} className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold text-white">{d.dual_status}</span>
                    <span className="text-xs text-slate-400">{fmtNum(d.patient_count)} patients</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {[
                      { label: "Avg Risk", value: fmtNum(d.avg_risk_score, 3) },
                      { label: "Avg Paid", value: fmt$(d.avg_combined_paid) },
                      { label: "Avg Chronic", value: fmtNum(d.avg_chronic_count, 1) },
                    ].map((m) => (
                      <div key={m.label}>
                        <p className="text-[10px] text-slate-500">{m.label}</p>
                        <p className="font-semibold text-white">{m.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Interpretation */}
      <div className="mt-6 rounded-xl border border-amber-800/40 bg-amber-950/20 p-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
          🔍 Fairness &amp; Equity Interpretation
        </p>
        <div className="grid grid-cols-1 gap-4 text-[10px] leading-relaxed text-amber-100/80 sm:grid-cols-3">
          <div>
            <p className="mb-1 font-semibold text-amber-300">Payment Disparities</p>
            <p>Payment differences across racial groups may reflect differences in health acuity, geographic access to care, or provider mix — not necessarily inequitable treatment. Disparities should be investigated in context of risk scores and chronic burden.</p>
          </div>
          <div>
            <p className="mb-1 font-semibold text-amber-300">Denial Rate Equity</p>
            <p>Differential denial rates across demographic groups are a key indicator of systemic bias. If higher-risk groups face higher denial rates despite similar clinical presentations, this warrants audit focus on provider-level denial patterns.</p>
          </div>
          <div>
            <p className="mb-1 font-semibold text-amber-300">Dual Eligible Population</p>
            <p>Dual eligible beneficiaries (Medicare + Medicaid) represent the highest-need, highest-cost population. Audit samples should maintain proportional representation of dual eligibles to avoid systematically under-auditing the most vulnerable patients.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
