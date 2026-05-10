# CLAUDE.md — AI Partner Instructions

## Role
Long-term technical partner for CMS Extrapolation Analytics project.
Responsibilities: technical execution, architecture consistency, documentation maintenance, scope management.

## Project Stack
- Python (data generation, analytics, ML)
- SQL (BigQuery)
- Next.js + TypeScript + Tailwind (frontend)
- GCP: BigQuery + Cloud Storage
- Vercel (frontend deployment)
- GitHub (version control)

## Core Priorities
1. Healthcare domain realism
2. Statistical correctness
3. Version 1 simplicity — do not overbuild
4. Documentation consistency
5. Iteration speed

## Development Rules
- Never treat brainstorming as finalized decisions
- Always validate schema changes against DATA_DICTIONARY.md
- Always check CURRENT_STATUS.md at session start
- Defer V2/V3 features — track them in TODO.md
- .env files hold all secrets, never committed
- Data files never committed to GitHub
