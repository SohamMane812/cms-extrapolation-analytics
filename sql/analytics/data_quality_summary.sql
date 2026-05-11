-- =============================================================================
-- data_quality_summary.sql
-- Aggregated data quality issue counts for dashboard monitoring.
--
-- Source  : {staging}.stg_data_quality_issues
-- Target  : {analytics}.data_quality_summary
--
-- Used by: Data Quality Monitor dashboard page
-- =============================================================================

CREATE OR REPLACE TABLE {analytics}.data_quality_summary
AS

WITH

issue_counts AS (
    SELECT
        source_table,
        issue_type,
        COUNT(*)                            AS issue_count,
        COUNT(DISTINCT record_id)           AS distinct_records_affected,
        COUNT(DISTINCT bene_mbi_id)         AS distinct_patients_affected,
        COUNT(DISTINCT provider_id)         AS distinct_providers_affected,
        AVG(CASE WHEN numeric_value IS NOT NULL
                THEN ABS(numeric_value) END) AS avg_numeric_value,
        MAX(CASE WHEN numeric_value IS NOT NULL
                THEN ABS(numeric_value) END) AS max_numeric_value,
        MIN(logged_at)                      AS first_logged,
        MAX(logged_at)                      AS last_logged
    FROM {staging}.stg_data_quality_issues
    GROUP BY 1, 2
),

totals AS (
    SELECT
        source_table,
        SUM(issue_count) AS total_issues_in_table
    FROM issue_counts
    GROUP BY 1
)

SELECT
    i.source_table,
    i.issue_type,
    i.issue_count,
    i.distinct_records_affected,
    i.distinct_patients_affected,
    i.distinct_providers_affected,
    i.avg_numeric_value,
    i.max_numeric_value,
    SAFE_DIVIDE(i.issue_count, t.total_issues_in_table) AS pct_of_table_issues,
    i.first_logged,
    i.last_logged,

    -- Severity classification
    CASE
        WHEN i.issue_type IN (
            'invalid_date_range',
            'denied_nonzero_payment',
            'paid_exceeds_allowed',
            'denied_nonzero_paid'
        ) THEN 'High'
        WHEN i.issue_type IN (
            'invalid_icd10_code',
            'invalid_hcpcs_code',
            'hcc_cat_missing_weight',
            'part_ab_missing_partb_date'
        ) THEN 'Medium'
        ELSE 'Low'
    END                                     AS severity,

    CURRENT_TIMESTAMP()                     AS computed_at

FROM issue_counts i
JOIN totals t ON t.source_table = i.source_table
ORDER BY source_table, issue_count DESC
