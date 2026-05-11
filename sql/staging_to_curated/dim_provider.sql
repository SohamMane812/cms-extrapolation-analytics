-- =============================================================================
-- dim_provider.sql
-- Clean provider dimension for analytics consumption.
--
-- Source  : {staging}.stg_provider_dim
-- Target  : {curated}.dim_provider
--
-- Design principles:
--   - Business-friendly labels for all coded fields
--   - Peer group and risk profile preserved for benchmarking
--   - Facility size bucket derived from bed_size for dashboard grouping
-- =============================================================================

CREATE OR REPLACE TABLE {curated}.dim_provider
CLUSTER BY provider_type, provider_risk_profile
AS

SELECT
    -- Primary key
    provider_id,
    provider_name,

    -- Classification
    provider_type,
    specialty,
    peer_group,
    provider_risk_profile,
    ownership_type,

    -- Geography
    region,
    state,
    urban_rural_flag                    AS urban_rural,

    -- Facility characteristics
    bed_size,
    CASE
        WHEN bed_size IS NULL           THEN NULL
        WHEN bed_size < 50              THEN 'Small (<50 beds)'
        WHEN bed_size BETWEEN 50 AND 149 THEN 'Medium (50–149 beds)'
        WHEN bed_size BETWEEN 150 AND 399 THEN 'Large (150–399 beds)'
        ELSE 'Very Large (400+ beds)'
    END                                 AS facility_size_bucket,

    years_active,
    CASE
        WHEN years_active <= 3  THEN 'New (≤3 years)'
        WHEN years_active <= 10 THEN 'Established (4–10 years)'
        ELSE 'Mature (10+ years)'
    END                                 AS provider_tenure_bucket,

    active_flag                         AS is_active,

    -- Risk flags for dashboard and anomaly analysis
    CASE WHEN provider_risk_profile IN ('Suspicious', 'Outlier')
        THEN TRUE ELSE FALSE
    END                                 AS is_high_risk_profile,

    -- Data quality flags
    physician_missing_specialty,
    facility_missing_bed_size,

    stg_loaded_at                       AS loaded_at

FROM {staging}.stg_provider_dim
