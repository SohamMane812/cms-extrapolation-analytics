# TODO.md — V2 Backlog and Future Work

## V2 Phase — Product Polish (Next Session Focus)

### Product Feel & UX
- [ ] Loading skeletons on all pages instead of spinner
- [ ] Error boundary components with helpful messages
- [ ] Empty state illustrations for filtered results
- [ ] Smooth page transitions
- [ ] Mobile responsiveness pass on all pages
- [ ] Tooltip improvements — richer context on hover
- [ ] Keyboard navigation support

### Storytelling & Narrative
- [ ] Add "About this analysis" context banners to each page
- [ ] Executive Overview — add a narrative summary section at top explaining what the dashboard shows
- [ ] Extrapolation Simulator — improve interpretation text for each strategy with more specific language
- [ ] Anomaly Detection — add "What to do next" action guidance below detection curve
- [ ] Claims Explorer — add "Investigation Guide" sidebar explaining audit workflow
- [ ] Each page should have a consistent "Key Takeaways" section

### Dashboard UX Refinements
- [ ] Cross-page drill-through navigation
  - Provider Benchmarking → Claims Explorer (filter by provider_id)
  - Anomaly Detection → Claims Explorer (filter by suspicious providers)
  - "Investigate Claims →" button on provider detail panels
- [ ] Claims Explorer: add date range filter
- [ ] Claims Explorer: add export to CSV button
- [ ] Provider Benchmarking: add "Compare providers" side-by-side view
- [ ] Extrapolation Simulator: fix CI bar label clipping at bottom
- [ ] Extrapolation Simulator: fix Estimation Error direction sub-label
- [ ] Executive Overview: add trend arrows on KPI cards (vs prior period)
- [ ] Anomaly Detection: show provider coverage count alongside anomaly tiers

### Business Interpretation Polish
- [ ] Add $ impact callouts — "This would recover $X in overpayments"
- [ ] Add audit priority queue — ranked list of recommended next actions
- [ ] Add benchmark context — "This rate is Xth percentile nationally"
- [ ] Sample Fairness: improve disparity ratio explanation
- [ ] Risk Adjustment: add upcoding alert threshold indicators

### Demo & LinkedIn Presentation
- [ ] Record 3-minute walkthrough video
- [ ] Write LinkedIn post with key results and architecture summary
- [ ] Create architecture diagram (GCP → BigQuery → Next.js → Vercel)
- [ ] Add README.md with project overview, tech stack, and live demo link
- [ ] Add screenshot gallery to GitHub repo
- [ ] Create executive one-pager PDF summarizing findings

### Technical Polish
- [ ] Add loading skeletons using Tailwind animate-pulse
- [ ] Implement React Suspense boundaries properly
- [ ] Add error retry logic on BigQuery API failures
- [ ] Optimize BigQuery queries — add LIMIT guards on large tables
- [ ] Add query caching layer (React Query or SWR)
- [ ] Fix: Dual Eligible Rate KPI on Sample Fairness page
- [ ] Fix: Denial rate chart colors on Sample Fairness page
- [ ] Fix: Risk Score & Chronic Burden chart legend order

## V2 Analytics Backlog
- [ ] K-Means clustering for providers (notebook 06)
- [ ] ML claim overpayment prediction (notebook 07)
- [ ] ML model validation (notebook 08)
- [ ] Coding intensity deep analysis
- [ ] Dashboard: Clustering page
- [ ] Dashboard: ML Model Results page
- [ ] rendering_provider_id on CCLF5
- [ ] audit_sample generation script
- [ ] Low-volume provider detection track

## V3 Backlog
- [ ] Model explainability (SHAP)
- [ ] Downloadable audit reports
- [ ] User authentication (Clerk or NextAuth)
- [ ] Advanced Vercel deployment polish
- [ ] Custom domain

## Technical Debt
- pandas-gbq FutureWarning — install pandas-gbq>=0.26.1
- BigQuery Storage module not installed — install google-cloud-bigquery-storage
- Notebook 03 Cell 4 prototype scale note outdated — update to positive validation note
- Peer group payment differentiation weak — consider separating facility types
- tsconfig.json strict mode disabled — re-enable after fixing recharts formatter types properly