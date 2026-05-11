# TODO.md — V2 Product Polish Backlog

## V2 Priority 1 — Trust & Accuracy
- [ ] Audit all executive KPIs — verify numerator/denominator, check against notebook outputs
- [ ] Validate extrapolation totals match Notebook 03 outputs
- [ ] Validate anomaly score distributions match Notebook 05
- [ ] Fix Dual Eligible Rate KPI on Sample Fairness (currently shows wrong %)
- [ ] Fix denial rate chart colors on Sample Fairness page
- [ ] Document any known approximations or limitations inline

## V2 Priority 2 — Business-First Language
Rename across all pages:
- [ ] "Bootstrap Confidence Interval" → "Projected Recovery Range"
- [ ] "High Risk" → "Elevated Audit Risk"
- [ ] "Anomaly Score" → "Audit Risk Score" (or keep both with explanation)
- [ ] "Composite Anomaly Score" → "Composite Audit Risk Score"
- [ ] "Overpayment" → "Potential Overpayment" where appropriate
- [ ] "Universe" → "Total Claim Population" in simulator
- [ ] "Biased_High_Cost" → "High-Cost Focused" in simulator
- [ ] "Biased_Provider" → "Provider-Focused" in simulator
- [ ] Page subtitle copy — make each page subtitle operational/business-oriented
- [ ] KPI card labels — review all for business clarity

## V2 Priority 3 — "Why This Matters" Blocks
Add to each page:
- [ ] Executive Overview — "What this dashboard tells you"
- [ ] Extrapolation Simulator — "Why sample strategy matters for audit recovery"
- [ ] Provider Benchmarking — "How peer comparison supports audit targeting"
- [ ] Anomaly Detection — "How to use this for audit prioritization"
- [ ] Claims Explorer — "Investigation workflow guide"
- [ ] Data Quality Monitor — "How data quality affects audit reliability"
- [ ] Risk Adjustment — "Why HCC coding is an audit target"
- [ ] Sample Fairness — "Why demographic equity matters in audit design"

## V2 Priority 4 — Key Findings Cards
Add 3-5 insight bullets per page in business language:
- [ ] Executive Overview findings
- [ ] Extrapolation Simulator findings (per strategy)
- [ ] Provider Benchmarking findings
- [ ] Anomaly Detection findings
- [ ] Claims Explorer — contextual findings based on active filters
- [ ] Data Quality Monitor findings
- [ ] Risk Adjustment findings
- [ ] Sample Fairness findings

## V2 Priority 5 — Methodology Transparency
Expandable "How this is calculated" sections for:
- [ ] Extrapolation estimate and CI
- [ ] Composite anomaly score
- [ ] Provider peer benchmarking z-scores
- [ ] Risk adjustment / HCC weighting
- [ ] Audit risk score on Claims Explorer

## V2 Priority 6 — Cross-Page Workflow Navigation
- [ ] "Investigate Claims →" button on Provider Benchmarking detail panel
- [ ] "Investigate Claims →" button on Anomaly Detection detail panel
- [ ] Anomaly Detection → Claims Explorer with provider filter pre-applied
- [ ] Provider Benchmarking → Claims Explorer with provider filter pre-applied
- [ ] Breadcrumb trail showing drill-down path
- [ ] "Back to [page]" navigation links

## V2 Priority 7 — Visual Polish
- [ ] Replace all spinners with loading skeletons (Tailwind animate-pulse)
- [ ] Reduce KPI card count where pages feel overloaded
- [ ] Mute color palette — less red/yellow alarm overload
- [ ] More whitespace and breathing room between sections
- [ ] Consistent section header style across all pages
- [ ] Chart subtitle copy — every chart should have a 1-line "so what"
- [ ] Mobile responsiveness pass

## V2 Priority 8 — Demo & LinkedIn Readiness
- [ ] README.md — live URL, architecture diagram, key findings, tech stack
- [ ] Architecture diagram (GCP → BigQuery → Next.js → Vercel)
- [ ] Screenshot gallery in GitHub repo
- [ ] 3-minute demo walkthrough script
- [ ] LinkedIn post draft (key results + live link)
- [ ] Executive one-pager PDF (optional)

## V3 Backlog (Future)
- [ ] K-Means provider clustering (notebook 06)
- [ ] ML claim overpayment prediction (notebook 07)
- [ ] ML model validation (notebook 08)
- [ ] Dashboard: Clustering page
- [ ] Dashboard: ML Model Results page
- [ ] Model explainability (SHAP)
- [ ] Downloadable audit reports
- [ ] User authentication
- [ ] audit_sample generation script
- [ ] rendering_provider_id on CCLF5

## Technical Debt
- tsconfig.json strict mode disabled — re-enable after fixing recharts formatter types
- pandas-gbq FutureWarning — install pandas-gbq>=0.26.1
- BigQuery Storage module not installed — install google-cloud-bigquery-storage
- Notebook 03 Cell 4 prototype scale note outdated
- Peer group payment differentiation weak — consider separating facility types
