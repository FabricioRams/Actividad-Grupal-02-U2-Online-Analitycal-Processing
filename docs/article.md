# Building a Zero-AWS, Browser-Native OLAP Solution with DuckDB-WASM, Apache Parquet, and Automated GitHub Pages Deployment

Online Analytical Processing (**OLAP**) has historically meant provisioning heavy server clusters, managing warehouse nodes, or locking your analytics stack into AWS services like Redshift and S3.

With **DuckDB-WASM** and **Apache Parquet**, we can flip that architecture on its head: ship a columnar **Star Schema** directly to the edge and execute vectorized OLAP queries (`GROUP BY ROLLUP`, `CUBE`, `PIVOT`, window functions, and `QUALIFY`) **100% inside the browser** at millisecond latency—with **zero backend servers** and **zero AWS dependencies**.

In this walkthrough, we build and deploy **ParquetCube OLAP Studio**, an interactive analytics workbench backed by 120,000 sales transactions.

- **Live Deployed App (GitHub Pages):** https://fabriciorams.github.io/Actividad-Grupal-02-U2-Online-Analitycal-Processing/
- **Public GitHub Repository:** https://github.com/FabricioRams/Actividad-Grupal-02-U2-Online-Analitycal-Processing

---

## 1. Why Browser-Native OLAP with DuckDB-WASM?

Traditional OLTP databases (PostgreSQL, MySQL) store data row-by-row, which is great for single-record writes but slow when scanning 100,000+ rows to aggregate revenue across regions and quarters.

**DuckDB** is an in-process columnar OLAP engine. Compiled to **WebAssembly (WASM)** via `@duckdb/duckdb-wasm`, it brings:

- **Vectorized Execution:** Processes columns in CPU cache-friendly vectors rather than tuple-by-tuple.
- **Native Parquet Predicate & Projection Pushdown:** Reads only the columns needed from ZSTD-compressed `.parquet` files.
- **Full Analytical SQL Dialect:** Supports `GROUP BY CUBE`, `GROUP BY ROLLUP`, `PIVOT`, `FILTER (WHERE ...)`, `QUALIFY`, and `parquet_metadata()`.
- **Zero Cloud Lock-In (No AWS):** Everything runs on static edge hosting (GitHub Pages) + the user's browser Web Worker.

```
+-------------------------------------------------------------------+
|  Browser (React + TypeScript + Vite)                              |
|                                                                   |
|  +-----------------------+     +-------------------------------+  |
|  | OLAP Cube Explorer    |     | SQL Workbench & Schema View   |  |
|  | Slice/Dice/Rollup UI  |     | CUBE, PIVOT, QUALIFY, Upload  |  |
|  +-----------+-----------+     +---------------+---------------+  |
|              |                                 |                  |
|              +----------------+----------------+                  |
|                               v                                   |
|  +-------------------------------------------------------------+  |
|  | DuckDB-WASM Web Worker (duckdb-eh.wasm / Apache Arrow)      |  |
|  | Virtual FS: fact_sales.parquet, dim_products, dim_stores    |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

---

## 2. Designing the Star Schema in Apache Parquet

An OLAP solution starts with a **Star Schema**: one central **fact table** surrounded by denormalized **dimension tables** for hierarchies.

In [`scripts/generate_olap_data.py`](https://github.com/FabricioRams/Actividad-Grupal-02-U2-Online-Analitycal-Processing/blob/main/scripts/generate_olap_data.py), we generate three ZSTD-compressed Parquet files using Python (`pyarrow` + `pandas`):

- **`fact_sales.parquet`** (120,000 rows, ~3.1 MB): `order_id`, `order_date`, `order_year`, `order_quarter`, `order_month`, `store_id`, `product_id`, `customer_segment`, `sales_channel`, `quantity`, `unit_price`, `discount_pct`, `revenue`, `cost`, `profit`.
- **`dim_products.parquet`** (20 rows): Product hierarchy (`category -> sub_category -> brand -> product_name`).
- **`dim_stores.parquet`** (15 rows): Geography hierarchy (`region -> country -> city -> store_name`).

```python
def write_parquet(df: pd.DataFrame, path: Path) -> None:
    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, path, compression="zstd", row_group_size=30_000)
```

Using `compression="zstd"` shrinks 120,000 fact rows down to ~3.1 MB, making initial browser fetch fast even on modest connections.

---

## 3. Booting DuckDB-WASM in a Web Worker

To avoid external CDN failures and guarantee reliable execution on GitHub Pages, we copy the DuckDB WASM and worker binaries (`duckdb-eh.wasm`, `duckdb-browser-eh.worker.js`, `duckdb-mvp.wasm`, `duckdb-browser-mvp.worker.js`) into `public/duckdb/` during build via `scripts/copy-duckdb-assets.mjs`.

In [`src/lib/duckdb.ts`](https://github.com/FabricioRams/Actividad-Grupal-02-U2-Online-Analitycal-Processing/blob/main/src/lib/duckdb.ts), we instantiate `AsyncDuckDB`, load the three Parquet files into DuckDB's virtual file system, and expose them as SQL views:

```typescript
async function registerParquetTable(
  db: duckdb.AsyncDuckDB,
  conn: duckdb.AsyncDuckDBConnection,
  tableName: string,
  fileUrl: string
): Promise<void> {
  const response = await fetch(fileUrl);
  const buffer = new Uint8Array(await response.arrayBuffer());
  const virtualPath = `${tableName}.parquet`;
  await db.registerFileBuffer(virtualPath, buffer);
  await conn.query(
    `CREATE OR REPLACE VIEW ${tableName} AS SELECT * FROM read_parquet('${virtualPath}');`
  );
}
```

Users can also upload their own `.parquet` or `.csv` files directly into the browser via `registerUploadedFile()` without sending data to any external server.

---

## 4. Implementing Core OLAP Operations in SQL

Our query builder module ([`src/lib/olapSql.ts`](https://github.com/FabricioRams/Actividad-Grupal-02-U2-Online-Analitycal-Processing/blob/main/src/lib/olapSql.ts)) translates UI interactions into parameterized OLAP SQL:

### Slice & Dice + Hierarchical `ROLLUP`

When the user switches Geography (`region -> country -> city`) or Product (`category -> sub_category -> brand`) granularity, DuckDB computes hierarchical subtotals and the grand total in a single query:

```sql
SELECT
  COALESCE(s.region, 'ALL (REGION)') AS geo_dim,
  COALESCE(p.category, 'ALL (CATEGORY)') AS prod_dim,
  GROUPING(s.region)::INTEGER AS is_geo_total,
  GROUPING(p.category)::INTEGER AS is_prod_total,
  COUNT(*)::DOUBLE AS orders,
  SUM(f.quantity)::DOUBLE AS units,
  ROUND(SUM(f.revenue), 2)::DOUBLE AS revenue,
  ROUND(SUM(f.profit), 2)::DOUBLE AS profit,
  ROUND((SUM(f.profit) / NULLIF(SUM(f.revenue), 0)) * 100, 2)::DOUBLE AS margin_pct
FROM fact_sales f
JOIN dim_stores s ON f.store_id = s.store_id
JOIN dim_products p ON f.product_id = p.product_id
GROUP BY ROLLUP(s.region, p.category)
ORDER BY is_geo_total ASC, geo_dim ASC, is_prod_total ASC, revenue DESC;
```

### Multi-Dimensional `CUBE`, `PIVOT`, and `QUALIFY`

In the **SQL Workbench**, users can run presets showcasing DuckDB's analytical power:

```sql
-- Top-3 performing products in each region using Window Functions + QUALIFY
SELECT
  s.region,
  p.product_name,
  p.category,
  COUNT(*) AS orders,
  ROUND(SUM(f.revenue), 2) AS revenue,
  DENSE_RANK() OVER (PARTITION BY s.region ORDER BY SUM(f.revenue) DESC) AS region_rank
FROM fact_sales f
JOIN dim_stores s ON f.store_id = s.store_id
JOIN dim_products p ON f.product_id = p.product_id
GROUP BY s.region, p.product_name, p.category
QUALIFY region_rank <= 3
ORDER BY s.region, region_rank;
```

---

## 5. Automated Testing & CI/CD Deployment to GitHub Pages

We automated testing, typechecking, asset bundling, and public SaaS deployment using **GitHub Actions** ([`.github/workflows/deploy.yml`](https://github.com/FabricioRams/Actividad-Grupal-02-U2-Online-Analitycal-Processing/blob/main/.github/workflows/deploy.yml)):

1. **Unit Tests (`vitest`)**: Validates SQL escaping, Slice & Dice `WHERE` generation, `ROLLUP` queries, and granularity mapping (`src/lib/olapSql.test.ts`).
2. **TypeScript & Vite Build**: Copies DuckDB-WASM binaries, checks strict types (`tsc --noEmit`), and bundles static assets with the GitHub Pages base path.
3. **Artifact Verification & Pages Deployment**: Verifies `.parquet` and `.wasm` files exist in `dist/`, configures GitHub Pages, and publishes via `actions/deploy-pages@v4`.

```yaml
- name: Run unit tests (Vitest)
  run: npm test

- name: Typecheck & build production bundle
  run: npm run build

- name: Setup GitHub Pages
  uses: actions/configure-pages@v5

- name: Deploy to GitHub Pages
  uses: actions/deploy-pages@v4
```

Every `git push` to `main` automatically validates and deploys the updated OLAP studio to production.

---

## Conclusion

By pairing **Apache Parquet** with **DuckDB-WASM** and **GitHub Pages**, teams can ship responsive, zero-AWS OLAP solutions with full SQL expressiveness (`CUBE`, `ROLLUP`, `PIVOT`, window analytics) and zero server maintenance overhead.

Try the live application here: **https://fabriciorams.github.io/Actividad-Grupal-02-U2-Online-Analitycal-Processing/**
