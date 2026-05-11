"""
src/utils/notebook_utils.py

Shared utilities for all EDA and analysis notebooks.

Provides:
    - BigQuery client setup with ADC
    - Standard query helper with timing
    - Consistent plot styling
    - Formatting helpers for healthcare analytics context
    - Reusable chart functions used across multiple notebooks
"""

import os
import time
from pathlib import Path
from datetime import datetime

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import seaborn as sns
from google.cloud import bigquery
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Project root and environment
# ---------------------------------------------------------------------------

def get_repo_root() -> Path:
    """Resolve repo root by walking up from this file."""
    current = Path(__file__).resolve().parent
    for _ in range(6):
        if (current / "data_generation" / "config.yaml").exists():
            return current
        current = current.parent
    raise FileNotFoundError("Could not locate repo root.")


def get_project_id() -> str:
    """Load GCP project ID from .env file."""
    repo_root = get_repo_root()
    load_dotenv(repo_root / ".env")
    project_id = os.getenv("GCP_PROJECT_ID")
    if not project_id:
        raise ValueError("GCP_PROJECT_ID not set in .env file.")
    return project_id


# ---------------------------------------------------------------------------
# BigQuery client and query helpers
# ---------------------------------------------------------------------------

def get_bq_client() -> bigquery.Client:
    """
    Initialize BigQuery client using Application Default Credentials.
    Call once at the top of each notebook.
    """
    project_id = get_project_id()
    client = bigquery.Client(project=project_id)
    print(f"BigQuery client initialized — project: {project_id}")
    return client


def query(client: bigquery.Client, sql: str, desc: str = "") -> pd.DataFrame:
    """
    Execute a BigQuery query and return a DataFrame.
    Prints timing and row count for notebook transparency.

    Args:
        client: BigQuery client
        sql: SQL query string
        desc: Optional description for logging

    Returns:
        pd.DataFrame
    """
    label = f"  [{desc}] " if desc else "  "
    start = time.time()
    df = client.query(sql).to_dataframe()
    elapsed = round(time.time() - start, 2)
    print(f"{label}{len(df):,} rows — {elapsed}s")
    return df


def build_query(sql_template: str, project_id: str) -> str:
    """
    Replace dataset template variables with fully qualified names.
    Matches the same template system used in run_sql.py.
    """
    return (
        sql_template
        .replace("{project_id}",  project_id)
        .replace("{raw}",         f"{project_id}.raw_cms_claims")
        .replace("{staging}",     f"{project_id}.staging_cms_claims")
        .replace("{curated}",     f"{project_id}.curated_cms_claims")
        .replace("{analytics}",   f"{project_id}.analytics_cms_claims")
        .replace("{ml}",          f"{project_id}.ml_outputs")
    )


# ---------------------------------------------------------------------------
# Plot styling
# ---------------------------------------------------------------------------

PALETTE_MAIN    = ["#2563EB", "#16A34A", "#DC2626", "#D97706", "#7C3AED", "#0891B2"]
PALETTE_RISK    = {"Normal": "#16A34A", "High_Volume": "#2563EB",
                   "Emerging": "#D97706", "Suspicious": "#DC2626", "Outlier": "#7C3AED"}
PALETTE_DIVERGE = "RdYlGn_r"
COLOR_PRIMARY   = "#2563EB"
COLOR_WARN      = "#DC2626"
COLOR_NEUTRAL   = "#6B7280"


def set_style() -> None:
    """Apply consistent plot style across all notebooks."""
    sns.set_theme(style="whitegrid", palette=PALETTE_MAIN, font_scale=1.05)
    plt.rcParams.update({
        "figure.figsize":       (12, 5),
        "figure.dpi":           110,
        "axes.spines.top":      False,
        "axes.spines.right":    False,
        "axes.titlesize":       13,
        "axes.titleweight":     "bold",
        "axes.labelsize":       11,
        "xtick.labelsize":      10,
        "ytick.labelsize":      10,
        "legend.fontsize":      10,
        "legend.frameon":       False,
    })


def fmt_currency(val: float, decimals: int = 0) -> str:
    """Format a number as USD currency string."""
    if abs(val) >= 1_000_000:
        return f"${val/1_000_000:.1f}M"
    if abs(val) >= 1_000:
        return f"${val/1_000:.1f}K"
    return f"${val:,.{decimals}f}"


def fmt_pct(val: float, decimals: int = 1) -> str:
    """Format a float (0–1) as percentage string."""
    return f"{val * 100:.{decimals}f}%"


def add_value_labels(
    ax,
    fmt: str = "{:.0f}",
    currency: bool = False,
    pct: bool = False,
    fontsize: int = 9,
    padding: float = 0.01,
) -> None:
    """Add value labels on top of bar chart patches."""
    y_max = max(p.get_height() for p in ax.patches if p.get_height() > 0) or 1
    for p in ax.patches:
        h = p.get_height()
        if h <= 0:
            continue
        if currency:
            label = fmt_currency(h)
        elif pct:
            label = fmt_pct(h)
        else:
            label = fmt.format(h)
        ax.annotate(
            label,
            (p.get_x() + p.get_width() / 2, h + y_max * padding),
            ha="center", va="bottom", fontsize=fontsize, color="#374151",
        )


def section_header(title: str, subtitle: str = "") -> None:
    """Print a formatted section header for notebook readability."""
    print("\n" + "=" * 70)
    print(f"  {title}")
    if subtitle:
        print(f"  {subtitle}")
    print("=" * 70)


def finding(text: str) -> None:
    """Print an analytical finding in a consistent format."""
    print(f"\n  📊 FINDING: {text}")


def healthcare_context(text: str) -> None:
    """Print healthcare domain context in a consistent format."""
    print(f"\n  🏥 CONTEXT: {text}")


def observation(text: str) -> None:
    """Print a data observation."""
    print(f"\n  🔍 OBSERVATION: {text}")


# ---------------------------------------------------------------------------
# Reusable chart functions
# ---------------------------------------------------------------------------

def plot_distribution(
    df: pd.DataFrame,
    col: str,
    title: str,
    xlabel: str,
    bins: int = 40,
    log_scale: bool = False,
    color: str = COLOR_PRIMARY,
    vline: float | None = None,
    vline_label: str = "",
) -> None:
    """Plot a histogram with optional log scale and vertical reference line."""
    fig, ax = plt.subplots(figsize=(12, 4))
    data = df[col].dropna()
    if log_scale:
        data = data[data > 0]
        ax.hist(np.log10(data), bins=bins, color=color, alpha=0.80, edgecolor="white")
        ax.set_xlabel(f"{xlabel} (log10 scale)")
    else:
        ax.hist(data, bins=bins, color=color, alpha=0.80, edgecolor="white")
        ax.set_xlabel(xlabel)

    if vline is not None:
        xval = np.log10(vline) if log_scale else vline
        ax.axvline(xval, color=COLOR_WARN, linewidth=1.5, linestyle="--",
                   label=vline_label or f"Mean: {fmt_currency(vline)}")
        ax.legend()

    ax.set_title(title)
    ax.set_ylabel("Count")
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{int(x):,}"))
    plt.tight_layout()
    plt.show()


def plot_bar_categorical(
    df: pd.DataFrame,
    x_col: str,
    y_col: str,
    title: str,
    xlabel: str,
    ylabel: str,
    color: str = COLOR_PRIMARY,
    currency_labels: bool = False,
    pct_labels: bool = False,
    rotate_x: int = 0,
    figsize: tuple = (12, 5),
) -> None:
    """Plot a categorical bar chart with value labels."""
    fig, ax = plt.subplots(figsize=figsize)
    bars = ax.bar(df[x_col].astype(str), df[y_col], color=color, alpha=0.85, edgecolor="white")
    add_value_labels(ax, currency=currency_labels, pct=pct_labels)
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    if rotate_x:
        plt.xticks(rotation=rotate_x, ha="right")
    ax.yaxis.set_major_formatter(
        mticker.FuncFormatter(lambda x, _: fmt_currency(x) if currency_labels else f"{x:,.0f}")
    )
    plt.tight_layout()
    plt.show()


def plot_time_series(
    df: pd.DataFrame,
    x_col: str,
    y_cols: list[str],
    labels: list[str],
    title: str,
    ylabel: str,
    currency_y: bool = False,
    figsize: tuple = (13, 5),
) -> None:
    """Plot one or more time series lines on the same axis."""
    fig, ax = plt.subplots(figsize=figsize)
    for col, label, color in zip(y_cols, labels, PALETTE_MAIN):
        ax.plot(df[x_col].astype(str), df[col], marker="o", linewidth=2,
                markersize=5, label=label, color=color)
    ax.set_title(title)
    ax.set_xlabel("")
    ax.set_ylabel(ylabel)
    ax.legend()
    plt.xticks(rotation=45, ha="right")
    if currency_y:
        ax.yaxis.set_major_formatter(
            mticker.FuncFormatter(lambda x, _: fmt_currency(x))
        )
    plt.tight_layout()
    plt.show()


def plot_heatmap(
    df: pd.DataFrame,
    index_col: str,
    columns_col: str,
    values_col: str,
    title: str,
    fmt: str = ".1f",
    cmap: str = PALETTE_DIVERGE,
    figsize: tuple = (12, 6),
) -> None:
    """Plot a pivot heatmap."""
    pivot = df.pivot_table(index=index_col, columns=columns_col,
                           values=values_col, aggfunc="mean")
    fig, ax = plt.subplots(figsize=figsize)
    sns.heatmap(pivot, annot=True, fmt=fmt, cmap=cmap, linewidths=0.5,
                linecolor="#E5E7EB", ax=ax, cbar_kws={"shrink": 0.8})
    ax.set_title(title)
    plt.tight_layout()
    plt.show()


def plot_scatter(
    df: pd.DataFrame,
    x_col: str,
    y_col: str,
    title: str,
    xlabel: str,
    ylabel: str,
    hue_col: str | None = None,
    hue_palette: dict | None = None,
    annotate_col: str | None = None,
    figsize: tuple = (12, 6),
) -> None:
    """Plot a scatter chart with optional hue and annotations."""
    fig, ax = plt.subplots(figsize=figsize)
    if hue_col:
        palette = hue_palette or PALETTE_MAIN
        for i, (label, group) in enumerate(df.groupby(hue_col)):
            color = palette[label] if isinstance(palette, dict) else PALETTE_MAIN[i % len(PALETTE_MAIN)]
            ax.scatter(group[x_col], group[y_col], label=label,
                      color=color, alpha=0.75, s=60, edgecolors="white", linewidth=0.5)
        ax.legend(title=hue_col.replace("_", " ").title())
    else:
        ax.scatter(df[x_col], df[y_col], color=COLOR_PRIMARY,
                  alpha=0.70, s=60, edgecolors="white", linewidth=0.5)

    if annotate_col:
        for _, row in df.iterrows():
            ax.annotate(str(row[annotate_col]),
                       (row[x_col], row[y_col]),
                       fontsize=7, alpha=0.7,
                       xytext=(4, 4), textcoords="offset points")

    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    plt.tight_layout()
    plt.show()
