-- =============================================================================
-- dim_procedure.sql
-- Clean procedure reference dimension.
--
-- Source  : {raw}.raw_procedure_ref
-- Target  : {curated}.dim_procedure
-- =============================================================================

CREATE OR REPLACE TABLE {curated}.dim_procedure
AS

SELECT
    hcpcs_cd                            AS procedure_code,
    procedure_desc                      AS procedure_description,
    procedure_category,
    expected_allowed_amt,
    allowed_amt_std_dev,
    high_risk_billing_flag              AS is_high_risk_billing,
    typical_specialty,
    inpatient_only_flag                 AS is_inpatient_only

FROM {raw}.raw_procedure_ref
