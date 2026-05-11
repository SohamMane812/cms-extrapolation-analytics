# TODO.md — Backlog and Future Work

## Immediate Next Session
- [ ] Fix notebook 04 overpayment rate finding text (rates are uniform, not elevated)
- [ ] Fix notebook 05 cumulative detection curve finding (overpayment recovery is ~equal at 20%)
- [ ] Commit all notebooks, generation scripts, and utilities to GitHub
- [ ] Begin Next.js dashboard setup (package.json, tailwind, folder structure)
- [ ] Build Executive Overview dashboard page
- [ ] Build Extrapolation Simulator dashboard page (centerpiece)

## V1 Dashboard Remaining Work
- [ ] Next.js project initialization in dashboard/ folder
- [ ] BigQuery API route setup
- [ ] Executive Overview page
- [ ] Extrapolation Simulator page
- [ ] Provider Benchmarking page
- [ ] Anomaly Detection page
- [ ] Claims Explorer page
- [ ] Data Quality Monitor page
- [ ] Risk Adjustment / Coding Intensity page
- [ ] Sample Fairness page
- [ ] Vercel deployment

## Known Findings to Address in Dashboard
- Peer group payment baselines converge ($3.9K-$4.0K) — dashboard should
  emphasize denial rate and anomaly score differences, not payment alone
- Anomaly score null blind spot for sparse providers — dashboard should
  display provider coverage count alongside anomaly tiers
- Telehealth rate 30-44% is high — note in dashboard as prototype artifact,
  directional trend is correct

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
- [ ] Low-volume provider detection track (separate from z-score scoring)

## V3 Backlog
- [ ] Model explainability (SHAP)
- [ ] Downloadable audit reports
- [ ] User-controlled simulator
- [ ] Advanced Vercel deployment polish
- [ ] Demo video

## Technical Debt
- pandas-gbq FutureWarning — install pandas-gbq>=0.26.1
- BigQuery Storage module not installed — install google-cloud-bigquery-storage
  for faster query result downloads at full scale
- Notebook 03 Cell 4 prototype scale note is now outdated at full scale —
  update to positive validation note
- Peer group payment differentiation is weak — consider separating facility
  types from physician groups in payment benchmarking
  