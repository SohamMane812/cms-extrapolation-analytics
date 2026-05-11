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
  ScatterChart,
  Scatter,
  Cell,
  LineChart,
  Line,
  Legend,
  ReferenceLine,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RiskSummaryAgg {
  age_bucket: string;
  avg_risk_score: number;
  avg_hcc_weight: number;
  avg_chronic: number;
  avg_unsupported: number;
  patient_count: number;
  avg_combined_paid: number;
  avg_hcc_diagnoses: number;
}

interface CodingIntensityRow {
  claim_year: number;
  is_ma_plan: boolean;
  utilization_segment: string;
  annual_cost_bucket: string;
  distinct_patients: number;
  avg_diagnoses_per_patient: number;
  avg_hcc_diagnoses_per_patient: number;
  avg_hcc_weight_per_patient: number;
  avg_risk_score: number;
  avg_combined_paid: number;
  unsupported_dx_rate: number;
  high_value_hcc_rate: number;
  risk_per_10k_paid: number;
  avg_chronic_per_patient: number;
  avg_high_value_hcc_per_patient: number;
}

interface RiskBySegment {
  utilization_segment: string;
  avg_risk_score: number;
  avg_hcc_weight: number;
  avg_combined_paid: number;
  patient_count: number;
  avg_unsupported: number;
}

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

function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
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

const SEGMENT_COLORS: Record<string, string> = {
  High: "#ef4444",
  Medium: "#f97316",
  Low: "#22c55e",
};

const COST_BUCKET_COLORS: Record<string, string> = {
  Catastrophic: "#ef4444",
  High_Cost: "#f97316",
  Medium_Cost: "#eab308",
  Low_Cost: "#22c55e",
};

const AGE_COLOR = "#3b82f6";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RiskAdjustmentPage() {
  const [riskByAge, setRiskByAge] = useState<RiskSummaryAgg[]>([]);
  const [codingIntensity, setCodingIntensity] = useState<CodingIntensityRow[]>([]);
  const [riskBySegment, setRiskBySegment] = useState<RiskBySegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [yearFilter, setYearFilter] = useState<number | "All">("All");
  const [segmentFilter, setSegmentFilter] = useState("All");

  useEffect(() => {
    async function load() {
      try {
        const [ageRows, intensityRows, segmentRows] = await Promise.all([
          // Risk score by age bucket
          runQuery<RiskSummaryAgg>(`
            SELECT
              age_bucket,
              AVG(risk_score)            AS avg_risk_score,
              AVG(total_hcc_weight)      AS avg_hcc_weight,
              AVG(bene_chronic_count)    AS avg_chronic,
              AVG(unsupported_diagnoses) AS avg_unsupported,
              COUNT(*)                   AS patient_count,
              AVG(total_combined_paid)   AS avg_combined_paid,
              AVG(hcc_mapped_diagnoses)  AS avg_hcc_diagnoses
            FROM \`cms-extrapolation-v1.analytics_cms_claims.patient_risk_summary\`
            WHERE age_bucket IS NOT NULL
            GROUP BY age_bucket
            ORDER BY age_bucket
          `),
          // Coding intensity summary
          runQuery<CodingIntensityRow>(`
            SELECT *
            FROM \`cms-extrapolation-v1.analytics_cms_claims.coding_intensity_summary\`
            ORDER BY claim_year, utilization_segment, annual_cost_bucket
          `),
          // Risk by utilization segment
          runQuery<RiskBySegment>(`
            SELECT
              utilization_segment,
              AVG(risk_score)            AS avg_risk_score,
              AVG(total_hcc_weight)      AS avg_hcc_weight,
              AVG(total_combined_paid)   AS avg_combined_paid,
              COUNT(*)                   AS patient_count,
              AVG(unsupported_diagnoses) AS avg_unsupported
            FROM \`cms-extrapolation-v1.analytics_cms_claims.patient_risk_summary\`
            WHERE utilization_segment IS NOT NULL
            GROUP BY utilization_segment
            ORDER BY avg_risk_score DESC
          `),
        ]);
        setRiskByAge(ageRows);
        setCodingIntensity(intensityRows);
        setRiskBySegment(segmentRows);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Derived: years and segments
  const years = useMemo(() =>
    ["All", ...Array.from(new Set(codingIntensity.map((r) => r.claim_year))).sort()],
    [codingIntensity]
  );

  const filteredIntensity = useMemo(() =>
    codingIntensity.filter((r) =>
      (yearFilter === "All" || r.claim_year === yearFilter) &&
      (segmentFilter === "All" || r.utilization_segment === segmentFilter)
    ),
    [codingIntensity, yearFilter, segmentFilter]
  );

  // Coding intensity by year (aggregated)
  const intensityByYear = useMemo(() => {
    const map: Record<number, { year: number; avg_hcc_weight: number; avg_risk: number; count: number }> = {};
    codingIntensity.forEach((r) => {
      if (!map[r.claim_year]) map[r.claim_year] = { year: r.claim_year, avg_hcc_weight: 0, avg_risk: 0, count: 0 };
      map[r.claim_year].avg_hcc_weight += r.avg_hcc_weight_per_patient * r.distinct_patients;
      map[r.claim_year].avg_risk += r.avg_risk_score * r.distinct_patients;
      map[r.claim_year].count += r.distinct_patients;
    });
    return Object.values(map).map((r) => ({
      year: r.year,
      avg_hcc_weight: +(r.avg_hcc_weight / r.count).toFixed(3),
      avg_risk: +(r.avg_risk / r.count).toFixed(3),
    })).sort((a, b) => a.year - b.year);
  }, [codingIntensity]);

  // Cost bucket breakdown from filtered intensity
  const byCostBucket = useMemo(() => {
    const map: Record<string, { bucket: string; avg_hcc: number; avg_risk: number; avg_paid: number; count: number }> = {};
    filteredIntensity.forEach((r) => {
      const b = r.annual_cost_bucket;
      if (!map[b]) map[b] = { bucket: b, avg_hcc: 0, avg_risk: 0, avg_paid: 0, count: 0 };
      map[b].avg_hcc += r.avg_hcc_diagnoses_per_patient * r.distinct_patients;
      map[b].avg_risk += r.avg_risk_score * r.distinct_patients;
      map[b].avg_paid += r.avg_combined_paid * r.distinct_patients;
      map[b].count += r.distinct_patients;
    });
    return Object.values(map).map((r) => ({
      bucket: r.bucket.replace(/_/g, " "),
      avg_hcc: +(r.avg_hcc / r.count).toFixed(2),
      avg_risk: +(r.avg_risk / r.count).toFixed(3),
      avg_paid: +(r.avg_paid / r.count).toFixed(0),
    })).sort((a, b) => b.avg_risk - a.avg_risk);
  }, [filteredIntensity]);

  // Overall KPIs
  const overallKPIs = useMemo(() => {
    if (!codingIntensity.length) return null;
    const totalPats = codingIntensity.reduce((s, r) => s + r.distinct_patients, 0);
    const avgRisk = codingIntensity.reduce((s, r) => s + r.avg_risk_score * r.distinct_patients, 0) / totalPats;
    const avgHCC = codingIntensity.reduce((s, r) => s + r.avg_hcc_weight_per_patient * r.distinct_patients, 0) / totalPats;
    const avgDx = codingIntensity.reduce((s, r) => s + r.avg_diagnoses_per_patient * r.distinct_patients, 0) / totalPats;
    const unsupportedRate = codingIntensity.reduce((s, r) => s + r.unsupported_dx_rate * r.distinct_patients, 0) / totalPats;
    return { avgRisk, avgHCC, avgDx, unsupportedRate, totalPats };
  }, [codingIntensity]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading risk adjustment data...</p>
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
          Risk Adjustment &amp; Coding Intensity
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          HCC weight analysis · risk score distribution · coding pattern trends
        </p>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Avg Risk Score", value: overallKPIs ? fmtNum(overallKPIs.avgRisk, 3) : "—", accent: "#3b82f6", sub: "Across all beneficiaries" },
          { label: "Avg HCC Weight", value: overallKPIs ? fmtNum(overallKPIs.avgHCC, 2) : "—", accent: "#a855f7", sub: "Per patient total" },
          { label: "Avg Diagnoses/Patient", value: overallKPIs ? fmtNum(overallKPIs.avgDx, 1) : "—", accent: "#06b6d4", sub: "Across all claim years" },
          { label: "Unsupported Dx Rate", value: overallKPIs ? fmtPct(overallKPIs.unsupportedRate) : "—", accent: "#ef4444", sub: "Suspected unsupported codes" },
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
        <span className="text-xs text-slate-400">Claim Year:</span>
        <div className="flex gap-1">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setYearFilter(y as number | "All")}
              className={`rounded-lg border px-3 py-1 text-xs font-medium transition-all ${
                yearFilter === y
                  ? "border-blue-500 bg-blue-500/10 text-blue-300"
                  : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
        <span className="ml-4 text-xs text-slate-400">Utilization:</span>
        <div className="flex gap-1">
          {["All", "High", "Medium", "Low"].map((s) => (
            <button
              key={s}
              onClick={() => setSegmentFilter(s)}
              className={`rounded-lg border px-3 py-1 text-xs font-medium transition-all ${
                segmentFilter === s
                  ? "border-purple-500 bg-purple-500/10 text-purple-300"
                  : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* Risk Score by Age Bucket */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">Risk Score by Age Bucket</h2>
          <p className="mb-4 text-xs text-slate-500">
            Average HCC-based risk score across patient age groups
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={riskByAge} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="age_bucket" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, "auto"]} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number, name: string) => [v.toFixed(3), name]}
              />
              <ReferenceLine y={1.0} stroke="#64748b" strokeDasharray="4 4" label={{ value: "Baseline 1.0", fill: "#64748b", fontSize: 9, position: "insideTopRight" }} />
              <Bar dataKey="avg_risk_score" name="Avg Risk Score" radius={[4, 4, 0, 0]} fill={AGE_COLOR} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* HCC Weight by Age */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">Avg HCC Weight &amp; Diagnoses by Age</h2>
          <p className="mb-4 text-xs text-slate-500">
            Total HCC weight and HCC-mapped diagnosis count per patient age group
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={riskByAge} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="age_bucket" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number, name: string) => [v.toFixed(2), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              <Bar dataKey="avg_hcc_weight" name="Avg HCC Weight" fill="#a855f7" radius={[4, 4, 0, 0]} />
              <Bar dataKey="avg_hcc_diagnoses" name="Avg HCC Diagnoses" fill="#06b6d4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Coding Intensity Trend */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">Coding Intensity Trend</h2>
          <p className="mb-4 text-xs text-slate-500">
            Avg HCC weight and risk score per patient by claim year — rising trends may indicate upcoding
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={intensityByYear} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number, name: string) => [v.toFixed(3), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              <Line dataKey="avg_hcc_weight" name="Avg HCC Weight" stroke="#a855f7" strokeWidth={2} dot={{ r: 4 }} />
              <Line dataKey="avg_risk" name="Avg Risk Score" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Risk by Cost Bucket */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">Risk Score by Cost Bucket</h2>
          <p className="mb-4 text-xs text-slate-500">
            Average risk score and HCC diagnoses per patient cost tier
            {yearFilter !== "All" && <span className="ml-1 text-blue-300">· {yearFilter}</span>}
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byCostBucket} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="bucket" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number, name: string) => [v.toFixed(2), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              <Bar dataKey="avg_risk" name="Avg Risk Score" radius={[4, 4, 0, 0]}>
                {byCostBucket.map((row) => (
                  <Cell key={row.bucket} fill={COST_BUCKET_COLORS[row.bucket.replace(/ /g, "_")] ?? "#64748b"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Risk vs Payment Scatter */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">Risk Score vs Payment by Utilization Segment</h2>
          <p className="mb-4 text-xs text-slate-500">
            Each point = one patient segment · higher risk should correlate with higher payment
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 4, right: 8, bottom: 16, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="avg_risk_score"
                name="Avg Risk Score"
                type="number"
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                label={{ value: "Avg Risk Score", position: "insideBottom", offset: -8, fill: "#64748b", fontSize: 10 }}
              />
              <YAxis
                dataKey="avg_combined_paid"
                name="Avg Combined Paid"
                type="number"
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => fmt$(v)}
              />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number, name: string) => [
                  name === "avg_combined_paid" ? fmt$(v) : v.toFixed(3),
                  name,
                ]}
              />
              {["High", "Medium", "Low"].map((seg) => (
                <Scatter
                  key={seg}
                  name={seg}
                  data={filteredIntensity.filter((r) => r.utilization_segment === seg).map((r) => ({
                    avg_risk_score: r.avg_risk_score,
                    avg_combined_paid: r.avg_combined_paid,
                    utilization_segment: r.utilization_segment,
                  }))}
                  fill={SEGMENT_COLORS[seg] ?? "#64748b"}
                  fillOpacity={0.7}
                />
              ))}
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Utilization Segment Summary */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">Risk Profile by Utilization Segment</h2>
          <p className="mb-4 text-xs text-slate-500">
            Average risk metrics per utilization tier
          </p>
          <div className="space-y-3">
            {riskBySegment.map((seg) => (
              <div key={seg.utilization_segment} className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span
                    className="text-sm font-semibold"
                    style={{ color: SEGMENT_COLORS[seg.utilization_segment] ?? "#94a3b8" }}
                  >
                    {seg.utilization_segment} Utilization
                  </span>
                  <span className="text-xs text-slate-400">{fmtNum(seg.patient_count)} patients</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  {[
                    { label: "Avg Risk Score", value: fmtNum(seg.avg_risk_score, 3) },
                    { label: "Avg HCC Weight", value: fmtNum(seg.avg_hcc_weight, 2) },
                    { label: "Avg Total Paid", value: fmt$(seg.avg_combined_paid) },
                  ].map((m) => (
                    <div key={m.label}>
                      <p className="text-[10px] text-slate-500">{m.label}</p>
                      <p className="font-semibold text-white">{m.value}</p>
                    </div>
                  ))}
                </div>
                {/* Risk score bar */}
                <div className="mt-2 h-1 w-full rounded-full bg-slate-700">
                  <div
                    className="h-1 rounded-full transition-all"
                    style={{
                      width: `${Math.min((seg.avg_risk_score / 3) * 100, 100)}%`,
                      background: SEGMENT_COLORS[seg.utilization_segment] ?? "#64748b",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Interpretation */}
      <div className="mt-6 rounded-xl border border-amber-800/40 bg-amber-950/20 p-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
          🔍 Risk Adjustment Interpretation
        </p>
        <div className="grid grid-cols-1 gap-4 text-[10px] leading-relaxed text-amber-100/80 sm:grid-cols-3">
          <div>
            <p className="mb-1 font-semibold text-amber-300">HCC Coding &amp; Risk Scores</p>
            <p>
              HCC (Hierarchical Condition Category) weights are the primary driver of Medicare Advantage risk scores.
              Higher HCC weight = higher projected cost = higher capitation payment. Providers with elevated HCC weights
              relative to clinical acuity are a key audit target.
            </p>
          </div>
          <div>
            <p className="mb-1 font-semibold text-amber-300">Coding Intensity Trend</p>
            <p>
              A rising HCC weight trend across years without corresponding increases in actual utilization may indicate
              systematic upcoding. This dataset shows relatively stable coding intensity — directionally correct for a
              simulated population.
            </p>
          </div>
          <div>
            <p className="mb-1 font-semibold text-amber-300">Risk-Payment Alignment</p>
            <p>
              High utilization patients show the highest risk scores and payments — expected. Misalignment between risk
              score and actual payment (risk_score_per_10k_paid) is a potential indicator of inappropriate risk
              adjustment gaming.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
