"""
src/utils/config_loader.py

Centralized configuration loader for CMS Extrapolation Analytics.
All data generation scripts import from this module.

Usage:
    from src.utils.config_loader import load_config

    cfg = load_config()

    # Access scale parameters (resolves active mode automatically)
    num_beneficiaries = cfg.scale.num_beneficiaries
    num_providers = cfg.scale.num_providers

    # Access global settings
    seed = cfg.global_settings.random_seed
    output_format = cfg.global_settings.output_format

    # Access injection toggles
    inject_anomalies = cfg.injection.inject_anomalies

    # Access output paths
    output_dir = cfg.paths.output_dir
    procedure_ref_path = cfg.paths.procedure_ref
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------

# Config file is always at data_generation/config.yaml relative to repo root.
# This utility lives at src/utils/config_loader.py.
# We resolve the repo root by walking up from this file.

def _find_repo_root() -> Path:
    """Walk up from this file until we find config.yaml in data_generation/."""
    current = Path(__file__).resolve().parent
    for _ in range(6):  # Max 6 levels up
        candidate = current / "data_generation" / "config.yaml"
        if candidate.exists():
            return current
        current = current.parent
    raise FileNotFoundError(
        "Could not locate data_generation/config.yaml. "
        "Ensure you are running from within the cms-extrapolation-analytics repo."
    )


# ---------------------------------------------------------------------------
# Dataclasses — typed wrappers for config sections
# ---------------------------------------------------------------------------

@dataclass
class GlobalSettings:
    random_seed: int
    output_format: str              # "parquet" or "csv"
    output_dir: Path
    date_start: str
    date_end: str
    reference_date: str
    active_mode: str                # "prototype" or "full"


@dataclass
class ScaleParameters:
    num_beneficiaries: int
    num_providers: int
    num_part_a_claims: int
    num_part_b_claim_lines: int
    num_diagnoses_per_claim_min: int
    num_diagnoses_per_claim_max: int
    num_lines_per_claim_min: int
    num_lines_per_claim_max: int


@dataclass
class InjectionSettings:
    inject_anomalies: bool
    inject_duplicates: bool
    inject_outliers: bool
    inject_temporal_drift: bool
    inject_missing_values: bool
    inject_invalid_codes: bool
    inject_suspicious_patterns: bool
    duplicate_claim_rate: float
    duplicate_line_rate: float
    invalid_code_rate: float
    negative_payment_rate: float
    suspicious_daily_volume_multiplier: float
    outlier_payment_multiplier: list[float]
    high_denial_provider_rate: float
    coding_intensity_annual_increase: float
    telehealth_increase_year: str
    telehealth_increase_multiplier: float


@dataclass
class OutputPaths:
    output_dir: Path
    procedure_ref: Path
    diagnosis_ref: Path
    provider_dim: Path
    cclf8: Path
    cclf1: Path
    cclf4: Path
    cclf5: Path
    audit_sample: Path


@dataclass
class CMSConfig:
    """
    Top-level config object returned by load_config().
    Provides clean typed access to all config sections.
    """
    active_mode: str
    global_settings: GlobalSettings
    scale: ScaleParameters
    injection: InjectionSettings
    paths: OutputPaths
    raw: dict[str, Any]             # Full raw config dict for sections not yet wrapped


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

def load_config(config_path: str | Path | None = None) -> CMSConfig:
    """
    Load and resolve config.yaml.

    Args:
        config_path: Optional explicit path to config.yaml.
                     If None, auto-resolves relative to repo root.

    Returns:
        CMSConfig: Fully resolved typed config object.

    Raises:
        FileNotFoundError: If config.yaml cannot be located.
        ValueError: If active_mode is not 'prototype' or 'full'.
        KeyError: If required config sections are missing.
    """
    if config_path is None:
        repo_root = _find_repo_root()
        config_path = repo_root / "data_generation" / "config.yaml"
    else:
        config_path = Path(config_path)

    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    with open(config_path, "r") as f:
        raw = yaml.safe_load(f)

    # --- Resolve active mode ---
    active_mode = raw.get("active_mode", "prototype").strip().lower()
    if active_mode not in ("prototype", "full"):
        raise ValueError(
            f"Invalid active_mode '{active_mode}' in config.yaml. "
            "Must be 'prototype' or 'full'."
        )

    # --- Global settings ---
    g = raw["global"]
    repo_root = _find_repo_root()
    output_dir = repo_root / g["output_dir"] / active_mode

    global_settings = GlobalSettings(
        random_seed=g["random_seed"],
        output_format=g["output_format"],
        output_dir=output_dir,
        date_start=g["date_range"]["start"],
        date_end=g["date_range"]["end"],
        reference_date=g["reference_date"],
        active_mode=active_mode,
    )

    # --- Scale parameters (resolve active mode) ---
    s = raw["scale"][active_mode]
    scale = ScaleParameters(
        num_beneficiaries=s["num_beneficiaries"],
        num_providers=s["num_providers"],
        num_part_a_claims=s["num_part_a_claims"],
        num_part_b_claim_lines=s["num_part_b_claim_lines"],
        num_diagnoses_per_claim_min=s["num_diagnoses_per_claim_min"],
        num_diagnoses_per_claim_max=s["num_diagnoses_per_claim_max"],
        num_lines_per_claim_min=s["num_lines_per_claim_min"],
        num_lines_per_claim_max=s["num_lines_per_claim_max"],
    )

    # --- Injection settings ---
    inj = raw["injection"]
    injection = InjectionSettings(
        inject_anomalies=inj["inject_anomalies"],
        inject_duplicates=inj["inject_duplicates"],
        inject_outliers=inj["inject_outliers"],
        inject_temporal_drift=inj["inject_temporal_drift"],
        inject_missing_values=inj["inject_missing_values"],
        inject_invalid_codes=inj["inject_invalid_codes"],
        inject_suspicious_patterns=inj["inject_suspicious_patterns"],
        duplicate_claim_rate=inj["duplicate_claim_rate"],
        duplicate_line_rate=inj["duplicate_line_rate"],
        invalid_code_rate=inj["invalid_code_rate"],
        negative_payment_rate=inj["negative_payment_rate"],
        suspicious_daily_volume_multiplier=inj["suspicious_daily_volume_multiplier"],
        outlier_payment_multiplier=inj["outlier_payment_multiplier"],
        high_denial_provider_rate=inj["high_denial_provider_rate"],
        coding_intensity_annual_increase=inj["coding_intensity_annual_increase"],
        telehealth_increase_year=str(inj["telehealth_increase_year"]),
        telehealth_increase_multiplier=inj["telehealth_increase_multiplier"],
    )

    # --- Output paths ---
    file_names = raw["output_files"]
    ext = f".{global_settings.output_format}"
    paths = OutputPaths(
        output_dir=output_dir,
        procedure_ref=output_dir / (file_names["procedure_ref"] + ext),
        diagnosis_ref=output_dir / (file_names["diagnosis_ref"] + ext),
        provider_dim=output_dir / (file_names["provider_dim"] + ext),
        cclf8=output_dir / (file_names["cclf8"] + ext),
        cclf1=output_dir / (file_names["cclf1"] + ext),
        cclf4=output_dir / (file_names["cclf4"] + ext),
        cclf5=output_dir / (file_names["cclf5"] + ext),
        audit_sample=output_dir / (file_names["audit_sample"] + ext),
    )

    return CMSConfig(
        active_mode=active_mode,
        global_settings=global_settings,
        scale=scale,
        injection=injection,
        paths=paths,
        raw=raw,
    )


# ---------------------------------------------------------------------------
# Convenience helpers used by generation scripts
# ---------------------------------------------------------------------------

def get_output_dir(cfg: CMSConfig) -> Path:
    """
    Ensure output directory exists and return it.
    Call this at the start of every generation script.
    """
    cfg.paths.output_dir.mkdir(parents=True, exist_ok=True)
    return cfg.paths.output_dir


def get_raw_section(cfg: CMSConfig, section: str) -> dict[str, Any]:
    """
    Access a raw config section by name.
    Use this for sections not yet wrapped in a dataclass
    (e.g. beneficiary, part_a_claims, diagnoses, audit_sample).

    Example:
        bene_cfg = get_raw_section(cfg, "beneficiary")
        age_min = bene_cfg["age_distribution"]["min"]
    """
    if section not in cfg.raw:
        raise KeyError(
            f"Section '{section}' not found in config.yaml. "
            f"Available sections: {list(cfg.raw.keys())}"
        )
    return cfg.raw[section]


def summarize_config(cfg: CMSConfig) -> None:
    """
    Print a human-readable summary of the active config.
    Call at the start of any generation script for confirmation.
    """
    print("=" * 60)
    print("CMS Extrapolation Analytics — Config Summary")
    print("=" * 60)
    print(f"  Active mode       : {cfg.active_mode.upper()}")
    print(f"  Random seed       : {cfg.global_settings.random_seed}")
    print(f"  Output format     : {cfg.global_settings.output_format}")
    print(f"  Output directory  : {cfg.paths.output_dir}")
    print(f"  Date range        : {cfg.global_settings.date_start} → {cfg.global_settings.date_end}")
    print(f"  Reference date    : {cfg.global_settings.reference_date}")
    print()
    print("  Scale parameters:")
    print(f"    Beneficiaries   : {cfg.scale.num_beneficiaries:,}")
    print(f"    Providers       : {cfg.scale.num_providers:,}")
    print(f"    Part A claims   : {cfg.scale.num_part_a_claims:,}")
    print(f"    Part B lines    : {cfg.scale.num_part_b_claim_lines:,}")
    print()
    print("  Injection toggles:")
    print(f"    Anomalies       : {cfg.injection.inject_anomalies}")
    print(f"    Duplicates      : {cfg.injection.inject_duplicates}")
    print(f"    Outliers        : {cfg.injection.inject_outliers}")
    print(f"    Temporal drift  : {cfg.injection.inject_temporal_drift}")
    print(f"    Missing values  : {cfg.injection.inject_missing_values}")
    print(f"    Invalid codes   : {cfg.injection.inject_invalid_codes}")
    print(f"    Suspicious pats : {cfg.injection.inject_suspicious_patterns}")
    print("=" * 60)


# ---------------------------------------------------------------------------
# Standalone validation — run directly to verify config loads correctly
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    cfg = load_config()
    summarize_config(cfg)

    # Verify raw section access
    bene = get_raw_section(cfg, "beneficiary")
    print(f"\n  Beneficiary age range: {bene['age_distribution']['min']}–{bene['age_distribution']['max']}")

    part_a = get_raw_section(cfg, "part_a_claims")
    print(f"  Part A denial rate: {part_a['denial_rate']}")

    print("\n  Config loaded successfully.")
    