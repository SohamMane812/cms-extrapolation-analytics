-- =============================================================================
-- dim_diagnosis.sql
-- Clean diagnosis reference dimension.
--
-- Source  : {raw}.raw_diagnosis_ref
-- Target  : {curated}.dim_diagnosis
-- =============================================================================

CREATE OR REPLACE TABLE {curated}.dim_diagnosis
CLUSTER BY body_system
AS

SELECT
    icd10_cd                            AS diagnosis_code,
    diagnosis_desc                      AS diagnosis_description,
    body_system,
    hcc_category,
    hcc_weight,
    chronic_flag                        AS is_chronic,
    high_value_hcc_flag                 AS is_high_value_hcc,
    CASE WHEN hcc_category IS NOT NULL
        THEN TRUE ELSE FALSE
    END                                 AS is_hcc_mapped,
    expected_care_pattern

FROM {raw}.raw_diagnosis_ref
