# TODO.md — Backlog and Future Work

## Immediate Next Session
- [ ] Build Data Quality Monitor page (/data-quality)
- [ ] Build Risk Adjustment / Coding Intensity page (/risk-adjustment)
- [ ] Build Sample Fairness page (/sample-fairness)
- [ ] Add global navigation bar (all 8 pages linked)
- [ ] Polish: fix CI bar label clipping on Extrapolation Simulator
- [ ] Polish: Estimation Error sub-label direction on Extrapolation Simulator
- [ ] Vercel deployment setup

## V1 Dashboard Remaining Work
- [ ] Data Quality Monitor page — DQ issue counts, staging validation, field-level issues
- [ ] Risk Adjustment page — HCC weights, coding intensity, risk score distribution
- [ ] Sample Fairness page — audit sample equity, demographic breakdown
- [ ] Global nav bar — links to all pages, active state, breadcrumbs
- [ ] Vercel deployment — env vars, service account key handling

## Cross-Page Drill-Through (deferred polish)
- [ ] Provider Benchmarking → Claims Explorer (filter by provider_id)
- [ ] Anomaly Detection → Claims Explorer (filter by provider + suspicious flag)
- [ ] Extrapolation Simulator → Claims Explorer (filter by sample type claims)
- Add "Investigate Claims →" button on provider detail panels

## Known Dashboard Issues to Fix
- Extrapolation Simulator CI bar lower/upper labels slightly cut off at bottom
- Estimation Error KPI sub-label always says "Overestimate" — should reflect direction
- Executive Overview: peer group payment differentiation weak ($3.9K–$4.0K range) — note in UI
- Anomaly score null blind spot for sparse providers — add coverage count to anomaly tiers

## Known Findings to Note in Dashboard
- Telehealth rate 30–44% is high — note as prototype artifact, directional trend correct
- Peer group payment baselines converge — emphasize denial rate and anomaly score differences
- Random sampling 10.1% error at 2% sample size — expected, document in simulator

## V2 Backlog
- [ ] K-Means clustering for providers (notebook 06)
- [ ] ML claim overpayment prediction (notebook 07)
- [ ] ML model validation (notebook 08)
- [ ] Coding intensity deep analysis
- [ ] Dashboard: Clustering page
- [ ] Dashboard: ML Model Results page
- [ ] rendering_provider_id on CCLF5
- [ ] inject_bias_outliers_duplicates.py post-processing script
- [ ] audit_sample generation script
- [ ] Low-volume provider detection track

## V3 Backlog
- [ ] Model explainability (SHAP)
- [ ] Downloadable audit reports
- [ ] User-controlled simulator
- [ ] Advanced Vercel deployment polish
- [ ] Demo video

## Technical Debt
- pandas-gbq FutureWarning — install pandas-gbq>=0.26.1
- BigQuery Storage module not installed — install google-cloud-bigquery-storage
- Notebook 03 Cell 4 prototype scale note outdated — update to positive validation note
- Peer group payment differentiation weak — consider separating facility types from physician groups
- dashboard/.env.local uses relative path for service account key — verify works on Vercel
