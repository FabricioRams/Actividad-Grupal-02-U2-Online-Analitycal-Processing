"""Deterministic generator for the Global Retail OLAP Star Schema Parquet dataset.

Generates three Parquet tables in public/data/:
- dim_products.parquet: Product hierarchy (category -> sub_category -> brand -> product)
- dim_stores.parquet: Geography hierarchy (region -> country -> city -> store)
- fact_sales.parquet: 120,000 sales transactions (2023-2026) with measures & time attributes
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


OUTPUT_DIR = Path(__file__).resolve().parent.parent / "public" / "data"


def build_dim_products() -> pd.DataFrame:
    catalog = [
        ("Electronics", "Laptops", "AeroBook", "AeroBook Pro 14", 1299.0, 820.0),
        ("Electronics", "Laptops", "AeroBook", "AeroBook Air 13", 999.0, 610.0),
        ("Electronics", "Laptops", "ZenTech", "ZenTech Workstation 16", 1899.0, 1180.0),
        ("Electronics", "Smartphones", "NovaMobile", "Nova X15 5G", 899.0, 520.0),
        ("Electronics", "Smartphones", "NovaMobile", "Nova Lite 5G", 549.0, 320.0),
        ("Electronics", "Audio", "SoundPulse", "Pulse ANC Headphones", 299.0, 145.0),
        ("Electronics", "Audio", "SoundPulse", "Pulse Studio Earbuds", 179.0, 82.0),
        ("Cloud Hardware", "Edge Servers", "DataForge", "ForgeEdge Node M4", 2450.0, 1490.0),
        ("Cloud Hardware", "Edge Servers", "DataForge", "ForgeRack Mini 8U", 3200.0, 1980.0),
        ("Cloud Hardware", "Storage Arrays", "VaultCore", "VaultNVMe 16TB", 1150.0, 690.0),
        ("Cloud Hardware", "Storage Arrays", "VaultCore", "VaultRAID 64TB", 2790.0, 1650.0),
        ("Cloud Hardware", "Networking", "NetMesh", "MeshSwitch 10GbE", 640.0, 355.0),
        ("Office & Ergonomics", "Standing Desks", "ErgoLift", "ErgoLift Pro Dual", 720.0, 390.0),
        ("Office & Ergonomics", "Chairs", "ErgoLift", "ErgoMesh Task Chair", 540.0, 275.0),
        ("Office & Ergonomics", "Monitors", "OptiView", "OptiView 34 Ultrawide", 790.0, 440.0),
        ("Office & Ergonomics", "Monitors", "OptiView", "OptiView 27 4K", 490.0, 265.0),
        ("Software & SaaS", "BI Licenses", "CubeAnalytics", "CubeStudio Team Seat", 360.0, 48.0),
        ("Software & SaaS", "BI Licenses", "CubeAnalytics", "CubeStudio Enterprise", 1200.0, 140.0),
        ("Software & SaaS", "Data Pipelines", "StreamSync", "StreamSync Pro Annual", 840.0, 110.0),
        ("Software & SaaS", "Security", "ZeroTrust", "ZeroTrust Endpoint Pack", 240.0, 32.0),
    ]
    rows = []
    for idx, (cat, sub, brand, name, list_price, unit_cost) in enumerate(catalog, start=1):
        rows.append(
            {
                "product_id": idx,
                "sku": f"SKU-{1000 + idx}",
                "product_name": name,
                "category": cat,
                "sub_category": sub,
                "brand": brand,
                "list_price": float(list_price),
                "unit_cost": float(unit_cost),
            }
        )
    return pd.DataFrame(rows)


def build_dim_stores() -> pd.DataFrame:
    locations = [
        ("Latin America", "Peru", "Lima", "Lima Miraflores Hub", "Flagship"),
        ("Latin America", "Peru", "Arequipa", "Arequipa Tech Center", "Standard"),
        ("Latin America", "Chile", "Santiago", "Santiago Providencia", "Flagship"),
        ("Latin America", "Colombia", "Bogota", "Bogota Zona T", "Standard"),
        ("Latin America", "Mexico", "Mexico City", "CDMX Polanco", "Flagship"),
        ("North America", "United States", "Austin", "Austin Congress Ave", "Flagship"),
        ("North America", "United States", "Seattle", "Seattle Belltown", "Standard"),
        ("North America", "Canada", "Toronto", "Toronto Downtown", "Flagship"),
        ("Europe", "Spain", "Madrid", "Madrid Castellana", "Flagship"),
        ("Europe", "Germany", "Berlin", "Berlin Mitte", "Flagship"),
        ("Europe", "United Kingdom", "London", "London Shoreditch", "Flagship"),
        ("Europe", "Netherlands", "Amsterdam", "Amsterdam Zuidas", "Standard"),
        ("Asia Pacific", "Japan", "Tokyo", "Tokyo Shibuya", "Flagship"),
        ("Asia Pacific", "Singapore", "Singapore", "Marina Bay Hub", "Flagship"),
        ("Asia Pacific", "Australia", "Sydney", "Sydney Barangaroo", "Standard"),
    ]
    rows = []
    for idx, (region, country, city, name, tier) in enumerate(locations, start=1):
        rows.append(
            {
                "store_id": idx,
                "store_name": name,
                "region": region,
                "country": country,
                "city": city,
                "store_tier": tier,
            }
        )
    return pd.DataFrame(rows)


def build_fact_sales(
    dim_products: pd.DataFrame,
    dim_stores: pd.DataFrame,
    num_rows: int = 120_000,
    seed: int = 20261117,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    start_date = date(2023, 1, 1)
    end_date = date(2026, 10, 31)
    total_days = (end_date - start_date).days + 1

    # Seasonality weights: Q4 lift + steady YoY growth
    all_dates = [start_date + timedelta(days=i) for i in range(total_days)]
    date_weights = np.array(
        [
            (1.0 + 0.14 * (d.year - 2023))
            * (1.28 if d.month in (11, 12) else 1.10 if d.month in (5, 6) else 0.96)
            for d in all_dates
        ],
        dtype=np.float64,
    )
    date_weights /= date_weights.sum()

    date_indices = rng.choice(total_days, size=num_rows, p=date_weights)
    order_dates = pd.to_datetime([all_dates[i] for i in date_indices])

    # Weighted product & store distributions for realistic Pareto patterns
    prod_weights = np.linspace(1.8, 0.6, len(dim_products))
    prod_weights /= prod_weights.sum()
    product_ids = rng.choice(dim_products["product_id"].to_numpy(), size=num_rows, p=prod_weights)

    store_weights = np.where(dim_stores["store_tier"] == "Flagship", 1.5, 0.9)
    store_weights /= store_weights.sum()
    store_ids = rng.choice(dim_stores["store_id"].to_numpy(), size=num_rows, p=store_weights)

    channels = np.array(["Direct Web", "Enterprise Sales", "Partner Marketplace", "Mobile App"])
    channel_probs = np.array([0.38, 0.26, 0.20, 0.16])
    chosen_channels = rng.choice(channels, size=num_rows, p=channel_probs)

    segments = np.array(["Enterprise", "Mid-Market", "SMB", "Consumer"])
    segment_probs = np.array([0.28, 0.30, 0.24, 0.18])
    chosen_segments = rng.choice(segments, size=num_rows, p=segment_probs)

    # Quantities vary by segment
    base_qty = rng.integers(1, 5, size=num_rows)
    segment_boost = np.where(
        chosen_segments == "Enterprise",
        rng.integers(2, 9, size=num_rows),
        np.where(chosen_segments == "Mid-Market", rng.integers(1, 5, size=num_rows), 1),
    )
    quantities = (base_qty * segment_boost).astype(np.int32)

    # Map prices & costs
    price_map = dict(zip(dim_products["product_id"], dim_products["list_price"]))
    cost_map = dict(zip(dim_products["product_id"], dim_products["unit_cost"]))

    unit_prices = np.array([price_map[pid] for pid in product_ids], dtype=np.float64)
    unit_costs = np.array([cost_map[pid] for pid in product_ids], dtype=np.float64)

    # Small price variance (+/- 4%) & discounts
    price_jitter = rng.uniform(0.96, 1.04, size=num_rows)
    unit_prices = np.round(unit_prices * price_jitter, 2)

    discount_choices = np.array([0.0, 0.05, 0.10, 0.15, 0.20])
    discount_probs = np.array([0.52, 0.20, 0.15, 0.09, 0.04])
    discount_pct = rng.choice(discount_choices, size=num_rows, p=discount_probs)

    revenue = np.round(quantities * unit_prices * (1.0 - discount_pct), 2)
    cost = np.round(quantities * unit_costs, 2)
    profit = np.round(revenue - cost, 2)

    df = pd.DataFrame(
        {
            "order_id": np.arange(1, num_rows + 1, dtype=np.int32),
            "order_date": order_dates.date,
            "order_year": order_dates.year.astype(np.int16),
            "order_quarter": ("Q" + order_dates.quarter.astype(str)),
            "order_month": order_dates.strftime("%Y-%m"),
            "store_id": store_ids.astype(np.int16),
            "product_id": product_ids.astype(np.int16),
            "customer_segment": chosen_segments,
            "sales_channel": chosen_channels,
            "quantity": quantities,
            "unit_price": unit_prices,
            "discount_pct": discount_pct,
            "revenue": revenue,
            "cost": cost,
            "profit": profit,
        }
    )
    return df


def write_parquet(df: pd.DataFrame, path: Path) -> None:
    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, path, compression="zstd", row_group_size=30_000)
    size_kb = path.stat().st_size / 1024
    print(f"Wrote {path.name}: {len(df):,} rows ({size_kb:.1f} KB)")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    dim_products = build_dim_products()
    dim_stores = build_dim_stores()
    fact_sales = build_fact_sales(dim_products, dim_stores)

    write_parquet(dim_products, OUTPUT_DIR / "dim_products.parquet")
    write_parquet(dim_stores, OUTPUT_DIR / "dim_stores.parquet")
    write_parquet(fact_sales, OUTPUT_DIR / "fact_sales.parquet")


if __name__ == "__main__":
    main()
