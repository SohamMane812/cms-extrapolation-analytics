"""
data_generation/generate_reference_tables.py

Generates two static reference tables:
  - procedure_ref: CPT/HCPCS procedure code reference
  - diagnosis_ref: ICD-10 diagnosis code reference

These tables have no dependencies on other generated data.
They must be generated first as all other scripts reference them.

Usage:
    python data_generation/generate_reference_tables.py

Output (prototype mode):
    outputs/generated/prototype/procedure_ref.parquet
    outputs/generated/prototype/diagnosis_ref.parquet

Output (full mode):
    outputs/generated/full/procedure_ref.parquet
    outputs/generated/full/diagnosis_ref.parquet
"""

import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Ensure repo root is on path regardless of working directory
# ---------------------------------------------------------------------------
repo_root = Path(__file__).resolve().parent.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

import random
import numpy as np
import pandas as pd

from src.utils.config_loader import load_config, get_output_dir, get_raw_section, summarize_config


# ---------------------------------------------------------------------------
# Procedure code pools
# Realistic CPT/HCPCS codes grouped by category
# ---------------------------------------------------------------------------

PROCEDURE_POOLS = {
    "E/M": [
        ("99213", "Office Visit Established Patient Low Complexity"),
        ("99214", "Office Visit Established Patient Moderate Complexity"),
        ("99215", "Office Visit Established Patient High Complexity"),
        ("99203", "Office Visit New Patient Low Complexity"),
        ("99204", "Office Visit New Patient Moderate Complexity"),
        ("99205", "Office Visit New Patient High Complexity"),
        ("99232", "Subsequent Hospital Care"),
        ("99233", "Subsequent Hospital Care High Complexity"),
        ("99222", "Initial Hospital Care Moderate Complexity"),
        ("99223", "Initial Hospital Care High Complexity"),
        ("99307", "SNF Subsequent Care Straightforward"),
        ("99308", "SNF Subsequent Care Low Complexity"),
        ("99309", "SNF Subsequent Care Moderate Complexity"),
        ("99310", "SNF Subsequent Care High Complexity"),
        ("99324", "Domiciliary Care New Patient Low Complexity"),
        ("99325", "Domiciliary Care New Patient Moderate Complexity"),
        ("G0438", "Annual Wellness Visit Initial"),
        ("G0439", "Annual Wellness Visit Subsequent"),
        ("99341", "Home Visit New Patient Low Complexity"),
        ("99342", "Home Visit New Patient Moderate Complexity"),
        ("99343", "Home Visit New Patient Moderate-High Complexity"),
        ("99347", "Home Visit Established Patient Straightforward"),
        ("99348", "Home Visit Established Patient Low Complexity"),
    ],
    "Imaging": [
        ("71046", "Chest X-Ray 2 Views"),
        ("71048", "Chest X-Ray 4 Views"),
        ("73721", "MRI Lower Extremity Joint Without Contrast"),
        ("73722", "MRI Lower Extremity Joint With Contrast"),
        ("72148", "MRI Lumbar Spine Without Contrast"),
        ("72149", "MRI Lumbar Spine With Contrast"),
        ("70553", "MRI Brain With and Without Contrast"),
        ("70551", "MRI Brain Without Contrast"),
        ("93306", "Echocardiography With Doppler"),
        ("93307", "Echocardiography Without Doppler"),
        ("78452", "Myocardial Perfusion Imaging Multiple Studies"),
        ("74178", "CT Abdomen and Pelvis With Contrast"),
        ("74177", "CT Abdomen and Pelvis Without Contrast"),
        ("71250", "CT Thorax Without Contrast"),
        ("71260", "CT Thorax With Contrast"),
        ("72125", "CT Cervical Spine Without Contrast"),
        ("76856", "Ultrasound Pelvis Complete"),
        ("93880", "Duplex Scan Extracranial Arteries"),
    ],
    "Lab": [
        ("80053", "Comprehensive Metabolic Panel"),
        ("80061", "Lipid Panel"),
        ("85025", "Complete Blood Count With Differential"),
        ("83036", "Hemoglobin A1c"),
        ("84443", "Thyroid Stimulating Hormone"),
        ("82947", "Glucose Quantitative"),
        ("84132", "Potassium Serum"),
        ("84295", "Sodium Serum"),
        ("82565", "Creatinine Serum"),
        ("84520", "BUN Blood Urea Nitrogen"),
        ("84100", "Phosphorus Serum"),
        ("82310", "Calcium Total Serum"),
        ("86900", "Blood Typing ABO"),
        ("87804", "Influenza Virus Antigen Detection"),
        ("87502", "Influenza Virus Multiplex Amplification"),
        ("86140", "C Reactive Protein"),
        ("83880", "BNP B-Natriuretic Peptide"),
        ("82042", "Albumin Urine Random"),
        ("81001", "Urinalysis With Microscopy"),
        ("87340", "Hepatitis B Surface Antigen"),
    ],
    "Surgery": [
        ("27447", "Total Knee Arthroplasty"),
        ("27130", "Total Hip Arthroplasty"),
        ("33533", "Coronary Artery Bypass Arterial Single"),
        ("33534", "Coronary Artery Bypass Arterial Two"),
        ("43239", "Upper GI Endoscopy With Biopsy"),
        ("43235", "Upper GI Endoscopy Diagnostic"),
        ("45378", "Colonoscopy Diagnostic"),
        ("45380", "Colonoscopy With Biopsy"),
        ("66984", "Cataract Surgery With IOL"),
        ("64483", "Epidural Injection Lumbar"),
        ("27245", "ORIF Proximal Femur"),
        ("29827", "Arthroscopy Shoulder Rotator Cuff Repair"),
        ("33249", "ICD Insertion Dual Chamber"),
    ],
    "Telehealth": [
        ("G2012", "Brief Check-In Telehealth"),
        ("G2010", "Remote Image Evaluation"),
        ("99441", "Telephone Evaluation Management 5-10 Min"),
        ("99442", "Telephone Evaluation Management 11-20 Min"),
        ("99443", "Telephone Evaluation Management 21-30 Min"),
        ("98966", "Telephone Assessment Non-Physician 5-10 Min"),
        ("98967", "Telephone Assessment Non-Physician 11-20 Min"),
        ("G0506", "Comprehensive Care Planning Chronic Conditions"),
        ("99421", "Online Digital E/M 5-10 Min"),
        ("99422", "Online Digital E/M 11-20 Min"),
        ("99423", "Online Digital E/M 21 or More Min"),
    ],
    "Injection": [
        ("J0171", "Adrenalin Epinephrine Injection"),
        ("J1040", "Methylprednisolone 80mg Injection"),
        ("J1100", "Dexamethasone Sodium Phosphate Injection"),
        ("J2001", "Lidocaine HCl Injection"),
        ("J7030", "Normal Saline Infusion"),
        ("J1644", "Heparin Sodium Injection"),
        ("J0690", "Cefazolin Sodium Injection"),
        ("J2270", "Morphine Sulfate Injection"),
        ("J2175", "Meperidine HCl Injection"),
        ("J3010", "Fentanyl Citrate Injection"),
        ("J9310", "Rituximab Injection"),
        ("J9035", "Bevacizumab Injection"),
    ],
    "Pathology": [
        ("88305", "Tissue Examination Surgical Pathology"),
        ("88307", "Tissue Examination Complex Surgical Pathology"),
        ("88309", "Tissue Examination Extensive Surgical Pathology"),
        ("88160", "Cytopathology Smear Screening"),
        ("88172", "Cytopathology Evaluation Fine Needle Aspirate"),
        ("88175", "Cytopathology Automated with Manual Rescreening"),
        ("G0123", "Cervical or Vaginal Cytology Screening"),
        ("88342", "Immunohistochemistry Single Antibody"),
        ("88360", "Tumor Immunohistochemistry Manual"),
    ],
}

# ---------------------------------------------------------------------------
# Diagnosis code pools
# Realistic ICD-10 codes organized by body system
# ---------------------------------------------------------------------------

DIAGNOSIS_POOLS = {
    "Cardiovascular": {
        "codes": [
            ("I10",   "Essential Primary Hypertension",                    True,  True),
            ("I50.9", "Heart Failure Unspecified",                         True,  True),
            ("I50.32","Chronic Diastolic Heart Failure",                   True,  True),
            ("I25.10","Atherosclerotic Heart Disease Native Coronary",      True,  True),
            ("I48.91","Unspecified Atrial Fibrillation",                   True,  True),
            ("I21.9", "Acute Myocardial Infarction Unspecified",           False, True),
            ("I63.9", "Cerebral Infarction Unspecified",                   False, True),
            ("I70.209","Unspecified Atherosclerosis Native Arteries",      True,  True),
            ("I87.2", "Venous Insufficiency Chronic Peripheral",           True,  False),
            ("I73.9", "Peripheral Vascular Disease Unspecified",           True,  True),
            ("I38",   "Endocarditis Valve Unspecified",                    False, False),
            ("I42.9", "Cardiomyopathy Unspecified",                        True,  True),
        ],
        "hcc_weight_range": [0.25, 0.65],
    },
    "Endocrine": {
        "codes": [
            ("E11.9", "Type 2 Diabetes Without Complications",             True,  True),
            ("E11.65","Type 2 Diabetes With Hyperglycemia",                True,  True),
            ("E11.40","Type 2 Diabetes Diabetic Neuropathy Unspecified",   True,  True),
            ("E11.21","Type 2 Diabetes Diabetic Nephropathy",              True,  True),
            ("E11.311","Type 2 Diabetes Diabetic Retinopathy Mild",        True,  True),
            ("E03.9", "Hypothyroidism Unspecified",                        True,  False),
            ("E66.9", "Obesity Unspecified",                               True,  False),
            ("E78.5", "Hyperlipidemia Unspecified",                        True,  False),
            ("E87.1", "Hypo-osmolality and Hyponatremia",                  False, False),
            ("E11.51","Type 2 Diabetes With Diabetic Peripheral Angiopathy",True, True),
        ],
        "hcc_weight_range": [0.20, 0.55],
    },
    "Respiratory": {
        "codes": [
            ("J44.1", "COPD With Acute Exacerbation",                      True,  True),
            ("J44.0", "COPD With Acute Lower Respiratory Infection",        True,  True),
            ("J45.50","Severe Persistent Asthma Uncomplicated",             True,  False),
            ("J18.9", "Pneumonia Unspecified Organism",                     False, False),
            ("J96.00","Acute Respiratory Failure Unspecified",              False, True),
            ("J84.10","Pulmonary Fibrosis Unspecified",                     True,  True),
            ("G47.33","Obstructive Sleep Apnea Adult",                      True,  False),
            ("J43.9", "Emphysema Unspecified",                              True,  True),
            ("J15.9", "Unspecified Bacterial Pneumonia",                    False, False),
        ],
        "hcc_weight_range": [0.20, 0.50],
    },
    "Renal": {
        "codes": [
            ("N18.3", "Chronic Kidney Disease Stage 3",                    True,  True),
            ("N18.4", "Chronic Kidney Disease Stage 4",                    True,  True),
            ("N18.5", "Chronic Kidney Disease Stage 5",                    True,  True),
            ("N18.6", "End Stage Renal Disease",                           True,  True),
            ("N17.9", "Acute Kidney Failure Unspecified",                  False, True),
            ("N19",   "Unspecified Kidney Failure",                        True,  True),
            ("N40.0", "Benign Prostatic Hyperplasia Without LUTS",         True,  False),
            ("N39.0", "Urinary Tract Infection Site Not Specified",        False, False),
        ],
        "hcc_weight_range": [0.30, 0.80],
    },
    "Musculoskeletal": {
        "codes": [
            ("M17.11","Primary Osteoarthritis Right Knee",                  True,  False),
            ("M17.12","Primary Osteoarthritis Left Knee",                   True,  False),
            ("M16.11","Primary Osteoarthritis Right Hip",                   True,  False),
            ("M54.5", "Low Back Pain",                                      False, False),
            ("M79.3", "Panniculitis Unspecified",                           False, False),
            ("M25.511","Pain in Right Shoulder",                            False, False),
            ("M81.0", "Age-Related Osteoporosis Without Fracture",          True,  False),
            ("M48.06","Spinal Stenosis Lumbar Region",                      True,  False),
            ("M06.9", "Rheumatoid Arthritis Unspecified",                   True,  True),
        ],
        "hcc_weight_range": [0.05, 0.30],
    },
    "Neurological": {
        "codes": [
            ("G20",   "Parkinson Disease",                                  True,  True),
            ("G30.9", "Alzheimer Disease Unspecified",                      True,  True),
            ("G35",   "Multiple Sclerosis",                                 True,  True),
            ("G43.909","Migraine Unspecified Not Intractable",              True,  False),
            ("G89.29","Other Chronic Pain",                                 True,  False),
            ("R41.3", "Other Amnesia",                                      False, False),
            ("G62.9", "Polyneuropathy Unspecified",                         True,  True),
            ("G45.9", "Transient Cerebral Ischemic Attack Unspecified",     False, True),
            ("G40.909","Epilepsy Unspecified Not Intractable",              True,  True),
        ],
        "hcc_weight_range": [0.20, 0.75],
    },
    "Oncology": {
        "codes": [
            ("C34.90","Malignant Neoplasm Bronchus Lung Unspecified",       False, True),
            ("C61",   "Malignant Neoplasm Prostate",                        False, True),
            ("C50.912","Malignant Neoplasm Breast Unspecified Left",        False, True),
            ("C18.9", "Malignant Neoplasm Colon Unspecified",               False, True),
            ("C67.9", "Malignant Neoplasm Bladder Unspecified",             False, True),
            ("C25.9", "Malignant Neoplasm Pancreas Unspecified",            False, True),
            ("C90.00","Multiple Myeloma Not in Remission",                  False, True),
            ("C92.00","Acute Myeloid Leukemia Not in Remission",            False, True),
            ("Z85.3", "Personal History Malignant Neoplasm Breast",         False, False),
            ("Z85.118","Personal History Malignant Neoplasm Other Bronchus",False, False),
        ],
        "hcc_weight_range": [0.60, 2.00],
    },
    "Gastrointestinal": {
        "codes": [
            ("K21.0", "GERD With Esophagitis",                             True,  False),
            ("K57.30","Diverticulosis Large Intestine Without Perforation", True,  False),
            ("K92.1", "Melena",                                             False, False),
            ("K74.60","Unspecified Cirrhosis of Liver",                     True,  True),
            ("K70.30","Alcoholic Cirrhosis Without Ascites",                True,  True),
            ("K56.609","Unspecified Intestinal Obstruction Unspecified",    False, False),
            ("K26.9", "Duodenal Ulcer Unspecified",                         False, False),
            ("K59.00","Constipation Unspecified",                           False, False),
        ],
        "hcc_weight_range": [0.05, 0.50],
    },
    "Psychiatric": {
        "codes": [
            ("F32.9", "Major Depressive Disorder Single Episode Unspecified",True, False),
            ("F41.1", "Generalized Anxiety Disorder",                       True,  False),
            ("F10.20","Alcohol Use Disorder Uncomplicated",                  True,  True),
            ("F19.20","Other Psychoactive Substance Use Disorder",           True,  True),
            ("F20.9", "Schizophrenia Unspecified",                           True,  True),
            ("F31.9", "Bipolar Disorder Unspecified",                        True,  True),
            ("F03.90","Unspecified Dementia Without Behavioral Disturbance", True,  True),
        ],
        "hcc_weight_range": [0.20, 0.60],
    },
    "Infectious": {
        "codes": [
            ("A41.9", "Sepsis Unspecified Organism",                        False, True),
            ("B20",   "HIV Disease",                                         True,  True),
            ("A04.7", "Enterocolitis Due to Clostridium Difficile",          False, False),
            ("J12.89","Other Viral Pneumonia",                               False, False),
            ("L03.90","Cellulitis Unspecified",                              False, False),
            ("N10",   "Acute Pyelonephritis",                                False, False),
            ("M00.9", "Pyogenic Arthritis Unspecified",                      False, False),
        ],
        "hcc_weight_range": [0.10, 0.80],
    },
}

# HCC category labels mapped to body systems
HCC_CATEGORY_MAP = {
    "Cardiovascular":   "HCC085",
    "Endocrine":        "HCC019",
    "Respiratory":      "HCC111",
    "Renal":            "HCC136",
    "Musculoskeletal":  "HCC040",
    "Neurological":     "HCC075",
    "Oncology":         "HCC008",
    "Gastrointestinal": "HCC042",
    "Psychiatric":      "HCC057",
    "Infectious":       "HCC002",
}

EXPECTED_CARE_PATTERN_MAP = {
    "Cardiovascular":   "Specialist_Visit,Imaging,Medications",
    "Endocrine":        "Labs,Medications",
    "Respiratory":      "Labs,Medications,Imaging",
    "Renal":            "Labs,Specialist_Visit,Medications",
    "Musculoskeletal":  "Imaging,Specialist_Visit",
    "Neurological":     "Imaging,Specialist_Visit,Medications",
    "Oncology":         "Labs,Imaging,Specialist_Visit",
    "Gastrointestinal": "Labs,Imaging",
    "Psychiatric":      "Medications,Specialist_Visit",
    "Infectious":       "Labs,Medications",
}


# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------

def generate_procedure_ref(cfg, ref_cfg: dict, rng: np.random.Generator) -> pd.DataFrame:
    """Generate procedure_ref table."""
    print("  Generating procedure_ref...")

    records = []
    categories = ref_cfg["procedure_categories"]

    # Build weighted category list from pools
    for cat_cfg in categories:
        cat_name = cat_cfg["name"]
        pool = PROCEDURE_POOLS.get(cat_name, [])
        if not pool:
            continue

        pay_min, pay_max = cat_cfg["payment_range"]
        std_min, std_max = cat_cfg["std_dev_range"]
        high_risk_rate = ref_cfg["high_risk_billing_rate"]
        inpatient_only_rate = ref_cfg["inpatient_only_rate"]

        for hcpcs_cd, procedure_desc in pool:
            expected_amt = float(rng.uniform(pay_min, pay_max))
            std_dev = float(rng.uniform(std_min, std_max))
            high_risk = bool(rng.random() < high_risk_rate)

            # Inpatient only only makes sense for surgery category
            if cat_name == "Surgery":
                inpatient_only = bool(rng.random() < inpatient_only_rate * 3)
            else:
                inpatient_only = False

            # Typical specialty assignment
            specialty_map = {
                "E/M":        "Primary_Care",
                "Imaging":    "Radiology",
                "Lab":        "Pathology",
                "Surgery":    "Surgery",
                "Telehealth": "Primary_Care",
                "Injection":  "Primary_Care",
                "Pathology":  "Pathology",
            }

            records.append({
                "hcpcs_cd":              hcpcs_cd,
                "procedure_desc":        procedure_desc,
                "procedure_category":    cat_name,
                "expected_allowed_amt":  round(expected_amt, 2),
                "allowed_amt_std_dev":   round(std_dev, 2),
                "high_risk_billing_flag": high_risk,
                "typical_specialty":     specialty_map.get(cat_name),
                "inpatient_only_flag":   inpatient_only,
            })

    df = pd.DataFrame(records)
    df = df.drop_duplicates(subset=["hcpcs_cd"]).reset_index(drop=True)

    print(f"    Generated {len(df):,} procedure codes across {df['procedure_category'].nunique()} categories.")
    return df


def generate_diagnosis_ref(cfg, ref_cfg: dict, rng: np.random.Generator) -> pd.DataFrame:
    """Generate diagnosis_ref table."""
    print("  Generating diagnosis_ref...")

    records = []

    for body_system, system_data in DIAGNOSIS_POOLS.items():
        codes = system_data["codes"]
        hcc_weight_min, hcc_weight_max = system_data["hcc_weight_range"]
        hcc_category = HCC_CATEGORY_MAP.get(body_system)
        care_pattern = EXPECTED_CARE_PATTERN_MAP.get(body_system)

        for icd10_cd, diagnosis_desc, is_chronic, is_hcc_mapped in codes:
            if is_hcc_mapped:
                hcc_cat = hcc_category
                hcc_weight = round(float(rng.uniform(hcc_weight_min, hcc_weight_max)), 4)
                high_value = bool(hcc_weight >= (hcc_weight_min + hcc_weight_max) / 2)
            else:
                hcc_cat = None
                hcc_weight = None
                high_value = False

            records.append({
                "icd10_cd":               icd10_cd,
                "diagnosis_desc":          diagnosis_desc,
                "hcc_category":            hcc_cat,
                "hcc_weight":              hcc_weight,
                "chronic_flag":            is_chronic,
                "high_value_hcc_flag":     high_value,
                "expected_care_pattern":   care_pattern if is_hcc_mapped else None,
                "body_system":             body_system,
            })

    df = pd.DataFrame(records)
    df = df.drop_duplicates(subset=["icd10_cd"]).reset_index(drop=True)

    hcc_count = df["hcc_category"].notna().sum()
    chronic_count = df["chronic_flag"].sum()
    print(f"    Generated {len(df):,} diagnosis codes across {df['body_system'].nunique()} body systems.")
    print(f"    HCC-mapped: {hcc_count} ({hcc_count/len(df)*100:.1f}%)  |  Chronic: {chronic_count} ({chronic_count/len(df)*100:.1f}%)")
    return df


# ---------------------------------------------------------------------------
# Save helper
# ---------------------------------------------------------------------------

def save_table(df: pd.DataFrame, path: Path, output_format: str) -> None:
    """Save dataframe to parquet or csv."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if output_format == "parquet":
        df.to_parquet(path, index=False)
    else:
        df.to_csv(path, index=False)
    print(f"    Saved → {path}  ({len(df):,} rows)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("\n" + "=" * 60)
    print("generate_reference_tables.py")
    print("=" * 60)

    # Load config
    cfg = load_config()
    summarize_config(cfg)

    # Seed RNG
    rng = np.random.default_rng(cfg.global_settings.random_seed)
    random.seed(cfg.global_settings.random_seed)

    # Get reference table config section
    ref_cfg = cfg.raw["reference_tables"]

    # Ensure output directory exists
    get_output_dir(cfg)

    # --- Generate procedure_ref ---
    procedure_df = generate_procedure_ref(cfg, ref_cfg, rng)
    save_table(procedure_df, cfg.paths.procedure_ref, cfg.global_settings.output_format)

    # --- Generate diagnosis_ref ---
    diagnosis_df = generate_diagnosis_ref(cfg, ref_cfg, rng)
    save_table(diagnosis_df, cfg.paths.diagnosis_ref, cfg.global_settings.output_format)

    # --- Summary ---
    print()
    print("Reference table generation complete.")
    print(f"  procedure_ref : {len(procedure_df):,} rows")
    print(f"  diagnosis_ref : {len(diagnosis_df):,} rows")
    print()

    # --- Quick validation ---
    print("Validation checks:")

    # Procedure ref checks
    assert procedure_df["hcpcs_cd"].is_unique, "FAIL: Duplicate HCPCS codes found"
    assert procedure_df["expected_allowed_amt"].gt(0).all(), "FAIL: Non-positive allowed amounts found"
    assert procedure_df["allowed_amt_std_dev"].gt(0).all(), "FAIL: Non-positive std devs found"
    assert procedure_df["procedure_category"].notna().all(), "FAIL: Null procedure categories found"
    print("  procedure_ref: all checks passed.")

    # Diagnosis ref checks
    assert diagnosis_df["icd10_cd"].is_unique, "FAIL: Duplicate ICD10 codes found"
    hcc_rows = diagnosis_df[diagnosis_df["hcc_category"].notna()]
    assert hcc_rows["hcc_weight"].notna().all(), "FAIL: HCC-mapped rows with null hcc_weight"
    non_hcc_rows = diagnosis_df[diagnosis_df["hcc_category"].isna()]
    assert non_hcc_rows["hcc_weight"].isna().all(), "FAIL: Non-HCC rows with non-null hcc_weight"
    print("  diagnosis_ref: all checks passed.")

    print("\nAll reference table validation checks passed.")
    print("=" * 60)


if __name__ == "__main__":
    main()
    