"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Claim {
  claim_id: string;
  patient_id: string;
  provider_id: string;
  chain_root_id: string;
  claim_type: string;
  facility_type: string;
  claim_status: string;
  adjustment_type: string;
  is_paid: boolean;
  is_denied: boolean;
  claim_from_date: { value: string } | string;
  claim_thru_date: { value: string } | string;
  claim_span_days: number;
  payment_amount: number;
  denial_reason_code: string | null;
  drg_code: string | null;
  length_of_stay: number | null;
  has_overpayment: boolean;
  overpayment_amount: number;
  is_audit_eligible: boolean;
  is_true_error: boolean;
  provider_type: string;
  peer_group: string;
  provider_risk_profile: string;
  provider_region: string;
  patient_age: number;
  patient_age_bucket: string;
  patient_sex: string;
  patient_risk_score: number;
  patient_chronic_count: number;
  patient_cost_bucket: string;
  patient_dual_status: string;
  patient_utilization_segment: string;
}

interface Diagnosis {
  claim_id: string;
  diagnosis_code: string;
  diagnosis_sequence: number;
  diagnosis_type: string;
  is_principal_dx: boolean;
  is_hcc_mapped: boolean;
  is_chronic: boolean;
  is_high_value_hcc: boolean;
  is_suspected_unsupported: boolean;
  hcc_category: string | null;
  hcc_weight: number | null;
  diagnosis_description: string;
  body_system: string;
  present_on_admission: string | null;
}

interface AdjChain {
  claim_id: string;
  claim_status: string;
  adjustment_type: string;
  payment_amount: number;
  overpayment_amount: number;
  has_overpayment: boolean;
  claim_from_date: { value: string } | string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  Outlier: "#ef4444",
  Suspicious: "#f97316",
  High_Volume: "#eab308",
  Normal: "#22c55e",
  Emerging: "#3b82f6",
};

const STATUS_STYLES: Record<string, string> = {
  Paid: "bg-green-900/50 text-green-300 border-green-700",
  Denied: "bg-red-900/50 text-red-300 border-red-700",
  Adjusted: "bg-blue-900/50 text-blue-300 border-blue-700",
  Cancelled: "bg-slate-700/50 text-slate-400 border-slate-600",
};

const ADJ_TYPE_LABELS: Record<string, string> = {
  "0": "Original",
  "1": "Cancellation",
  "2": "Adjustment",
};

const PAGE_SIZE = 25;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtDate(d: { value: string } | string | null | undefined): string {
  if (!d) return "—";
  const s = typeof d === "object" ? d.value : d;
  return s?.slice(0, 10) ?? "—";
}

function getRiskScore(claim: Claim): number {
  let score = 0;
  if (claim.has_overpayment) score += 3;
  if (claim.is_true_error) score += 3;
  if (claim.is_denied) score += 1;
  if (claim.adjustment_type !== "0") score += 1;
  if (["Suspicious", "Outlier"].includes(claim.provider_risk_profile)) score += 2;
  if (claim.payment_amount > 10000) score += 1;
  if (claim.patient_risk_score > 2) score += 1;
  return score;
}

function getRiskLabel(score: number): { label: string; color: string; bg: string } {
  if (score >= 6) return { label: "Critical", color: "#ef4444", bg: "bg-red-900/40 border-red-700 text-red-300" };
  if (score >= 4) return { label: "High", color: "#f97316", bg: "bg-orange-900/40 border-orange-700 text-orange-300" };
  if (score >= 2) return { label: "Medium", color: "#eab308", bg: "bg-yellow-900/40 border-yellow-700 text-yellow-300" };
  return { label: "Low", color: "#22c55e", bg: "bg-green-900/40 border-green-700 text-green-300" };
}

function buildWhyRisky(claim: Claim, diagnoses: Diagnosis[]): string[] {
  const reasons: string[] = [];
  if (claim.is_true_error) reasons.push("Claim contains a confirmed billing error — overpayment was identified in audit.");
  if (claim.has_overpayment) reasons.push(`Overpayment of ${fmt$(claim.overpayment_amount)} detected on this claim.`);
  if (claim.is_denied) reasons.push(`Claim was denied${claim.denial_reason_code ? ` (reason code: ${claim.denial_reason_code})` : ""} — denied claims indicate documentation or coverage issues.`);
  if (claim.adjustment_type === "2") reasons.push("This claim is part of an adjustment chain — original claim was subsequently modified, which may indicate corrected billing or post-payment review activity.");
  if (claim.adjustment_type === "1") reasons.push("This claim was cancelled — cancellations may indicate a billing reversal or recoupment.");
  if (["Suspicious", "Outlier"].includes(claim.provider_risk_profile))
    reasons.push(`Provider is flagged as ${claim.provider_risk_profile} risk — this provider has elevated composite anomaly scores and multiple audit flags.`);
  if (claim.payment_amount > 10000) reasons.push(`High-dollar claim (${fmt$(claim.payment_amount)}) — payments above $10K receive additional scrutiny in post-payment review.`);
  if (claim.patient_risk_score > 2) reasons.push(`Patient has elevated risk score (${claim.patient_risk_score.toFixed(2)}) — high-risk patients may have unsupported diagnosis coding.`);
  const unsupported = diagnoses.filter((d) => d.is_suspected_unsupported);
  if (unsupported.length > 0) reasons.push(`${unsupported.length} diagnosis code(s) flagged as potentially unsupported: ${unsupported.map((d) => d.diagnosis_code).join(", ")}.`);
  const hccDx = diagnoses.filter((d) => d.is_hcc_mapped);
  if (hccDx.length > 0) reasons.push(`${hccDx.length} HCC-mapped diagnosis code(s) present — HCC coding affects risk adjustment payments and is a common audit target.`);
  return reasons;
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

// ── Risk Badge ────────────────────────────────────────────────────────────────

function RiskBadge({ score }: { score: number }) {
  const r = getRiskLabel(score);
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${r.bg}`}>
      {r.label}
    </span>
  );
}

// ── Claim Row ─────────────────────────────────────────────────────────────────

function ClaimRow({
  claim,
  selected,
  onClick,
}: {
  claim: Claim;
  selected: boolean;
  onClick: () => void;
}) {
  const riskScore = getRiskScore(claim);
  const isAdjChain = claim.chain_root_id !== claim.claim_id;
  const rowBg = claim.has_overpayment
    ? "bg-red-950/20"
    : claim.is_denied
    ? "bg-orange-950/10"
    : isAdjChain
    ? "bg-blue-950/10"
    : "";

  return (
    <tr
      className={`cursor-pointer border-b border-slate-800/40 transition-colors hover:bg-slate-800/30 ${rowBg} ${selected ? "ring-1 ring-inset ring-blue-500" : ""}`}
      onClick={onClick}
    >
      <td className="py-2 pr-3">
        <div className="flex flex-col">
          <span className="font-mono text-xs font-medium text-blue-300">{claim.claim_id}</span>
          {isAdjChain && (
            <span className="text-[10px] text-blue-500">↳ adj of {claim.chain_root_id}</span>
          )}
        </div>
      </td>
      <td className="py-2 pr-3 text-xs text-slate-300">{claim.claim_type}</td>
      <td className="py-2 pr-3">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[claim.claim_status] ?? "text-slate-400"}`}>
          {claim.claim_status}
        </span>
      </td>
      <td className="py-2 pr-3 text-xs text-slate-300">{fmtDate(claim.claim_from_date)}</td>
      <td className="py-2 pr-3 text-right text-xs font-semibold text-white">{fmt$(claim.payment_amount)}</td>
      <td className="py-2 pr-3 text-right text-xs font-semibold text-red-300">
        {claim.has_overpayment ? fmt$(claim.overpayment_amount) : "—"}
      </td>
      <td className="py-2 pr-3 text-xs" style={{ color: RISK_COLORS[claim.provider_risk_profile] }}>
        {claim.provider_risk_profile.replace(/_/g, " ")}
      </td>
      <td className="py-2 pr-3">
        <RiskBadge score={riskScore} />
      </td>
      <td className="py-2 text-xs text-slate-500">
        <div className="flex gap-1">
          {claim.has_overpayment && <span title="Overpayment" className="text-red-400">●</span>}
          {claim.is_denied && <span title="Denied" className="text-orange-400">●</span>}
          {isAdjChain && <span title="Adjustment" className="text-blue-400">●</span>}
          {["Suspicious", "Outlier"].includes(claim.provider_risk_profile) && <span title="Risky Provider" className="text-yellow-400">●</span>}
        </div>
      </td>
    </tr>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function ClaimDetail({
  claim,
  diagnoses,
  adjChain,
  loadingDetail,
}: {
  claim: Claim;
  diagnoses: Diagnosis[];
  adjChain: AdjChain[];
  loadingDetail: boolean;
}) {
  const riskScore = getRiskScore(claim);
  const risk = getRiskLabel(riskScore);
  const reasons = buildWhyRisky(claim, diagnoses);
  const isAdjChain = claim.chain_root_id !== claim.claim_id;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-sm font-bold text-blue-300">{claim.claim_id}</p>
          <p className="text-xs text-slate-400">{claim.provider_id} · {claim.claim_type}</p>
        </div>
        <div className="flex gap-2">
          <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[claim.claim_status] ?? ""}`}>
            {claim.claim_status}
          </span>
          <RiskBadge score={riskScore} />
        </div>
      </div>

      {/* Why Risky */}
      {reasons.length > 0 && (
        <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
            ⚠ Why This Claim Appears Risky
          </p>
          <ul className="space-y-1">
            {reasons.map((r, i) => (
              <li key={i} className="flex gap-1.5 text-[10px] leading-relaxed text-amber-100/80">
                <span className="mt-0.5 shrink-0 text-amber-500">›</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Payment Details */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Payment Details</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Payment Amount", value: fmt$(claim.payment_amount), warn: claim.payment_amount > 10000 },
            { label: "Overpayment", value: claim.has_overpayment ? fmt$(claim.overpayment_amount) : "None", warn: claim.has_overpayment },
            { label: "Service From", value: fmtDate(claim.claim_from_date) },
            { label: "Service Thru", value: fmtDate(claim.claim_thru_date) },
            { label: "Span Days", value: claim.claim_span_days?.toString() ?? "—" },
            { label: "Length of Stay", value: claim.length_of_stay ? `${claim.length_of_stay}d` : "—" },
            { label: "DRG Code", value: claim.drg_code ?? "—" },
            { label: "Denial Code", value: claim.denial_reason_code ?? "—", warn: !!claim.denial_reason_code },
          ].map((m) => (
            <div key={m.label} className="rounded bg-slate-800/50 p-2">
              <p className="text-[9px] text-slate-500">{m.label}</p>
              <p className={`text-xs font-semibold ${m.warn ? "text-orange-300" : "text-white"}`}>{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Provider */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Provider</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Provider ID", value: claim.provider_id },
            { label: "Type", value: claim.provider_type },
            { label: "Peer Group", value: claim.peer_group.replace(/_/g, " ") },
            { label: "Risk Profile", value: claim.provider_risk_profile.replace(/_/g, " "), warn: ["Suspicious", "Outlier"].includes(claim.provider_risk_profile) },
            { label: "Region", value: claim.provider_region },
          ].map((m) => (
            <div key={m.label} className="rounded bg-slate-800/50 p-2">
              <p className="text-[9px] text-slate-500">{m.label}</p>
              <p className={`text-xs font-semibold ${m.warn ? "text-orange-300" : "text-white"}`}>{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Patient */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Patient</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Patient ID", value: claim.patient_id },
            { label: "Age Bucket", value: claim.patient_age_bucket },
            { label: "Risk Score", value: claim.patient_risk_score?.toFixed(3) ?? "—", warn: claim.patient_risk_score > 2 },
            { label: "Chronic Conditions", value: claim.patient_chronic_count?.toString() ?? "—" },
            { label: "Cost Bucket", value: claim.patient_cost_bucket?.replace(/_/g, " ") ?? "—" },
            { label: "Dual Status", value: claim.patient_dual_status ?? "—" },
            { label: "Utilization", value: claim.patient_utilization_segment ?? "—" },
          ].map((m) => (
            <div key={m.label} className="rounded bg-slate-800/50 p-2">
              <p className="text-[9px] text-slate-500">{m.label}</p>
              <p className={`text-xs font-semibold ${m.warn ? "text-orange-300" : "text-white"}`}>{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Diagnoses */}
      {loadingDetail ? (
        <p className="text-xs text-slate-500">Loading diagnoses...</p>
      ) : diagnoses.length > 0 ? (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Diagnoses ({diagnoses.length})
          </p>
          <div className="space-y-1.5">
            {diagnoses
              .sort((a, b) => a.diagnosis_sequence - b.diagnosis_sequence)
              .map((dx) => (
                <div
                  key={dx.diagnosis_code + dx.diagnosis_sequence}
                  className={`rounded border p-2 text-[10px] ${
                    dx.is_suspected_unsupported
                      ? "border-red-700/50 bg-red-950/20"
                      : dx.is_hcc_mapped
                      ? "border-purple-700/50 bg-purple-950/20"
                      : dx.is_principal_dx
                      ? "border-blue-700/50 bg-blue-950/20"
                      : "border-slate-700/40 bg-slate-800/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-white">{dx.diagnosis_code}</span>
                    <div className="flex gap-1">
                      {dx.is_principal_dx && <span className="rounded bg-blue-900/60 px-1 text-[9px] text-blue-300">Principal</span>}
                      {dx.is_hcc_mapped && <span className="rounded bg-purple-900/60 px-1 text-[9px] text-purple-300">HCC {dx.hcc_weight != null ? `w=${dx.hcc_weight.toFixed(2)}` : ""}</span>}
                      {dx.is_chronic && <span className="rounded bg-yellow-900/60 px-1 text-[9px] text-yellow-300">Chronic</span>}
                      {dx.is_suspected_unsupported && <span className="rounded bg-red-900/60 px-1 text-[9px] text-red-300">⚠ Unsupported</span>}
                    </div>
                  </div>
                  <p className="mt-0.5 text-slate-400">{dx.diagnosis_description}</p>
                  <p className="mt-0.5 text-slate-500">{dx.body_system}{dx.present_on_admission ? ` · POA: ${dx.present_on_admission}` : ""}</p>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      {/* Adjustment Chain */}
      {(isAdjChain || adjChain.length > 1) && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Adjustment Chain ({adjChain.length} claims)
          </p>
          <div className="space-y-1.5">
            {adjChain.map((ac, i) => (
              <div
                key={ac.claim_id}
                className={`flex items-center justify-between rounded border p-2 text-[10px] ${
                  ac.claim_id === claim.claim_id
                    ? "border-blue-600/60 bg-blue-950/30"
                    : "border-slate-700/40 bg-slate-800/30"
                }`}
              >
                <div>
                  <span className="font-mono text-white">{ac.claim_id}</span>
                  <span className="ml-2 text-slate-500">{ADJ_TYPE_LABELS[ac.adjustment_type] ?? ac.adjustment_type}</span>
                  {ac.claim_id === claim.claim_id && <span className="ml-2 text-blue-400">← current</span>}
                </div>
                <div className="text-right">
                  <p className="font-semibold text-white">{fmt$(ac.payment_amount)}</p>
                  {ac.has_overpayment && <p className="text-red-300">OP: {fmt$(ac.overpayment_amount)}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClaimsExplorerPage() {
  const searchParams = useSearchParams();

  // State
  const [claims, setClaims] = useState<Claim[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // Filters
  const [providerFilter, setProviderFilter] = useState(searchParams.get("provider") ?? "");
  const [riskFilter, setRiskFilter] = useState(searchParams.get("risk") ?? "All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [claimTypeFilter, setClaimTypeFilter] = useState("All");
  const [overpaymentOnly, setOverpaymentOnly] = useState(false);
  const [deniedOnly, setDeniedOnly] = useState(false);
  const [adjOnly, setAdjOnly] = useState(false);
  const [suspiciousProviderOnly, setSuspiciousProviderOnly] = useState(
    searchParams.get("suspicious") === "true"
  );
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sortCol, setSortCol] = useState("payment_amount");
  const [sortDir, setSortDir] = useState<"DESC" | "ASC">("DESC");

  // Detail
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [adjChain, setAdjChain] = useState<AdjChain[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Build WHERE clause
  const whereClause = useMemo(() => {
    const parts: string[] = [];
    if (providerFilter) parts.push(`provider_id = '${providerFilter.toUpperCase()}'`);
    if (riskFilter !== "All") parts.push(`provider_risk_profile = '${riskFilter}'`);
    if (statusFilter !== "All") parts.push(`claim_status = '${statusFilter}'`);
    if (claimTypeFilter !== "All") parts.push(`claim_type = '${claimTypeFilter}'`);
    if (overpaymentOnly) parts.push(`has_overpayment = TRUE`);
    if (deniedOnly) parts.push(`is_denied = TRUE`);
    if (adjOnly) parts.push(`adjustment_type != '0'`);
    if (suspiciousProviderOnly) parts.push(`provider_risk_profile IN ('Suspicious', 'Outlier')`);
    if (minAmount) parts.push(`payment_amount >= ${parseFloat(minAmount)}`);
    if (maxAmount) parts.push(`payment_amount <= ${parseFloat(maxAmount)}`);
    return parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "";
  }, [providerFilter, riskFilter, statusFilter, claimTypeFilter, overpaymentOnly, deniedOnly, adjOnly, suspiciousProviderOnly, minAmount, maxAmount]);

  // Fetch claims
  const fetchClaims = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const offset = page * PAGE_SIZE;
      const [claimsRows, countRows] = await Promise.all([
        runQuery<Claim>(`
          SELECT claim_id, patient_id, provider_id, chain_root_id,
            claim_type, facility_type, claim_status, adjustment_type,
            is_paid, is_denied, claim_from_date, claim_thru_date,
            claim_span_days, payment_amount, denial_reason_code,
            drg_code, length_of_stay, has_overpayment, overpayment_amount,
            is_audit_eligible, is_true_error, provider_type, peer_group,
            provider_risk_profile, provider_region, provider_urban_rural,
            patient_age, patient_age_bucket, patient_sex, patient_race,
            patient_risk_score, patient_chronic_count, patient_cost_bucket,
            patient_dual_status, patient_utilization_segment
          FROM \`cms-extrapolation-v1.curated_cms_claims.fact_part_a_claims\`
          ${whereClause}
          ORDER BY ${sortCol} ${sortDir}
          LIMIT ${PAGE_SIZE} OFFSET ${offset}
        `),
        runQuery<{ cnt: number }>(`
          SELECT COUNT(*) AS cnt
          FROM \`cms-extrapolation-v1.curated_cms_claims.fact_part_a_claims\`
          ${whereClause}
        `),
      ]);
      setClaims(claimsRows);
      setTotalCount(countRows[0]?.cnt ?? 0);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [whereClause, page, sortCol, sortDir]);

  useEffect(() => { fetchClaims(); }, [fetchClaims]);

  // Load detail when claim selected
  useEffect(() => {
    if (!selectedClaim) return;
    setLoadingDetail(true);
    setDiagnoses([]);
    setAdjChain([]);
    Promise.all([
      runQuery<Diagnosis>(`
        SELECT * FROM \`cms-extrapolation-v1.curated_cms_claims.fact_diagnoses\`
        WHERE claim_id = '${selectedClaim.claim_id}'
        ORDER BY diagnosis_sequence
      `),
      runQuery<AdjChain>(`
        SELECT claim_id, claim_status, adjustment_type, payment_amount,
          overpayment_amount, has_overpayment, claim_from_date
        FROM \`cms-extrapolation-v1.curated_cms_claims.fact_part_a_claims\`
        WHERE chain_root_id = '${selectedClaim.chain_root_id}'
        ORDER BY claim_id
      `),
    ]).then(([dx, chain]) => {
      setDiagnoses(dx);
      setAdjChain(chain);
    }).finally(() => setLoadingDetail(false));
  }, [selectedClaim]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === "DESC" ? "ASC" : "DESC"));
    else { setSortCol(col); setSortDir("DESC"); }
    setPage(0);
  }

  function SortHeader({ col, label }: { col: string; label: string }) {
    const active = sortCol === col;
    return (
      <th
        className="cursor-pointer pb-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 hover:text-white"
        onClick={() => toggleSort(col)}
      >
        {label} {active ? (sortDir === "DESC" ? "↓" : "↑") : ""}
      </th>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      {/* Header */}
      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-400">
          CMS Post-Payment Analytics
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-white">Claims Explorer</h1>
        <p className="mt-1 text-sm text-slate-400">
          Investigative claim review · drill into billing behavior · audit evidence
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* ── Filters Panel ── */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-4">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Filters
            </h2>

            {/* Provider */}
            <div className="mb-4">
              <label className="mb-1 block text-[10px] font-semibold text-slate-400">Provider ID</label>
              <input
                type="text"
                value={providerFilter}
                onChange={(e) => { setProviderFilter(e.target.value.toUpperCase()); setPage(0); }}
                placeholder="e.g. PRV000579"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Risk Profile */}
            <div className="mb-4">
              <label className="mb-1 block text-[10px] font-semibold text-slate-400">Provider Risk Profile</label>
              <div className="flex flex-wrap gap-1">
                {["All", "Normal", "High_Volume", "Emerging", "Suspicious", "Outlier"].map((r) => (
                  <button
                    key={r}
                    onClick={() => { setRiskFilter(r); setPage(0); }}
                    className={`rounded border px-2 py-0.5 text-[10px] font-medium transition-all ${
                      riskFilter === r
                        ? "border-blue-500 bg-blue-500/10 text-blue-300"
                        : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {r.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>

            {/* Claim Status */}
            <div className="mb-4">
              <label className="mb-1 block text-[10px] font-semibold text-slate-400">Claim Status</label>
              <div className="flex flex-wrap gap-1">
                {["All", "Paid", "Denied", "Adjusted", "Cancelled"].map((s) => (
                  <button
                    key={s}
                    onClick={() => { setStatusFilter(s); setPage(0); }}
                    className={`rounded border px-2 py-0.5 text-[10px] font-medium transition-all ${
                      statusFilter === s
                        ? "border-blue-500 bg-blue-500/10 text-blue-300"
                        : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Claim Type */}
            <div className="mb-4">
              <label className="mb-1 block text-[10px] font-semibold text-slate-400">Claim Type</label>
              <div className="flex flex-wrap gap-1">
                {["All", "Inpatient", "Outpatient", "Home Health", "SNF", "Hospice"].map((t) => (
                  <button
                    key={t}
                    onClick={() => { setClaimTypeFilter(t); setPage(0); }}
                    className={`rounded border px-2 py-0.5 text-[10px] font-medium transition-all ${
                      claimTypeFilter === t
                        ? "border-blue-500 bg-blue-500/10 text-blue-300"
                        : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Flags */}
            <div className="mb-4">
              <label className="mb-2 block text-[10px] font-semibold text-slate-400">Quick Filters</label>
              <div className="space-y-2">
                {[
                  { label: "Overpayment only", state: overpaymentOnly, set: setOverpaymentOnly },
                  { label: "Denied claims only", state: deniedOnly, set: setDeniedOnly },
                  { label: "Adjustments / Cancellations", state: adjOnly, set: setAdjOnly },
                  { label: "Suspicious / Outlier providers", state: suspiciousProviderOnly, set: setSuspiciousProviderOnly },
                ].map((f) => (
                  <label key={f.label} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={f.state}
                      onChange={(e) => { f.set(e.target.checked); setPage(0); }}
                      className="rounded border-slate-600 bg-slate-800 text-blue-500"
                    />
                    <span className="text-[10px] text-slate-300">{f.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Amount Range */}
            <div className="mb-4">
              <label className="mb-1 block text-[10px] font-semibold text-slate-400">Payment Amount Range</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={minAmount}
                  onChange={(e) => { setMinAmount(e.target.value); setPage(0); }}
                  placeholder="Min $"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="number"
                  value={maxAmount}
                  onChange={(e) => { setMaxAmount(e.target.value); setPage(0); }}
                  placeholder="Max $"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Legend */}
            <div className="mt-4 rounded-lg border border-slate-700/40 bg-slate-800/30 p-3">
              <p className="mb-2 text-[10px] font-semibold text-slate-400">Row Highlights</p>
              <div className="space-y-1 text-[10px] text-slate-400">
                <div className="flex items-center gap-2"><span className="h-2 w-3 rounded bg-red-950/60" /> Overpayment detected</div>
                <div className="flex items-center gap-2"><span className="h-2 w-3 rounded bg-orange-950/40" /> Denied claim</div>
                <div className="flex items-center gap-2"><span className="h-2 w-3 rounded bg-blue-950/40" /> Adjustment chain</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Claims Table + Detail ── */}
        <div className="space-y-5 lg:col-span-3">
          {/* Results summary */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {loading ? "Loading..." : `${totalCount.toLocaleString()} claims matching filters · page ${page + 1} of ${totalPages || 1}`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
                className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:border-slate-500 disabled:opacity-30"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1 || loading}
                className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:border-slate-500 disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-xs text-red-300">{error}</div>
          )}

          {/* Table + Detail split */}
          <div className={`grid gap-5 ${selectedClaim ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}>
            {/* Table */}
            <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-4">
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <SortHeader col="claim_id" label="Claim ID" />
                        <th className="pb-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Type</th>
                        <th className="pb-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                        <SortHeader col="claim_from_date" label="Date" />
                        <SortHeader col="payment_amount" label="Payment" />
                        <SortHeader col="overpayment_amount" label="Overpmt" />
                        <th className="pb-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Risk Profile</th>
                        <th className="pb-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Audit Risk</th>
                        <th className="pb-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Signals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claims.map((c) => (
                        <ClaimRow
                          key={c.claim_id}
                          claim={c}
                          selected={selectedClaim?.claim_id === c.claim_id}
                          onClick={() => setSelectedClaim(selectedClaim?.claim_id === c.claim_id ? null : c)}
                        />
                      ))}
                    </tbody>
                  </table>
                  {claims.length === 0 && !loading && (
                    <p className="py-8 text-center text-xs text-slate-500">No claims match the current filters.</p>
                  )}
                </div>
              )}
            </div>

            {/* Detail Panel */}
            {selectedClaim && (
              <div className="rounded-xl border border-blue-700/40 bg-slate-900/80 p-4 xl:overflow-y-auto xl:max-h-[80vh]">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold text-blue-300">Claim Investigation</p>
                  <button
                    onClick={() => setSelectedClaim(null)}
                    className="text-xs text-slate-500 hover:text-white"
                  >
                    ✕ Close
                  </button>
                </div>
                <ClaimDetail
                  claim={selectedClaim}
                  diagnoses={diagnoses}
                  adjChain={adjChain}
                  loadingDetail={loadingDetail}
                />
              </div>
            )}
          </div>

          {/* Pagination footer */}
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Showing {Math.min(PAGE_SIZE, claims.length)} of {totalCount.toLocaleString()} claims</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(0)}
                disabled={page === 0}
                className="rounded border border-slate-700 px-2 py-1 hover:border-slate-500 disabled:opacity-30"
              >First</button>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded border border-slate-700 px-2 py-1 hover:border-slate-500 disabled:opacity-30"
              >‹</button>
              <span className="px-2 py-1">{page + 1} / {totalPages || 1}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded border border-slate-700 px-2 py-1 hover:border-slate-500 disabled:opacity-30"
              >›</button>
              <button
                onClick={() => setPage(totalPages - 1)}
                disabled={page >= totalPages - 1}
                className="rounded border border-slate-700 px-2 py-1 hover:border-slate-500 disabled:opacity-30"
              >Last</button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
