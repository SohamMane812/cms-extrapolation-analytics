# TODO.md — Backlog and Future Work

## Immediate Next Session
- [ ] Build generate_reference_tables.py (procedure_ref and diagnosis_ref)
- [ ] Build generate_provider_dim.py
- [ ] Build generate_cclf8_beneficiaries.py
- [ ] Build generate_cclf1_part_a_claims.py
- [ ] Build generate_cclf4_diagnoses.py
- [ ] Build generate_cclf5_part_b_claims.py
- [ ] Build inject_bias_outliers_duplicates.py
- [ ] Build config.yaml for generation parameters
- [ ] Upload generated files to GCS
- [ ] Load raw files into BigQuery raw_cms_claims dataset

## V1 Remaining Work
- [ ] SQL: raw_to_staging transformations
- [ ] SQL: staging_to_curated transformations
- [ ] SQL: analytics aggregations
- [ ] EDA notebooks (01 through 05)
- [ ] Extrapolation simulation (notebook 03)
- [ ] Provider benchmarking (notebook 04)
- [ ] Basic anomaly detection (notebook 05)
- [ ] Dashboard: Next.js setup
- [ ] Dashboard: Executive Overview page
- [ ] Dashboard: Claims Explorer page
- [ ] Dashboard: Extrapolation Simulator page
- [ ] Dashboard: Sample Fairness page
- [ ] Dashboard: Provider Benchmarking page
- [ ] Dashboard: Anomaly Detection page
- [ ] Dashboard: Risk Adjustment page
- [ ] Dashboard: Data Quality Monitor page

## V2 Backlog
- [ ] K-Means clustering for providers (notebook 06)
- [ ] ML claim overpayment prediction (notebook 07)
- [ ] ML model validation (notebook 08)
- [ ] Coding intensity analysis
- [ ] Dashboard: Clustering page
- [ ] Dashboard: ML Model Results page
- [ ] rendering_provider_id on CCLF5

## V3 Backlog
- [ ] Model explainability (SHAP)
- [ ] Downloadable audit reports
- [ ] User-controlled simulator
- [ ] Advanced Vercel deployment polish
- [ ] Demo video

## Technical Debt
- None yet