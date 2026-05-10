# DECISIONS.md — Finalized Decisions

## Data Scale (Finalized)
- Beneficiaries: 50K–100K
- Providers: 500–2,000
- Part A Claims (CCLF1): 300K–500K
- Diagnosis Rows (CCLF4): 1M–2M
- Part B Claim Lines (CCLF5): 500K–1.5M
- Total: ~2–4M rows

## Stack (Finalized)
- Python venv (no conda)
- .env files for all config/secrets
- GCP: BigQuery + Cloud Storage
- BigQuery datasets: raw, staging, curated, analytics, ml_outputs
- GCS bucket for raw and processed files
- Next.js frontend (deferred to later phase)
- Vercel deployment (deferred to later phase)

## Version Strategy (Finalized)
- V1: Data generation, EDA, extrapolation, provider benchmarking, basic anomaly detection, basic dashboard
- V2: Clustering, ML prediction, coding intensity
- V3: Model explainability, downloadable reports, advanced deployment

## GCP Region (Finalized)
- us-central1
