# TODO.md — Backlog and Future Work

## Immediate Next Session
- [ ] Commit all SQL scripts and run_sql.py to GitHub
- [ ] pip install pandas-gbq — resolve FutureWarning before full scale load
- [ ] Build notebooks/01_data_quality_eda.ipynb
- [ ] Build notebooks/02_claims_eda.ipynb
- [ ] Build notebooks/03_extrapolation_simulation.ipynb
- [ ] Build notebooks/04_provider_benchmarking.ipynb
- [ ] Build notebooks/05_anomaly_detection.ipynb

## V1 Remaining Work
- [ ] Validate analytical distributions in EDA notebooks
- [ ] Confirm extrapolation results are analytically meaningful
- [ ] Confirm anomaly scores correctly rank Suspicious/Outlier providers
- [ ] Switch to full mode, regenerate data, reload BigQuery
- [ ] Next.js dashboard setup
- [ ] Executive Overview page
- [ ] Claims Explorer page
- [ ] Extrapolation Simulator page
- [ ] Sample Fairness page
- [ ] Provider Benchmarking page
- [ ] Anomaly Detection page
- [ ] Risk Adjustment page
- [ ] Data Quality Monitor page

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

## V3 Backlog
- [ ] Model explainability (SHAP)
- [ ] Downloadable audit reports
- [ ] User-controlled simulator
- [ ] Advanced Vercel deployment polish
- [ ] Demo video

## Technical Debt
- pandas-gbq not installed — FutureWarning on BigQuery loads
- peer_group_summary only has 4 rows in prototype (limited peer group coverage at 50 providers)
- extrapolation_results has 4 rows — will be more meaningful at full scale
