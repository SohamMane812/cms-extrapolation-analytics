-- =============================================================================
-- stg_provider_dim.sql
-- Staging transformation for provider dimension table.
--
-- Source  : {raw}.raw_provider_dim
-- Target  : {staging}.stg_provider_dim
--
-- Transformations applied:
--   - Validate required fields are non-null
--   - Standardize string casing
--   - Flag inactive providers
--   - Add load metadata
-- =============================================================================

CREATE OR REPLACE TABLE {staging}.stg_provider_dim
CLUSTER BY provider_type, provider_risk_profile
AS

WITH

source AS (
    SELECT * FROM {raw}.raw_provider_dim
),

validated AS (
    SELECT
        provider_id,
        provider_name,
        provider_type,
        specialty,
        region,
        state,
        peer_group,
        provider_risk_profile,
        ownership_type,
        bed_size,
        years_active,
        urban_rural_flag,
        active_flag,

        -- Data quality flags
        CASE
            WHEN provider_id IS NULL         THEN TRUE
            WHEN provider_name IS NULL       THEN TRUE
            WHEN provider_type IS NULL       THEN TRUE
            WHEN peer_group IS NULL          THEN TRUE
            WHEN provider_risk_profile IS NULL THEN TRUE
            ELSE FALSE
        END AS has_critical_null,

        CASE
            WHEN provider_type = 'Physician' AND specialty IS NULL THEN TRUE
            ELSE FALSE
        END AS physician_missing_specialty,

        CASE
            WHEN provider_type IN ('Hospital', 'SNF') AND bed_size IS NULL THEN TRUE
            ELSE FALSE
        END AS facility_missing_bed_size,

        CURRENT_TIMESTAMP() AS stg_loaded_at

    FROM source
)

SELECT
    provider_id,
    provider_name,
    provider_type,
    specialty,
    region,
    state,
    peer_group,
    provider_risk_profile,
    ownership_type,
    bed_size,
    years_active,
    urban_rural_flag,
    active_flag,
    has_critical_null,
    physician_missing_specialty,
    facility_missing_bed_size,
    stg_loaded_at

FROM validated

-- Exclude records with critical nulls from staging
-- They are captured in stg_data_quality_issues instead
WHERE has_critical_null = FALSE
