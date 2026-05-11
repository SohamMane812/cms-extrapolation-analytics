-- =============================================================================
-- dim_date.sql
-- Date dimension table covering the full claims data range plus buffer.
--
-- Source  : Generated from BigQuery date spine
-- Target  : {curated}.dim_date
--
-- Covers 2020-01-01 through 2024-12-31 to support all claims dates
-- plus enrollment start dates which may precede the claims window.
-- =============================================================================

CREATE OR REPLACE TABLE {curated}.dim_date
AS

WITH date_spine AS (
    SELECT date_val
    FROM UNNEST(
        GENERATE_DATE_ARRAY('2020-01-01', '2024-12-31', INTERVAL 1 DAY)
    ) AS date_val
)

SELECT
    date_val                                    AS date_id,
    date_val                                    AS full_date,
    EXTRACT(YEAR        FROM date_val)          AS year,
    EXTRACT(QUARTER     FROM date_val)          AS quarter,
    EXTRACT(MONTH       FROM date_val)          AS month,
    EXTRACT(DAY         FROM date_val)          AS day,
    EXTRACT(WEEK        FROM date_val)          AS week_of_year,
    EXTRACT(DAYOFWEEK   FROM date_val)          AS day_of_week,
    FORMAT_DATE('%Y-Q%Q', date_val)             AS year_quarter,
    FORMAT_DATE('%Y-%m',  date_val)             AS year_month,
    FORMAT_DATE('%B',     date_val)             AS month_name,
    FORMAT_DATE('%b',     date_val)             AS month_name_short,
    CASE EXTRACT(MONTH FROM date_val)
        WHEN 12 THEN 'Winter'
        WHEN  1 THEN 'Winter'
        WHEN  2 THEN 'Winter'
        WHEN  3 THEN 'Spring'
        WHEN  4 THEN 'Spring'
        WHEN  5 THEN 'Spring'
        WHEN  6 THEN 'Summer'
        WHEN  7 THEN 'Summer'
        WHEN  8 THEN 'Summer'
        ELSE 'Fall'
    END                                         AS season,
    CASE EXTRACT(MONTH FROM date_val)
        WHEN 1  THEN TRUE WHEN 2 THEN TRUE WHEN 3 THEN TRUE
        ELSE FALSE
    END                                         AS is_flu_season,
    CASE EXTRACT(DAYOFWEEK FROM date_val)
        WHEN 1 THEN TRUE WHEN 7 THEN TRUE ELSE FALSE
    END                                         AS is_weekend

FROM date_spine
