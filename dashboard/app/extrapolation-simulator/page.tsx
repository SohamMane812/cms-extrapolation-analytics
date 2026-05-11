"use client";

import { useEffect, useState, useMemo } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

const TRUE_UNIVERSE_OVERPAYMENT = 20_579_780.26;
const TRUE_UNIVERSE_PAYMENT = 1_162_995_601.09;
const TRUE_UNIVERSE_CLAIMS = 289_837;
const TRUE_OP_RATE = 0.017695;

const Z_SCORES: Record<string, number> = { "90": 1.645, "95": 1.96, "99": 2.576 };

const SAMPLE_TYPE_LABELS: Record<string, string> = {
  Random_Sample: "Random",
  Stratified_By_Type: "Stratified",
  Biased_High_Cost: "High-Cost Biased",
  Biased_Provider: "Provider-Focused",
};

const SAMPLE_TYPE_DESCRIPTIONS: Record<string, string> = {
  Random_Sample: "Claims selected uniformly at random from the universe. Unbiased but high variance at small sizes.",
  Stratified_By_Type: "Claims sampled proportionally within claim type strata. Reduces variance and improves representativeness.",
  Biased_High_Cost: "Sample skewed toward high-payment claims. Overrepresents expensive outliers.",
  Biased_Provider: "Sample drawn from a subset of flagged providers. Introduces systematic selection bias.",
};

const SAMPLE_PCT_OPTIONS = [0.5, 1, 2, 5];

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Compute confidence interval using ratio estimator approximation
function computeCI(
  sampleOpRate: number,
  sampleSize: number,
  universeTotal: number,
  zScore: number
): { lower: number; upper: number; width: number } {
  const p = sampleOpRate;
  const se = Math.sqrt((p * (1 - p)) / sampleSize);
  const marginRate = zScore * se;
  const lower = Math.max(0, (p - marginRate) * universeTotal);
  const upper = (p + marginRate) * universeTotal;
  return { lower, upper, width: upper - lower };
}

// Generate interpretation text
function getInterpretation(
  row: ExtrapolationRow,
  confidenceLevel: string,
  ci: { lower: number; upper: number; width: number }
): string {
  const errorPct = Math.abs(row.estimation_error_pct * 100);
  const isOverestimate = row.estimation_error_amt > 0;
  const sampleLabel = SAMPLE_TYPE_LABELS[row.sample_type] ?? row.sample_type;

  let bias = "";
  if (row.sample_type === "Biased_High_Cost") {
    bias = isOverestimate
      ? `The high-cost biased sample overestimates true overpayment by ${errorPct.toFixed(1)}%. High-payment claims are overrepresented, inflating the projected overpayment rate beyond what the full universe reflects.`
      : `The high-cost biased sample underestimates true overpayment by ${errorPct.toFixed(1)}%. Despite targeting expensive claims, the overpayment rate within that stratum is actually lower than the universe average.`;
  } else if (row.sample_type === "Biased_Provider") {
    bias = `This provider-focused sample ${isOverestimate ? "overestimates" : "underestimates"} true overpayment by ${errorPct.toFixed(1)}%. The selected providers have ${isOverestimate ? "higher" : "high payment volume but only moderately elevated"} overpayment rates compared to the full universe, causing systematic ${isOverestimate ? "upward" : "downward"} bias in the extrapolation.`;
  } else if (row.sample_type === "Stratified_By_Type") {
    bias = `Stratified sampling achieves ${errorPct.toFixed(1)}% error — the best performer among all strategies. By ensuring proportional representation across claim types, it captures the universe overpayment rate more accurately than random selection.`;
  } else {
    bias = `Random sampling produces a ${errorPct.toFixed(1)}% error at this sample size. As an unbiased estimator, error is driven purely by sampling variance — reducing error requires a larger sample, not a different strategy.`;
  }

  const ciNote = `At ${confidenceLevel}% confidence, the true universe overpayment falls between ${fmt$(ci.lower)} and ${fmt$(ci.upper)} — a CI width of ${fmt$(ci.width)}, representing ${fmtPct(ci.width / TRUE_UNIVERSE_OVERPAYMENT)} of the true overpayment amount.`;

  return `${bias} ${ciNote}`;
}

// ── CI Bar Visual ─────────────────────────────────────────────────────────────

function CIBar({
  estimate,
  lower,
  upper,
  truth,
}: {
  estimate: number;
  lower: number;
  upper: number;
  truth: number;
}) {
  const max = Math.max(upper, truth) * 1.15;
  const toP = (v: number) => `${((v / max) * 100).toFixed(1)}%`;

  return (
    <div className="relative mt-4 h-20 w-full">
      {/* Track */}
      <div className="absolute inset-x-0 top-8 h-3 rounded-full bg-slate-800" />

      {/* CI range */}
      <div
        className="absolute top-8 h-3 rounded-full bg-blue-500/30"
        style={{ left: toP(lower), width: `calc(${toP(upper)} - ${toP(lower)})` }}
      />

      {/* Estimate marker */}
      <div
        className="absolute top-6 flex flex-col items-center"
        style={{ left: toP(estimate), transform: "translateX(-50%)" }}
      >
        <span className="mb-0.5 text-[10px] font-semibold text-blue-400">
          {fmt$(estimate)}
        </span>
        <div className="h-7 w-0.5 bg-blue-400" />
      </div>

      {/* True value marker */}
      <div
        className="absolute top-6 flex flex-col items-center"
        style={{ left: toP(truth), transform: "translateX(-50%)" }}
      >
        <span className="mb-0.5 text-[10px] font-semibold text-emerald-400">
          {fmt$(truth)}
        </span>
        <div className="h-7 w-0.5 bg-emerald-400" />
      </div>

      {/* CI bound labels */}
      <div
        className="absolute top-13 text-[10px] text-slate-500"
        style={{ left: toP(lower), transform: "translateX(-50%)" }}
      >
        {fmt$(lower)}
      </div>
      <div
        className="absolute top-13 text-[10px] text-slate-500"
        style={{ left: toP(upper), transform: "translateX(-50%)" }}
      >
        {fmt$(upper)}
      </div>

      {/* Legend */}
      <div className="absolute bottom-0 left-0 flex gap-4 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded bg-blue-400" /> Estimate
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded bg-blue-500/40" /> {`CI Range`}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded bg-emerald-400" /> True Value
        </span>
      </div>
    </div>
  );
}

// ── Comparison Bar ────────────────────────────────────────────────────────────

function ComparisonBar({
  label,
  value,
  max,
  color,
  sub,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  sub?: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-slate-300">{label}</span>
        <span className="text-xs font-semibold text-white">{fmt$(value)}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-800">
        <div
          className="h-2 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      {sub && <p className="mt-0.5 text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ExtrapolationSimulatorPage() {
  const [rows, setRows] = useState<ExtrapolationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Controls
  const [selectedType, setSelectedType] = useState("Random_Sample");
  const [samplePct, setSamplePct] = useState(2);
  const [confidenceLevel, setConfidenceLevel] = useState("95");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/bigquery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sql: "SELECT * FROM `cms-extrapolation-v1.analytics_cms_claims.extrapolation_results` ORDER BY sample_type",
          }),
        });
        const json = await res.json();
        setRows(json.data as ExtrapolationRow[]);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Selected row
  const selectedRow = useMemo(
    () => rows.find((r) => r.sample_type === selectedType) ?? null,
    [rows, selectedType]
  );

  // Random baseline for comparison
  const randomRow = useMemo(
    () => rows.find((r) => r.sample_type === "Random_Sample") ?? null,
    [rows]
  );

  // Scale estimate by sample % (linear approximation from precomputed rate)
  const scaledEstimate = useMemo(() => {
    if (!selectedRow) return null;
    const scaleFactor = samplePct / (selectedRow.sample_coverage_rate * 100);
    // Dampen scaling — more sample % reduces variance, not changes rate
    const dampened = 1 + (scaleFactor - 1) * 0.05;
    return selectedRow.extrapolated_overpayment * dampened;
  }, [selectedRow, samplePct]);

  // CI computation
  const ci = useMemo(() => {
    if (!selectedRow || !scaledEstimate) return null;
    const z = Z_SCORES[confidenceLevel] ?? 1.96;
    // Adjust sample size proportionally
    const adjustedSampleSize = Math.round(
      TRUE_UNIVERSE_CLAIMS * (samplePct / 100)
    );
    return computeCI(
      selectedRow.sample_overpayment_rate,
      adjustedSampleSize,
      TRUE_UNIVERSE_PAYMENT,
      z
    );
  }, [selectedRow, scaledEstimate, samplePct, confidenceLevel]);

  // Interpretation text
  const interpretation = useMemo(() => {
    if (!selectedRow || !ci) return null;
    return getInterpretation(selectedRow, confidenceLevel, ci);
  }, [selectedRow, ci, confidenceLevel]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading simulator...</p>
        </div>
      </div>
    );
  }

  if (error || !selectedRow) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <p className="text-sm text-red-400">{error ?? "No data available"}</p>
      </div>
    );
  }

  const errorSign = selectedRow.estimation_error_amt > 0 ? "+" : "";
  const maxComparison = Math.max(
    selectedRow.extrapolated_overpayment,
    randomRow?.extrapolated_overpayment ?? 0,
    TRUE_UNIVERSE_OVERPAYMENT
  ) * 1.1;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      {/* Header */}
      <div className="mb-8">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-400">
          CMS Post-Payment Analytics
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Extrapolation Simulator
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Explore how audit sample strategy affects projected overpayment exposure and confidence
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* ── Controls Panel ── */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">
              Simulation Controls
            </h2>

            {/* Sample Type */}
            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold text-slate-300">
                Sample Strategy
              </label>
              <div className="flex flex-col gap-2">
                {Object.entries(SAMPLE_TYPE_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedType(key)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-all ${
                      selectedType === key
                        ? "border-blue-500 bg-blue-500/10 text-blue-300"
                        : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                {SAMPLE_TYPE_DESCRIPTIONS[selectedType]}
              </p>
            </div>

            {/* Sample Size */}
            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold text-slate-300">
                Sample Size
              </label>
              <div className="grid grid-cols-4 gap-1">
                {SAMPLE_PCT_OPTIONS.map((pct) => (
                  <button
                    key={pct}
                    onClick={() => setSamplePct(pct)}
                    className={`rounded-lg border py-2 text-xs font-semibold transition-all ${
                      samplePct === pct
                        ? "border-blue-500 bg-blue-500/10 text-blue-300"
                        : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500">
                ≈ {fmtNum(Math.round(TRUE_UNIVERSE_CLAIMS * (samplePct / 100)))} claims
              </p>
            </div>

            {/* Confidence Level */}
            <div className="mb-2">
              <label className="mb-2 block text-xs font-semibold text-slate-300">
                Confidence Level
              </label>
              <div className="grid grid-cols-3 gap-1">
                {["90", "95", "99"].map((cl) => (
                  <button
                    key={cl}
                    onClick={() => setConfidenceLevel(cl)}
                    className={`rounded-lg border py-2 text-xs font-semibold transition-all ${
                      confidenceLevel === cl
                        ? "border-purple-500 bg-purple-500/10 text-purple-300"
                        : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {cl}%
                  </button>
                ))}
              </div>
            </div>

            {/* True Benchmark */}
            <div className="mt-5 rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                True Universe Benchmark
              </p>
              <p className="text-lg font-bold text-emerald-300">
                {fmt$(TRUE_UNIVERSE_OVERPAYMENT)}
              </p>
              <p className="text-[10px] text-emerald-600">
                {fmtPct(TRUE_OP_RATE)} overpayment rate ·{" "}
                {fmtNum(TRUE_UNIVERSE_CLAIMS)} claims
              </p>
            </div>
          </div>
        </div>

        {/* ── Main Results ── */}
        <div className="space-y-5 lg:col-span-3">
          {/* KPI Row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              {
                label: "Estimated Overpayment",
                value: fmt$(scaledEstimate),
                accent: "#3b82f6",
                sub: "Extrapolated to universe",
              },
              {
                label: "Estimation Error",
                value: `${errorSign}${fmtPct(selectedRow.estimation_error_pct)}`,
                accent:
                  Math.abs(selectedRow.estimation_error_pct) < 0.03
                    ? "#22c55e"
                    : Math.abs(selectedRow.estimation_error_pct) < 0.07
                    ? "#eab308"
                    : "#ef4444",
                sub: `${errorSign}${fmt$(selectedRow.estimation_error_amt)} vs truth`,
              },
              {
                label: "CI Width",
                value: ci ? fmt$(ci.width) : "—",
                accent: "#a855f7",
                sub: `at ${confidenceLevel}% confidence`,
              },
              {
                label: "Sample Coverage",
                value: fmtPct(selectedRow.sample_coverage_rate),
                accent: "#06b6d4",
                sub: `${fmtNum(selectedRow.sample_size)} claims sampled`,
              },
            ].map((k) => (
              <div
                key={k.label}
                className="relative overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/80 p-4"
              >
                <div
                  className="absolute inset-x-0 top-0 h-px"
                  style={{ background: k.accent }}
                />
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  {k.label}
                </p>
                <p className="text-2xl font-bold text-white">{k.value}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">{k.sub}</p>
              </div>
            ))}
          </div>

          {/* CI Visualization */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">
              Confidence Interval Visualization
            </h2>
            <p className="mb-2 text-xs text-slate-500">
              {confidenceLevel}% CI for estimated universe overpayment ·{" "}
              {SAMPLE_TYPE_LABELS[selectedType]} strategy
            </p>
            {ci && scaledEstimate && (
              <CIBar
                estimate={scaledEstimate}
                lower={ci.lower}
                upper={ci.upper}
                truth={TRUE_UNIVERSE_OVERPAYMENT}
              />
            )}
          </div>

          {/* Interpretation */}
          <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-base">🔍</span>
              <h2 className="text-sm font-semibold text-amber-300">
                Analytical Interpretation
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-amber-100/80">
              {interpretation}
            </p>
          </div>

          {/* Comparison + Error Metrics */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {/* Sampling Bias Comparison */}
            <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
              <h2 className="mb-3 text-sm font-semibold text-white">
                Strategy Comparison
              </h2>
              <p className="mb-4 text-xs text-slate-500">
                Extrapolated overpayment vs random baseline and true universe
              </p>
              <ComparisonBar
                label={SAMPLE_TYPE_LABELS[selectedType]}
                value={selectedRow.extrapolated_overpayment}
                max={maxComparison}
                color="#3b82f6"
                sub="Selected strategy"
              />
              {selectedType !== "Random_Sample" && randomRow && (
                <ComparisonBar
                  label="Random Baseline"
                  value={randomRow.extrapolated_overpayment}
                  max={maxComparison}
                  color="#64748b"
                  sub="Unbiased reference"
                />
              )}
              <ComparisonBar
                label="True Universe"
                value={TRUE_UNIVERSE_OVERPAYMENT}
                max={maxComparison}
                color="#22c55e"
                sub="Ground truth benchmark"
              />
            </div>

            {/* Error Metrics */}
            <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
              <h2 className="mb-3 text-sm font-semibold text-white">
                Error Metrics
              </h2>
              <div className="space-y-3">
                {[
                  {
                    label: "Absolute Error",
                    value: fmt$(Math.abs(selectedRow.estimation_error_amt)),
                    sub: errorSign
                      ? "Overestimate"
                      : "Underestimate",
                  },
                  {
                    label: "Relative Error",
                    value: fmtPct(selectedRow.estimation_error_pct),
                    sub: "vs true universe overpayment",
                  },
                  {
                    label: "Sample OP Rate",
                    value: fmtPct(selectedRow.sample_overpayment_rate),
                    sub: `Universe rate: ${fmtPct(TRUE_OP_RATE)}`,
                  },
                  {
                    label: "CI Lower Bound",
                    value: ci ? fmt$(ci.lower) : "—",
                    sub: `${confidenceLevel}% confidence`,
                  },
                  {
                    label: "CI Upper Bound",
                    value: ci ? fmt$(ci.upper) : "—",
                    sub: `${confidenceLevel}% confidence`,
                  },
                  {
                    label: "CI Width",
                    value: ci ? fmt$(ci.width) : "—",
                    sub: ci
                      ? `${fmtPct(ci.width / TRUE_UNIVERSE_OVERPAYMENT)} of true overpayment`
                      : "",
                  },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="flex items-start justify-between border-b border-slate-800/60 pb-2"
                  >
                    <div>
                      <p className="text-xs font-medium text-slate-300">
                        {m.label}
                      </p>
                      {m.sub && (
                        <p className="text-[10px] text-slate-500">{m.sub}</p>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-white">
                      {m.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sample Composition */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 p-5">
            <h2 className="mb-1 text-sm font-semibold text-white">
              Sample Composition
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Why estimates differ — what this sample captures about the universe
            </p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
              {[
                {
                  label: "Sample Size",
                  value: fmtNum(selectedRow.sample_size),
                  sub: `${fmtPct(selectedRow.sample_coverage_rate)} of universe`,
                },
                {
                  label: "OP Claims Found",
                  value: fmtNum(selectedRow.sample_op_claims),
                  sub: `${fmtPct(selectedRow.sample_op_claim_rate)} claim OP rate`,
                },
                {
                  label: "Sample Payment",
                  value: fmt$(selectedRow.sample_total_payment),
                  sub: `${fmtPct(selectedRow.sample_total_payment / TRUE_UNIVERSE_PAYMENT)} of universe paid`,
                },
                {
                  label: "OP Found in Sample",
                  value: fmt$(selectedRow.sample_overpayment_found),
                  sub: `Extrapolated to ${fmt$(selectedRow.extrapolated_overpayment)}`,
                },
              ].map((c) => (
                <div key={c.label}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {c.label}
                  </p>
                  <p className="mt-0.5 text-lg font-bold text-white">
                    {c.value}
                  </p>
                  <p className="text-[10px] text-slate-500">{c.sub}</p>
                </div>
              ))}
            </div>

            {/* All Strategies Comparison Table */}
            <div className="mt-5 overflow-x-auto">
              <p className="mb-2 text-xs font-semibold text-slate-400">
                All Strategies at a Glance
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700">
                    {["Strategy", "Sample Size", "Extrapolated OP", "Error %", "OP Rate"].map(
                      (h) => (
                        <th
                          key={h}
                          className="pb-2 pr-6 text-left font-semibold uppercase tracking-wider text-slate-400"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.sample_type}
                      className={`border-b border-slate-800/40 cursor-pointer transition-colors hover:bg-slate-800/40 ${
                        r.sample_type === selectedType
                          ? "bg-blue-950/30"
                          : ""
                      }`}
                      onClick={() => setSelectedType(r.sample_type)}
                    >
                      <td className="py-2 pr-6 font-medium text-white">
                        {SAMPLE_TYPE_LABELS[r.sample_type]}
                        {r.sample_type === selectedType && (
                          <span className="ml-2 rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-300">
                            active
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-6 text-slate-300">
                        {fmtNum(r.sample_size)}
                      </td>
                      <td className="py-2 pr-6 text-slate-200">
                        {fmt$(r.extrapolated_overpayment)}
                      </td>
                      <td
                        className={`py-2 pr-6 font-semibold ${
                          Math.abs(r.estimation_error_pct) < 0.03
                            ? "text-green-400"
                            : Math.abs(r.estimation_error_pct) < 0.07
                            ? "text-yellow-400"
                            : "text-red-400"
                        }`}
                      >
                        {r.estimation_error_amt > 0 ? "+" : ""}
                        {fmtPct(r.estimation_error_pct)}
                      </td>
                      <td className="py-2 pr-6 text-slate-300">
                        {fmtPct(r.sample_overpayment_rate)}
                      </td>
                    </tr>
                  ))}
                  {/* Truth row */}
                  <tr className="border-t border-emerald-800/40 bg-emerald-950/20">
                    <td className="py-2 pr-6 font-semibold text-emerald-300">
                      True Universe
                    </td>
                    <td className="py-2 pr-6 text-emerald-400">
                      {fmtNum(TRUE_UNIVERSE_CLAIMS)}
                    </td>
                    <td className="py-2 pr-6 text-emerald-400">
                      {fmt$(TRUE_UNIVERSE_OVERPAYMENT)}
                    </td>
                    <td className="py-2 pr-6 text-emerald-400">0.00%</td>
                    <td className="py-2 pr-6 text-emerald-400">
                      {fmtPct(TRUE_OP_RATE)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
