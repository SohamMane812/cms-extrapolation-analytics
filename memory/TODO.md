# TODO.md — V3 Backlog

## Project Status
V1 (analytical implementation) and V2 (productization) are both COMPLETE.
The platform is presentation-ready and suitable for LinkedIn, recruiter, and professional walkthroughs.
Everything below is optional V3 enhancement work — not required for demo readiness.

---

## V3 Priority 1 — Cross-Page Workflow Navigation
The highest-value UX improvement remaining:
- [ ] "Investigate Claims →" button on Provider Benchmarking detail panel (passes provider_id to Claims Explorer)
- [ ] "Investigate Claims →" button on Anomaly Detection detail panel (passes provider_id + suspicious flag)
- [ ] Breadcrumb trail showing drill-down path (e.g., Anomaly → Provider → Claims)
- [ ] URL param support already built in Claims Explorer (?provider=PRV000xxx)

## V3 Priority 2 — Loading Experience
- [ ] Replace all spinners with Tailwind animate-pulse skeleton loaders
- [ ] Add React Suspense boundaries for streaming
- [ ] Progressive data loading (KPIs load first, charts load after)

## V3 Priority 3 — Performance
- [ ] Add query result caching (SWR or React Query)
- [ ] LIMIT guards on large table queries in Claims Explorer
- [ ] Optimize Claims Explorer pagination — currently counts full table on every filter change

## V3 Priority 4 — Known Minor Bugs
- [ ] Sample Fairness: Dual Eligible Rate KPI calculation (currently uses wrong denominator pattern)
- [ ] Sample Fairness: Denial rate chart bar colors not matching RACE_COLORS (Cell key mismatch)
- [ ] Extrapolation Simulator: CI bar lower/upper labels slightly clipped at bottom
- [ ] Extrapolation Simulator: Estimation Error direction sub-label always says same direction
- [ ] Re-enable TypeScript strict mode (currently disabled for recharts formatter compatibility)

## V3 Priority 5 — Demo & LinkedIn Readiness
- [ ] README.md — live URL, architecture diagram, tech stack, key findings, demo walkthrough guide
- [ ] Architecture diagram (GCP → BigQuery → Next.js → Vercel)
- [ ] Screenshot gallery in GitHub repo
- [ ] 3-minute demo walkthrough script
- [ ] LinkedIn post draft (key results + live link + what it demonstrates)

## V3 Priority 6 — Advanced Analytics
- [ ] K-Means provider clustering (notebook 06)
- [ ] ML claim overpayment prediction (notebook 07)
- [ ] ML model validation (notebook 08)
- [ ] Dashboard: Clustering page
- [ ] Dashboard: ML Model Results page
- [ ] Model explainability (SHAP)

## V3 Priority 7 — Platform Capabilities
- [ ] Downloadable audit reports (PDF export)
- [ ] User authentication (Clerk or NextAuth)
- [ ] audit_sample generation script
- [ ] rendering_provider_id on CCLF5
- [ ] Low-volume provider detection track
- [ ] Custom domain

## Technical Debt
- tsconfig.json strict mode disabled — re-enable after fixing recharts formatter types properly
- pandas-gbq FutureWarning — install pandas-gbq>=0.26.1
- BigQuery Storage module not installed — install google-cloud-bigquery-storage
- Notebook 03 Cell 4 prototype scale note outdated
