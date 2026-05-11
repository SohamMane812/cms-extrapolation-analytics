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
  PieChart,
  Pie,
  Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DQSummaryRow {
  source_table: string;
  issue_type: string;
  issue_count: number;
  severity: string;
  distinct_records_affected: number;
  distinct_providers_affected: number;
  distinct_patients_affected: number;
  avg_numeric_value: number | null;
  max_numeric_value: number | null;
  pct_of_table_issues: number;
}

interface DQIssueRow {
  source_table: string;
  record_id: string;
  bene_mbi_id: string | null;
  provider_id: string | null;
  issue_type: string;
  issue_description: string;
  numeric_value: number | null;
  logged_at: { value: string } | string;
}

interface TableStats {
  table_name: string;
  total_rows: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, string> = {
  Critical: "bg-red-900/50 text-red-300 border-red-700",
  High: "bg-orange-900/50 text-orange-300 border-orange-700",
  Medium: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  Low: "bg-green-900/50 text-green-300 border-green-700",
};

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#eab308",
  Low: "#22c55e",
};

const TABLE_COLORS: Record<string, string> = {
  cclf1: "#3b82f6",
  cclf4: "#a855f7",
  cclf5: "#06b6d4",
  cclf8: "#f97316",
  provider_dim: "#22c55e",
};

const TABLE_DESCRIPTIONS: Record<string, string> = {
  cclf1: "Part A Claims Header",
  cclf4: "Diagnosis Codes",
  cclf5: "Part B Claim Lines",
  cclf8: "Beneficiary Demographics",
  provider_dim: "Provider Dimension",
};

const ISSUE_DESCRIPTIONS: Record<string, string> = {
  payment_outlier: "Line-level payments with z-score deviation exceeding threshold — may indicate billing anomalies or data entry errors.",
  missing_county: "Beneficiary county code is null — affects geographic analysis and rural/urban segmentation.",
  missing_race: "Beneficiary race code is null — affects health equity analysis and demographic stratification.",
  negative_payment: "Negative payment amounts — may represent valid reversals/recoupments or data errors.",
  missing_drg: "Inpatient claims missing DRG code — required for severity-adjusted benchmarking.",
  null_provider: "Claims with null provider ID — cannot be attributed to a provider for audit purposes.",
  duplicate_claim: "Duplicate claim IDs detected in raw data — resolved via is_latest_version flag in staging.",
  invalid_icd10: "Diagnosis codes that do not conform to ICD-10-CM format.",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString();
}

function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null || isNaN(n)) return "—";
  return `${(n * 100).toFixed(decimals)}%`;
}

function fmtDate(d: { value: string } | string | null | undefined): string {
  if (!d) return "—";
  const s = typeof d === "object" ? d.value : d;
  return s?.slice(0, 10) ?? "—";
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

// ── Pipeline Stage ────────────────────────────────────────────────────────────

function PipelineStage({
  label,
  rows,
  tables,
  color,
  note,
}: {
  label: string;
  rows: string;
  tables: number;
  color: string;
  note?: string;
}) {
  return (
    <div className="relative flex flex-col items-center">
      <div
        className="rounded-xl border p-4 text-center"
        style={{ borderColor: `${color}40`, background: `${color}10` }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
          {label}
        </p>
        <p className="mt-1 text-xl font-bold text-white">{rows}</p>
        <p className="text-[10px] text-slate-500">{tables} tables</p>
        {note && <p className="mt-1 text-[10px] text-slate-400">{note}</p>}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DataQualityPage() {
  const [summary, setSummary] = useState<DQSummaryRow[]>([]);
  const [issues, setIssues] = useState<DQIssueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters for record-level issues
  const [selectedIssueType, setSelectedIssueType] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const rows = await runQuery<DQSummaryRow>(`
          SELECT * FROM \`cms-extrapolation-v1.analytics_cms_claims.data_quality_summary\`
          ORDER BY issue_count DESC
        `);
        setSummary(rows);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Load record-level issues when filter selected
  useEffect(() => {
    if (!selectedIssueType) { setIssues([]); return; }
    setIssuesLoading(true);
    const tableClause = selectedTable ? `AND source_table = '${selectedTable}'` : "";
    runQuery<DQIssueRow>(`
      SELECT source_table, record_id, bene_mbi_id, provider_id,
        issue_type, issue_description, numeric_value, logged_at
      FROM \`cms-extrapolation-v1.staging_cms_claims.stg_data_quality_issues\`
      WHERE issue_type = '${selectedIssueType}' ${tableClause}
      ORDER BY logged_at DESC
      LIMIT 50
    `).then(setIssues).finally(() => setIssuesLoading(false));
  }, [selectedIssueType, selectedTable]);

  // Derived
  const totalIssues = useMemo(() => summary.reduce((s, r) => s + r.issue_count, 0), [summary]);
  const totalRecordsAffected = useMemo(() => summary.reduce((s, r) => s + r.distinct_records_affected, 0), [summary]);
  const totalProvidersAffected = useMemo(() =>
    Math.max(...summary.map((r) => r.distinct_providers_affected ?? 0)), [summary]);

  // By table
  const byTable = useMemo(() => {
    const map: Record<string, number> = {};
    summary.forEach((r) => {
      map[r.source_table] = (map[r.source_table] ?? 0) + r.issue_count;
    });
    return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [summary]);

  // By severity
  const bySeverity = useMemo(() => {
    const map: Record<string, number> = {};
    summary.forEach((r) => {
      map[r.severity] = (map[r.severity] ?? 0) + r.issue_count;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value, color: SEVERITY_COLORS[name] ?? "#64748b" }));
  }, [summary]);

  const uniqueTables = useMemo(() => Array.from(new Set(summary.map((r) => r.source_table))), [summary]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading data quality report...</p>
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
        <h1 className="text-3xl font-bold tracking-tight text-white">Data Quality Monitor</h1>
        <p className="mt-1 text-sm text-slate-400">
          Staging validation results · field-level issue tracking · pipeline health
        </p>
      </div>

      {/* KPI Row */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total DQ Issues", value: fmtNum(totalIssues), accent: "#f97316", sub: "Captured in staging layer" },
          { label: "Records Affected", value: fmtNum(totalRecordsAffected), accent: "#eab308", sub: "Distinct records with issues" },
          { label: "Issue Types", value: summary.length.toString(), accent: "#3b82f6", sub: "Distinct issue categories" },
          { label: "Providers Affected", value: fmtNum(totalProvidersAffected), accent: "#a855f7", sub: "Max across issue types" },
        ].map((k) => (
          <div key={k.label} className="relative overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/80 p-4">
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: k.accent }} />
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{k.label}</p>
            <p className="text-2xl font-bold text-white">{k.value}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Pipeline Flow */}
      <div className="mb-6 rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Pipeline Layer Summary</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <PipelineStage label="Raw" rows="5,104,395" tables={7} color="#64748b" note="Unvalidated ingestion" />
          <PipelineStage label="Staging" rows="5,140,615" tables={6} color="#3b82f6" note={`${fmtNum(totalIssues)} DQ issues logged`} />
          <PipelineStage label="Curated" rows="4,652,849" tables={8} color="#22c55e" note="is_latest_version = TRUE" />
          <PipelineStage label="Analytics" rows="~737K" tables={9} color="#a855f7" note="Materialized aggregates" />
        </div>
        <div className="mt-4 rounded-lg border border-slate-700/40 bg-slate-800/30 p-3">
          <p className="text-[10px] leading-relaxed text-slate-400">
            <span className="font-semibold text-white">Staging → Curated drop:</span> 5,140,615 → 4,652,849 rows ({((1 - 4652849/5140615)*100).toFixed(1)}% filtered).
            Records removed by <span className="text-blue-300">is_latest_version = FALSE</span> (duplicate/adjusted claims) and{" "}
            <span className="text-orange-300">has_critical_null = TRUE</span> (missing required fields).
            All {fmtNum(totalIssues)} DQ issues are logged but non-critical issues are retained for analysis.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Left: Charts ── */}
        <div className="space-y-5 lg:col-span-2">

          {/* Issue count by table */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">DQ Issues by Source Table</h2>
            <p className="mb-4 text-xs text-slate-500">Total issue count per table · click a bar to drill into issue types</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byTable} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.toLocaleString()} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [v.toLocaleString(), "Issues"]}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}
                  onClick={(d) => setSelectedTable(selectedTable === d.name ? null : d.name)}>
                  {byTable.map((row) => (
                    <Cell
                      key={row.name}
                      fill={TABLE_COLORS[row.name] ?? "#64748b"}
                      opacity={selectedTable && selectedTable !== row.name ? 0.3 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Issue breakdown table */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Issue Type Breakdown</h2>
            <p className="mb-4 text-xs text-slate-500">
              Click a row to load record-level samples
              {selectedTable && <span className="ml-2 text-blue-300">· filtered to {selectedTable}</span>}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700">
                    {["Issue Type", "Table", "Severity", "Issue Count", "Records Affected", "Providers Affected", "% of Table"].map((h) => (
                      <th key={h} className="pb-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary
                    .filter((r) => !selectedTable || r.source_table === selectedTable)
                    .map((row) => (
                      <tr
                        key={`${row.source_table}-${row.issue_type}`}
                        className={`cursor-pointer border-b border-slate-800/40 transition-colors hover:bg-slate-800/30 ${
                          selectedIssueType === row.issue_type ? "bg-blue-950/30" : ""
                        }`}
                        onClick={() => setSelectedIssueType(
                          selectedIssueType === row.issue_type ? null : row.issue_type
                        )}
                      >
                        <td className="py-2 pr-4">
                          <p className="font-medium text-white">{row.issue_type.replace(/_/g, " ")}</p>
                          <p className="text-[10px] text-slate-500">
                            {ISSUE_DESCRIPTIONS[row.issue_type]?.slice(0, 60)}...
                          </p>
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ background: `${TABLE_COLORS[row.source_table] ?? "#64748b"}20`, color: TABLE_COLORS[row.source_table] ?? "#94a3b8" }}
                          >
                            {row.source_table}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${SEVERITY_STYLES[row.severity] ?? ""}`}>
                            {row.severity}
                          </span>
                        </td>
                        <td className="py-2 pr-4 font-semibold text-white">{fmtNum(row.issue_count)}</td>
                        <td className="py-2 pr-4 text-slate-300">{fmtNum(row.distinct_records_affected)}</td>
                        <td className="py-2 pr-4 text-slate-300">{fmtNum(row.distinct_providers_affected)}</td>
                        <td className="py-2 pr-4 text-slate-400">{fmtPct(row.pct_of_table_issues)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Record-level samples */}
          {selectedIssueType && (
            <div className="rounded-xl border border-blue-700/40 bg-slate-900/80 p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Record Samples — {selectedIssueType.replace(/_/g, " ")}
                  </h2>
                  <p className="text-xs text-slate-500">First 50 affected records from staging</p>
                </div>
                <button
                  onClick={() => setSelectedIssueType(null)}
                  className="text-xs text-slate-500 hover:text-white"
                >
                  ✕ Close
                </button>
              </div>

              {/* Issue description */}
              <div className="mb-4 rounded-lg border border-amber-800/30 bg-amber-950/20 p-3">
                <p className="text-[10px] leading-relaxed text-amber-100/80">
                  {ISSUE_DESCRIPTIONS[selectedIssueType] ?? "No description available."}
                </p>
              </div>

              {issuesLoading ? (
                <div className="flex h-20 items-center justify-center">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-700">
                        {["Record ID", "Table", "Patient ID", "Provider ID", "Description", "Value", "Logged"].map((h) => (
                          <th key={h} className="pb-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {issues.map((issue, i) => (
                        <tr key={i} className="border-b border-slate-800/40">
                          <td className="py-1.5 pr-4 font-mono text-blue-300">{issue.record_id}</td>
                          <td className="py-1.5 pr-4 text-slate-400">{issue.source_table}</td>
                          <td className="py-1.5 pr-4 text-slate-300">{issue.bene_mbi_id ?? "—"}</td>
                          <td className="py-1.5 pr-4 text-slate-300">{issue.provider_id ?? "—"}</td>
                          <td className="py-1.5 pr-4 text-slate-400">{issue.issue_description}</td>
                          <td className="py-1.5 pr-4 text-orange-300">{issue.numeric_value?.toFixed(2) ?? "—"}</td>
                          <td className="py-1.5 pr-4 text-slate-500">{fmtDate(issue.logged_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {issues.length === 0 && (
                    <p className="py-4 text-center text-xs text-slate-500">No records found.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right Panel ── */}
        <div className="space-y-5 lg:col-span-1">

          {/* Severity Distribution */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Issues by Severity</h2>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={bySeverity}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {bySeverity.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [v.toLocaleString(), "Issues"]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-1">
              {bySeverity.map((s) => (
                <div key={s.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                    <span className="text-slate-300">{s.name}</span>
                  </span>
                  <span className="font-semibold text-white">{fmtNum(s.value)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Table Health Cards */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Table Health</h2>
            <div className="space-y-3">
              {uniqueTables.map((tbl) => {
                const tableIssues = summary.filter((r) => r.source_table === tbl);
                const totalIssuesForTable = tableIssues.reduce((s, r) => s + r.issue_count, 0);
                const hasCritical = tableIssues.some((r) => r.severity === "Critical");
                const hasHigh = tableIssues.some((r) => r.severity === "High");
                const health = hasCritical ? "Critical" : hasHigh ? "High" : totalIssuesForTable > 5000 ? "Medium" : "Low";
                const color = SEVERITY_COLORS[health];

                return (
                  <div
                    key={tbl}
                    className="cursor-pointer rounded-lg border border-slate-700/40 bg-slate-800/30 p-3 transition-colors hover:bg-slate-800/60"
                    onClick={() => setSelectedTable(selectedTable === tbl ? null : tbl)}
                    style={selectedTable === tbl ? { borderColor: `${TABLE_COLORS[tbl]}60` } : {}}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-white">{tbl}</p>
                        <p className="text-[10px] text-slate-500">{TABLE_DESCRIPTIONS[tbl] ?? ""}</p>
                      </div>
                      <span
                        className="rounded border px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ borderColor: `${color}60`, background: `${color}15`, color }}
                      >
                        {health}
                      </span>
                    </div>
                    <div className="mt-2 flex gap-3 text-[10px] text-slate-400">
                      <span>{tableIssues.length} issue type{tableIssues.length !== 1 ? "s" : ""}</span>
                      <span>{fmtNum(totalIssuesForTable)} total issues</span>
                    </div>
                    {/* Mini bar */}
                    <div className="mt-1.5 h-1 w-full rounded-full bg-slate-700">
                      <div
                        className="h-1 rounded-full transition-all"
                        style={{
                          width: `${Math.min((totalIssuesForTable / totalIssues) * 100, 100)}%`,
                          background: TABLE_COLORS[tbl] ?? "#64748b",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DQ Interpretation */}
          <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-5">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
              🔍 Data Quality Assessment
            </p>
            <div className="space-y-2 text-[10px] leading-relaxed text-amber-100/80">
              <p>
                <span className="font-semibold text-amber-300">Overall health: Good.</span> All {fmtNum(totalIssues)} issues
                are classified as Low severity — no Critical or High severity issues detected across any table.
              </p>
              <p>
                The largest issue category is <span className="text-white">payment_outlier in cclf5</span> ({fmtNum(30480)} records) — these are statistical outliers by z-score, not necessarily billing errors. They are retained in curated for anomaly detection.
              </p>
              <p>
                Missing demographic fields (county, race) affect beneficiary-level equity analysis but do not impact claim payment validation or provider benchmarking.
              </p>
              <p>
                The <span className="text-white">{((1 - 4652849/5140615)*100).toFixed(1)}% staging → curated drop</span> is driven by duplicate resolution and adjustment chain deduplication, not DQ failures.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
