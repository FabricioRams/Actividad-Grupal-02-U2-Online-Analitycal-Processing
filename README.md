# ParquetCube — Browser-Native OLAP Studio (DuckDB-WASM + Apache Parquet)

A zero-AWS, browser-native **Online Analytical Processing (OLAP)** workbench powered by **DuckDB-WASM**, **Apache Arrow**, and **ZSTD-compressed Apache Parquet** files, automatically tested, built, and deployed via **GitHub Actions** to **GitHub Pages**.

- **Live Public App**: https://fabriciorams.github.io/Actividad-Grupal-02-U2-Online-Analitycal-Processing/
- **Public Repository**: https://github.com/FabricioRams/Actividad-Grupal-02-U2-Online-Analitycal-Processing

---

## Architecture Overview

Traditional cloud OLAP deployments often lock teams into heavy server clusters or proprietary cloud warehouses. **ParquetCube** demonstrates modern **in-process / edge OLAP** by executing DuckDB's vectorized columnar SQL engine directly inside a browser Web Worker:

1. **Star Schema Storage (`public/data/`)**:
   - `fact_sales.parquet`: **120,000** retail & enterprise transactions (2023–2026) compressed with ZSTD (~3.1 MB).
   - `dim_products.parquet`: Product hierarchy (`category` → `sub_category` → `brand` → `product_name`).
   - `dim_stores.parquet`: Geography hierarchy (`region` → `country` → `city` → `store_name`).
2. **In-Browser OLAP Engine (`src/lib/duckdb.ts`)**:
   - Boots `@duckdb/duckdb-wasm` (`duckdb-eh.wasm` / `duckdb-mvp.wasm`) from self-hosted static assets (`public/duckdb/`).
   - Registers Parquet buffers into DuckDB's virtual filesystem and creates Star Schema views (`fact_sales`, `dim_products`, `dim_stores`).
3. **Interactive OLAP Capabilities**:
   - **Slice & Dice**: Multi-dimensional filtering across Year, Region, Product Category, Sales Channel, and Customer Segment.
   - **Roll-Up & Drill-Down**: Dynamic switching across Time (`year → quarter → month`), Geography (`region → country → city`), and Product (`category → sub_category → brand`).
   - **Native SQL OLAP Operators**: `GROUP BY ROLLUP`, `GROUP BY CUBE`, `PIVOT`, `FILTER (WHERE ...)`, `QUALIFY`, and Window Functions (`DENSE_RANK()`, `LAG()`).
   - **Bring Your Own Data**: Upload local `.parquet` or `.csv` files directly in-browser with zero server round-trips.

---

## Automated CI/CD Pipeline

Every push to `main` triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

1. Installs dependencies (`npm ci`)
2. Runs Vitest unit tests (`npm test`) validating SQL query builders and literal escaping
3. Copies DuckDB-WASM worker/WASM binaries, runs TypeScript strict typechecking (`tsc --noEmit`), and bundles with Vite (`npm run build`)
4. Verifies Parquet & WASM build artifacts
5. Publishes automatically to **GitHub Pages**

---

## Local Development

```bash
# 1. Regenerate the Parquet Star Schema (optional, already committed)
python scripts/generate_olap_data.py

# 2. Install dependencies & start Vite dev server
npm install
npm run dev

# 3. Run unit tests & production build
npm test
npm run build
```
