"use client";

import { useEffect, useState, useMemo } from "react";

interface ExtrapolationRow {
  sample_type: string;
  sample_size: number;
  sample_total_payment: number;
  sample_overpayment_found: number;
  sample_op_claims: number;
  sample_overpayment_rate: number;
  sample_op_claim_rate: number;
  extrapolated_overpayment: number;
  universe_true_overpayment: number;
  universe_total_payment: number;
  universe_claim_count: number;
  universe_true_op_rate: number;
  estimation_error_amt: number;
  estimation_error_pct: number;
  sample_coverage_rate: number;
}

const TRUE_UNIVERSE_OVERPAYMENT = 20_579_780.26;
const TRUE_UNIVERSE_PAYMENT = 1_162_995_601.09;
const TRUE_UNIVERSE_CLAIMS = 289_837;
const TRUE_OP_RATE = 0.017695;
const Z_SCORES: Record<string, number> = { "90": 1.645, "95": 1.96, "99": 2.576 };

const SAMPLE_TYPE_LABELS: Record<string, string> = {
  Random_Sample: "Random",
  Stratified_By_Type: "Stratified",
  Biased_High_Cost: "High-Cost Focused",
  Biased_Provider: "Provider-Focused",
};

const SAMPLE_TYPE_DESCRIPTIONS: Record<string, string> = {
  Random_Sample: "Claims selected uniformly at random from the audit-eligible population. Produces an unbiased estimate but has higher variance at smaller sample sizes.",
  Stratified_By_Type: "Claims sampled proportionally within claim type strata. Reduces variance and improves representativeness by ensuring each claim category is proportionally covered.",
  Biased_High_Cost: "Sample skewed toward high-payment claims. Overrepresents expensive outliers — can distort projected overpayment rate relative to the full population.",
  Biased_Provider: "Sample drawn from a concentrated subset of flagged providers. Introduces systematic selection bias — projections may not reflect the broader provider population.",
};

const SAMPLE_TYPE_AUDIT_CONTEXT: Record<string, string> = {
  Random_Sample: "Common in OIG audit protocols. Statistically defensible but may require larger sample sizes at low overpayment rates.",
  Stratified_By_Type: "Preferred approach for Medicare post-payment audits. Proportional stratification reduces extrapolation error and supports legally defensible recovery demand letters.",
  Biased_High_Cost: "Used to maximize dollars reviewed per claim. Risk: overstates true population overpayment rate and may not withstand provider appeal.",
  Biased_Provider: "Useful for focused provider investigations. Extrapolation to the full population is statistically inappropriate without population-level adjustment.",
};

const SAMPLE_PCT_OPTIONS = [0.5, 1, 2, 5];

function fmt$(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(n)) return "—";
  return `${(n * 100).toFixed(decimals)}%`;
}
function fmtNum(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString();
}

function computeCI(sampleOpRate: number, sampleSize: number, universeTotal: number, zScore: number) {
  const p = sampleOpRate;
  const se = Math.sqrt((p * (1 - p)) / sampleSize);
  const lower = Math.max(0, (p - zScore * se) * universeTotal);
  const upper = (p + zScore * se) * universeTotal;
  return { lower, upper, width: upper - lower };
}

function getBiasDirection(errorAmt: number): "over" | "under" | "neutral" {
  if (errorAmt > 500_000) return "over";
  if (errorAmt < -500_000) return "under";
  return "neutral";
}

function getInterpretation(row: ExtrapolationRow, confidenceLevel: string, ci: { lower: number; upper: number; width: number }): string {
  const errorPct = Math.abs(row.estimation_error_pct * 100);
  const bias = getBiasDirection(row.estimation_error_amt);
  let core = "";
  if (row.sample_type === "Biased_High_Cost") {
    core = bias === "over"
      ? `The High-Cost Focused sample overestimates projected recovery by ${errorPct.toFixed(1)}%. By concentrating on high-payment claims, this method captures an overpayment rate higher than the true population average — inflating the recovery projection. While this maximizes dollars reviewed per claim, it may not withstand provider appeal if the methodology is challenged.`
      : `The High-Cost Focused sample underestimates projected recovery by ${errorPct.toFixed(1)}%, suggesting that within the highest-cost claims, the overpayment rate is lower than the broader population average.`;
  } else if (row.sample_type === "Biased_Provider") {
    core = `The Provider-Focused sample ${bias === "over" ? "overestimates" : "underestimates"} projected recovery by ${errorPct.toFixed(1)}%. This method concentrates claims from flagged providers — introducing systematic selection bias. Even if those providers have elevated risk profiles, their overpayment rates may not represent the full audit-eligible population, making extrapolation to the universe statistically inappropriate without adjustment.`;
  } else if (row.sample_type === "Stratified_By_Type") {
    core = `Stratified sampling achieves a ${errorPct.toFixed(1)}% projection bias — the most accurate method in this simulation. By ensuring proportional representation across claim types, stratification captures the true population overpayment rate more faithfully than any other approach. This is the preferred methodology for legally defensible Medicare post-payment audit demand letters.`;
  } else {
    core = `Random sampling produces a ${errorPct.toFixed(1)}% projection bias at this coverage level. As an unbiased estimator, variance is driven by sample size rather than systematic selection error — increasing coverage reduces uncertainty without introducing structural bias. At ${fmtPct(row.sample_coverage_rate)} coverage, the recovery projection deviates by approximately ${fmt$(Math.abs(row.estimation_error_amt))} from the true population overpayment.`;
  }
  return `${core} At ${confidenceLevel}% statistical confidence, the true population overpayment falls between ${fmt$(ci.lower)} and ${fmt$(ci.upper)} — a recovery uncertainty range of ${fmt$(ci.width)}, representing ${fmtPct(ci.width / TRUE_UNIVERSE_OVERPAYMENT)} of the true overpayment amount.`;
}

function CIBar({ estimate, lower, upper, truth }: { estimate: number; lower: number; upper: number; truth: number }) {
  const max = Math.max(upper, truth) * 1.18;
  const toP = (v: number) => `${Math.max(0, Math.min((v / max) * 100, 97)).toFixed(1)}%`;
  return (
    <div className="relative mt-6 h-24 w-full">
      <div className="absolute inset-x-0 top-9 h-3 rounded-full bg-slate-800" />
      <div className="absolute top-9 h-3 rounded-full bg-blue-500/25" style={{ left: toP(lower), width: `calc(${toP(upper)} - ${toP(lower)})` }} />
      <div className="absolute top-7 flex flex-col items-center" style={{ left: toP(estimate), transform: "translateX(-50%)" }}>
        <span className="mb-0.5 text-[10px] font-semibold text-blue-400">{fmt$(estimate)}</span>
        <div className="h-7 w-0.5 bg-blue-400" />
      </div>
      <div className="absolute top-7 flex flex-col items-center" style={{ left: toP(truth), transform: "translateX(-50%)" }}>
        <span className="mb-0.5 text-[10px] font-semibold text-emerald-400">{fmt$(truth)}</span>
        <div className="h-7 w-0.5 bg-emerald-400" />
      </div>
      <div className="absolute top-[58px] text-[9px] text-slate-500" style={{ left: toP(lower), transform: "translateX(-50%)" }}>{fmt$(lower)}</div>
      <div className="absolute top-[58px] text-[9px] text-slate-500" style={{ left: toP(upper), transform: "translateX(-50%)" }}>{fmt$(upper)}</div>
      <div className="absolute bottom-0 left-0 flex gap-4 text-[10px] text-slate-400">
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 rounded bg-blue-400" />Projected recovery</span>
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 rounded bg-blue-500/30" />Uncertainty range</span>
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 rounded bg-emerald-400" />True population OP</span>
      </div>
    </div>
  );
}

function ComparisonBar({ label, value, max, color, sub }: { label: string; value: number; max: number; color: string; sub?: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-slate-300">{label}</span>
        <span className="text-xs font-semibold text-white">{fmt$(value)}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-800">
        <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${Math.min((value / max) * 100, 100)}%`, background: color }} />
      </div>
      {sub && <p className="mt-0.5 text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}

export default function ExtrapolationSimulatorPage() {
  const [rows, setRows] = useState<ExtrapolationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState("Random_Sample");
  const [samplePct, setSamplePct] = useState(2);
  const [confidenceLevel, setConfidenceLevel] = useState("95");

  useEffect(() => {
    fetch("/api/bigquery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT * FROM `cms-extrapolation-v1.analytics_cms_claims.extrapolation_results` ORDER BY sample_type" }),
    })
      .then((r) => r.json())
      .then((j) => setRows(j.data as ExtrapolationRow[]))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const selectedRow = useMemo(() => rows.find((r) => r.sample_type === selectedType) ?? null, [rows, selectedType]);
  const randomRow = useMemo(() => rows.find((r) => r.sample_type === "Random_Sample") ?? null, [rows]);

  const scaledEstimate = useMemo(() => {
    if (!selectedRow) return null;
    const scaleFactor = samplePct / (selectedRow.sample_coverage_rate * 100);
    return selectedRow.extrapolated_overpayment * (1 + (scaleFactor - 1) * 0.05);
  }, [selectedRow, samplePct]);

  const ci = useMemo(() => {
    if (!selectedRow) return null;
    const z = Z_SCORES[confidenceLevel] ?? 1.96;
    return computeCI(selectedRow.sample_overpayment_rate, Math.round(TRUE_UNIVERSE_CLAIMS * (samplePct / 100)), TRUE_UNIVERSE_PAYMENT, z);
  }, [selectedRow, samplePct, confidenceLevel]);

  const interpretation = useMemo(() => {
    if (!selectedRow || !ci) return null;
    return getInterpretation(selectedRow, confidenceLevel, ci);
  }, [selectedRow, ci, confidenceLevel]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading audit simulation...</p>
        </div>
      </div>
    );
  }
  if (error || !selectedRow) {
    return <div className="flex h-screen items-center justify-center bg-slate-950"><p className="text-sm text-red-400">{error ?? "No data"}</p></div>;
  }

  const biasDir = getBiasDirection(selectedRow.estimation_error_amt);
  const maxComparison = Math.max(selectedRow.extrapolated_overpayment, randomRow?.extrapolated_overpayment ?? 0, TRUE_UNIVERSE_OVERPAYMENT) * 1.1;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">

      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-400">CMS Post-Payment Analytics</p>
        <h1 className="text-3xl font-bold tracking-tight text-white">Extrapolation Simulator</h1>
        <p className="mt-1 text-sm text-slate-400">Audit sample strategy · projected recovery exposure · statistical confidence</p>
      </div>

      <div className="mb-8 rounded-xl border border-slate-700/40 bg-slate-900/50 px-4 py-3">
        <p className="text-xs leading-relaxed text-slate-400">
          <span className="font-semibold text-slate-300">How this works:</span> Medicare post-payment audits extrapolate overpayment findings from a reviewed sample to the full audit-eligible universe. The sampling method chosen has a direct and measurable impact on projected recovery accuracy, confidence interval width, and the legal defensibility of recovery demand letters.{" "}
          <span className="text-slate-500">All estimates are calculated against the audit-eligible universe of {fmtNum(TRUE_UNIVERSE_CLAIMS)} claims totaling {fmt$(TRUE_UNIVERSE_PAYMENT)}. True population overpayment: {fmt$(TRUE_UNIVERSE_OVERPAYMENT)} ({fmtPct(TRUE_OP_RATE)}).</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">

        {/* Controls */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">Audit Sample Configuration</h2>

            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold text-slate-300">Sampling Method</label>
              <div className="flex flex-col gap-2">
                {Object.entries(SAMPLE_TYPE_LABELS).map(([key, label]) => (
                  <button key={key} onClick={() => setSelectedType(key)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-all ${selectedType === key ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600 hover:text-slate-200"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-3 rounded-lg border border-slate-700/40 bg-slate-800/30 p-2">
                <p className="mb-1 text-[10px] leading-relaxed text-slate-300">{SAMPLE_TYPE_DESCRIPTIONS[selectedType]}</p>
                <p className="text-[10px] leading-relaxed text-slate-500 italic">{SAMPLE_TYPE_AUDIT_CONTEXT[selectedType]}</p>
              </div>
            </div>

            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold text-slate-300">Sample Coverage</label>
              <div className="grid grid-cols-4 gap-1">
                {SAMPLE_PCT_OPTIONS.map((pct) => (
                  <button key={pct} onClick={() => setSamplePct(pct)}
                    className={`rounded-lg border py-2 text-xs font-semibold transition-all ${samplePct === pct ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"}`}>
                    {pct}%
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500">≈ {fmtNum(Math.round(TRUE_UNIVERSE_CLAIMS * (samplePct / 100)))} claims reviewed</p>
              <p className="mt-1 text-[10px] text-slate-600">Higher coverage reduces uncertainty range but increases audit cost. Most CMS post-payment audits target 1–5% coverage.</p>
            </div>

            <div className="mb-2">
              <label className="mb-2 block text-xs font-semibold text-slate-300">Statistical Confidence</label>
              <div className="grid grid-cols-3 gap-1">
                {["90", "95", "99"].map((cl) => (
                  <button key={cl} onClick={() => setConfidenceLevel(cl)}
                    className={`rounded-lg border py-2 text-xs font-semibold transition-all ${confidenceLevel === cl ? "border-purple-500 bg-purple-500/10 text-purple-300" : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"}`}>
                    {cl}%
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-600">95% is the CMS standard for post-payment audit recovery demands. Higher confidence widens the uncertainty range but strengthens legal defensibility.</p>
            </div>

            <div className="mt-5 rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">True Population Overpayment</p>
              <p className="text-lg font-bold text-emerald-300">{fmt$(TRUE_UNIVERSE_OVERPAYMENT)}</p>
              <p className="text-[10px] text-emerald-600">{fmtPct(TRUE_OP_RATE)} rate · {fmtNum(TRUE_UNIVERSE_CLAIMS)} audit-eligible claims</p>
              <p className="mt-1 text-[10px] text-emerald-700">Ground truth available in simulation — not available in real audits.</p>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-5 lg:col-span-3">

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: "Projected Recoverable Overpayment", value: fmt$(scaledEstimate), accent: "#3b82f6", sub: "Extrapolated to full audit universe" },
              { label: "Projection Bias", value: `${selectedRow.estimation_error_amt > 0 ? "+" : ""}${fmtPct(selectedRow.estimation_error_pct)}`, accent: Math.abs(selectedRow.estimation_error_pct) < 0.03 ? "#22c55e" : Math.abs(selectedRow.estimation_error_pct) < 0.07 ? "#eab308" : "#ef4444", sub: `${biasDir === "over" ? "Overestimates" : biasDir === "under" ? "Underestimates" : "Near-unbiased"} true OP by ${fmt$(Math.abs(selectedRow.estimation_error_amt))}` },
              { label: "Recovery Uncertainty Range", value: ci ? fmt$(ci.width) : "—", accent: "#a855f7", sub: `At ${confidenceLevel}% statistical confidence` },
              { label: "Claims Reviewed", value: fmtPct(selectedRow.sample_coverage_rate), accent: "#06b6d4", sub: `${fmtNum(selectedRow.sample_size)} of ${fmtNum(TRUE_UNIVERSE_CLAIMS)} claims` },
            ].map((k) => (
              <div key={k.label} className="relative overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/80 p-4">
                <div className="absolute inset-x-0 top-0 h-px" style={{ background: k.accent }} />
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{k.label}</p>
                <p className="text-2xl font-bold text-white">{k.value}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">{k.sub}</p>
              </div>
            ))}
          </div>

          {/* CI Visualization */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Recovery Projection &amp; Uncertainty Range</h2>
            <p className="mb-1 text-xs text-slate-500">{confidenceLevel}% confidence · {SAMPLE_TYPE_LABELS[selectedType]} sampling · {samplePct}% coverage</p>
            <p className="mb-4 rounded-lg bg-slate-800/40 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
              The shaded region represents the interval within which the true population overpayment is expected to fall at {confidenceLevel}% confidence. A wider range indicates less precision — typically caused by smaller sample size or higher variance in the sampled overpayment rate. In a real audit, the recovery demand letter would cite the lower bound of this interval as the minimum defensible recovery amount.
            </p>
            {ci && scaledEstimate && <CIBar estimate={scaledEstimate} lower={ci.lower} upper={ci.upper} truth={TRUE_UNIVERSE_OVERPAYMENT} />}
          </div>

          {/* Interpretation */}
          <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-base">🔍</span>
              <h2 className="text-sm font-semibold text-amber-300">Audit Analytical Interpretation</h2>
            </div>
            <p className="text-sm leading-relaxed text-amber-100/80">{interpretation}</p>
          </div>

          {/* Comparison + Metrics */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
              <h2 className="mb-1 text-sm font-semibold text-white">Recovery Projection Comparison</h2>
              <p className="mb-4 text-xs text-slate-500">Selected method vs random baseline and true population overpayment</p>
              <ComparisonBar label={SAMPLE_TYPE_LABELS[selectedType]} value={selectedRow.extrapolated_overpayment} max={maxComparison} color="#3b82f6" sub="Selected sampling method" />
              {selectedType !== "Random_Sample" && randomRow && (
                <ComparisonBar label="Random Baseline" value={randomRow.extrapolated_overpayment} max={maxComparison} color="#64748b" sub="Unbiased reference point" />
              )}
              <ComparisonBar label="True Population Overpayment" value={TRUE_UNIVERSE_OVERPAYMENT} max={maxComparison} color="#22c55e" sub="Ground truth (simulation only)" />
            </div>

            <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
              <h2 className="mb-3 text-sm font-semibold text-white">Bias &amp; Precision Metrics</h2>
              <div className="space-y-3">
                {[
                  { label: "Absolute Projection Bias", value: fmt$(Math.abs(selectedRow.estimation_error_amt)), sub: biasDir === "over" ? "Recovery overestimated" : biasDir === "under" ? "Recovery underestimated" : "Near-unbiased" },
                  { label: "Relative Projection Bias", value: fmtPct(selectedRow.estimation_error_pct), sub: "vs true population overpayment" },
                  { label: "Sample Overpayment Rate", value: fmtPct(selectedRow.sample_overpayment_rate), sub: `Population rate: ${fmtPct(TRUE_OP_RATE)}` },
                  { label: "Lower Recovery Bound", value: ci ? fmt$(ci.lower) : "—", sub: `${confidenceLevel}% confidence lower limit` },
                  { label: "Upper Recovery Bound", value: ci ? fmt$(ci.upper) : "—", sub: `${confidenceLevel}% confidence upper limit` },
                  { label: "Recovery Uncertainty Range", value: ci ? fmt$(ci.width) : "—", sub: ci ? `${fmtPct(ci.width / TRUE_UNIVERSE_OVERPAYMENT)} of true population OP` : "" },
                ].map((m) => (
                  <div key={m.label} className="flex items-start justify-between border-b border-slate-800/60 pb-2">
                    <div>
                      <p className="text-xs font-medium text-slate-300">{m.label}</p>
                      {m.sub && <p className="text-[10px] text-slate-500">{m.sub}</p>}
                    </div>
                    <p className="text-sm font-semibold text-white">{m.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sample Composition */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">Audit Sample Composition</h2>
            <p className="mb-4 text-xs text-slate-500">What this sample captures — and why projections differ from the true population</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
              {[
                { label: "Claims Reviewed", value: fmtNum(selectedRow.sample_size), sub: `${fmtPct(selectedRow.sample_coverage_rate)} of audit universe` },
                { label: "Overpayment Claims Found", value: fmtNum(selectedRow.sample_op_claims), sub: `${fmtPct(selectedRow.sample_op_claim_rate)} claim-level OP rate` },
                { label: "Total Payment in Sample", value: fmt$(selectedRow.sample_total_payment), sub: `${fmtPct(selectedRow.sample_total_payment / TRUE_UNIVERSE_PAYMENT)} of universe payments` },
                { label: "Overpayment Found in Sample", value: fmt$(selectedRow.sample_overpayment_found), sub: `Extrapolated to ${fmt$(selectedRow.extrapolated_overpayment)}` },
              ].map((c) => (
                <div key={c.label}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</p>
                  <p className="mt-0.5 text-lg font-bold text-white">{c.value}</p>
                  <p className="text-[10px] text-slate-500">{c.sub}</p>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <h3 className="mb-1 text-xs font-semibold text-slate-400">Sampling Method Comparison</h3>
              <p className="mb-3 text-[10px] text-slate-500">All four methods applied to the same audit-eligible universe. Click a row to switch the active simulation.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700">
                      {["Method", "Claims Reviewed", "Projected Recovery", "Projection Bias", "OP Rate in Sample"].map((h) => (
                        <th key={h} className="pb-2 pr-6 text-left font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.sample_type} className={`cursor-pointer border-b border-slate-800/40 transition-colors hover:bg-slate-800/40 ${r.sample_type === selectedType ? "bg-blue-950/30" : ""}`} onClick={() => setSelectedType(r.sample_type)}>
                        <td className="py-2 pr-6 font-medium text-white">
                          {SAMPLE_TYPE_LABELS[r.sample_type]}
                          {r.sample_type === selectedType && <span className="ml-2 rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-300">active</span>}
                        </td>
                        <td className="py-2 pr-6 text-slate-300">{fmtNum(r.sample_size)}</td>
                        <td className="py-2 pr-6 text-slate-200">{fmt$(r.extrapolated_overpayment)}</td>
                        <td className={`py-2 pr-6 font-semibold ${Math.abs(r.estimation_error_pct) < 0.03 ? "text-green-400" : Math.abs(r.estimation_error_pct) < 0.07 ? "text-yellow-400" : "text-red-400"}`}>
                          {r.estimation_error_amt > 0 ? "+" : ""}{fmtPct(r.estimation_error_pct)}
                        </td>
                        <td className="py-2 pr-6 text-slate-300">{fmtPct(r.sample_overpayment_rate)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-emerald-800/40 bg-emerald-950/20">
                      <td className="py-2 pr-6 font-semibold text-emerald-300">True Population</td>
                      <td className="py-2 pr-6 text-emerald-400">{fmtNum(TRUE_UNIVERSE_CLAIMS)}</td>
                      <td className="py-2 pr-6 text-emerald-400">{fmt$(TRUE_UNIVERSE_OVERPAYMENT)}</td>
                      <td className="py-2 pr-6 text-emerald-400">0.00%</td>
                      <td className="py-2 pr-6 text-emerald-400">{fmtPct(TRUE_OP_RATE)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Key Findings */}
          <div className="rounded-xl border border-blue-700/30 bg-blue-950/20 p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-400">Key Findings — Sampling Strategy</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                "Stratified sampling achieves a 2.0% projection bias — the most accurate and legally defensible method in this simulation. Proportional stratification by claim type is the preferred approach for CMS post-payment audit recovery demand letters.",
                "Provider-focused sampling underestimates recovery by 5.5%, even when targeting flagged providers. Concentrated selection biases the overpayment rate toward the selected group rather than the full audit-eligible population.",
                "Random sampling overestimates recovery by 10.1% at 2% coverage — a common result at low sample sizes due to variance in small-sample overpayment rates. Larger samples reduce this variance significantly.",
                "Increasing coverage from 1% to 5% reduces the recovery uncertainty range by approximately 55% — significantly strengthening the statistical precision of the audit demand and reducing provider appeal risk.",
              ].map((f, i) => (
                <div key={i} className="rounded-lg border border-blue-700/20 bg-blue-950/30 p-3">
                  <p className="text-[11px] leading-relaxed text-blue-100/80">{f}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
