export type TimeGranularity = 'year' | 'quarter' | 'month';
export type GeoGranularity = 'region' | 'country' | 'city';
export type ProductGranularity = 'category' | 'sub_category' | 'brand';
export type BreakdownDimension =
  | GeoGranularity
  | ProductGranularity
  | 'sales_channel'
  | 'customer_segment';

export interface OlapFilters {
  years: number[];
  regions: string[];
  categories: string[];
  channels: string[];
  segments: string[];
}

export const EMPTY_FILTERS: OlapFilters = {
  years: [],
  regions: [],
  categories: [],
  channels: [],
  segments: [],
};

const TIME_EXPR: Record<TimeGranularity, string> = {
  year: 'CAST(f.order_year AS VARCHAR)',
  quarter: "CAST(f.order_year AS VARCHAR) || '-' || f.order_quarter",
  month: 'f.order_month',
};

const DIMENSION_EXPR: Record<BreakdownDimension, string> = {
  region: 's.region',
  country: 's.country',
  city: 's.city',
  category: 'p.category',
  sub_category: 'p.sub_category',
  brand: 'p.brand',
  sales_channel: 'f.sales_channel',
  customer_segment: 'f.customer_segment',
};

export function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildWhereClause(filters: OlapFilters): string {
  const clauses: string[] = [];

  if (filters.years.length > 0) {
    const safeYears = filters.years
      .filter((y) => Number.isInteger(y))
      .join(', ');
    if (safeYears.length > 0) {
      clauses.push(`f.order_year IN (${safeYears})`);
    }
  }
  if (filters.regions.length > 0) {
    clauses.push(
      `s.region IN (${filters.regions.map(escapeSqlString).join(', ')})`
    );
  }
  if (filters.categories.length > 0) {
    clauses.push(
      `p.category IN (${filters.categories.map(escapeSqlString).join(', ')})`
    );
  }
  if (filters.channels.length > 0) {
    clauses.push(
      `f.sales_channel IN (${filters.channels.map(escapeSqlString).join(', ')})`
    );
  }
  if (filters.segments.length > 0) {
    clauses.push(
      `f.customer_segment IN (${filters.segments.map(escapeSqlString).join(', ')})`
    );
  }

  return clauses.length > 0 ? `WHERE ${clauses.join('\n  AND ')}` : '';
}

const STAR_JOIN = `FROM fact_sales f
JOIN dim_stores s ON f.store_id = s.store_id
JOIN dim_products p ON f.product_id = p.product_id`;

export function buildKpiQuery(filters: OlapFilters): string {
  const where = buildWhereClause(filters);
  return `SELECT
  COUNT(*)::DOUBLE AS order_count,
  COALESCE(SUM(f.quantity), 0)::DOUBLE AS total_units,
  ROUND(COALESCE(SUM(f.revenue), 0), 2)::DOUBLE AS total_revenue,
  ROUND(COALESCE(SUM(f.cost), 0), 2)::DOUBLE AS total_cost,
  ROUND(COALESCE(SUM(f.profit), 0), 2)::DOUBLE AS total_profit,
  ROUND(COALESCE(AVG(f.revenue), 0), 2)::DOUBLE AS avg_order_value,
  ROUND(
    CASE WHEN COALESCE(SUM(f.revenue), 0) = 0 THEN 0
    ELSE (SUM(f.profit) / SUM(f.revenue)) * 100 END,
    2
  )::DOUBLE AS margin_pct
${STAR_JOIN}
${where};`.trim();
}

export function buildTimeSeriesQuery(
  filters: OlapFilters,
  granularity: TimeGranularity
): string {
  const periodExpr = TIME_EXPR[granularity];
  const where = buildWhereClause(filters);
  return `SELECT
  ${periodExpr} AS period,
  ROUND(SUM(f.revenue), 2)::DOUBLE AS revenue,
  ROUND(SUM(f.profit), 2)::DOUBLE AS profit,
  COUNT(*)::DOUBLE AS orders,
  SUM(f.quantity)::DOUBLE AS units
${STAR_JOIN}
${where}
GROUP BY 1
ORDER BY 1 ASC;`.trim();
}

export function buildDimensionBreakdownQuery(
  filters: OlapFilters,
  dimension: BreakdownDimension,
  limit = 12
): string {
  const dimExpr = DIMENSION_EXPR[dimension];
  const where = buildWhereClause(filters);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return `SELECT
  ${dimExpr} AS label,
  ROUND(SUM(f.revenue), 2)::DOUBLE AS revenue,
  ROUND(SUM(f.profit), 2)::DOUBLE AS profit,
  ROUND((SUM(f.profit) / NULLIF(SUM(f.revenue), 0)) * 100, 2)::DOUBLE AS margin_pct,
  COUNT(*)::DOUBLE AS orders
${STAR_JOIN}
${where}
GROUP BY 1
ORDER BY revenue DESC
LIMIT ${safeLimit};`.trim();
}

export function buildRollupCubeQuery(
  filters: OlapFilters,
  geoLevel: GeoGranularity,
  prodLevel: ProductGranularity
): string {
  const geoExpr = DIMENSION_EXPR[geoLevel];
  const prodExpr = DIMENSION_EXPR[prodLevel];
  const where = buildWhereClause(filters);
  return `SELECT
  COALESCE(${geoExpr}, 'ALL (${geoLevel.toUpperCase()})') AS geo_dim,
  COALESCE(${prodExpr}, 'ALL (${prodLevel.toUpperCase()})') AS prod_dim,
  GROUPING(${geoExpr})::INTEGER AS is_geo_total,
  GROUPING(${prodExpr})::INTEGER AS is_prod_total,
  COUNT(*)::DOUBLE AS orders,
  SUM(f.quantity)::DOUBLE AS units,
  ROUND(SUM(f.revenue), 2)::DOUBLE AS revenue,
  ROUND(SUM(f.profit), 2)::DOUBLE AS profit,
  ROUND((SUM(f.profit) / NULLIF(SUM(f.revenue), 0)) * 100, 2)::DOUBLE AS margin_pct
${STAR_JOIN}
${where}
GROUP BY ROLLUP(${geoExpr}, ${prodExpr})
ORDER BY
  is_geo_total ASC,
  geo_dim ASC,
  is_prod_total ASC,
  revenue DESC
LIMIT 60;`.trim();
}

export function buildQuarterlyCrossTabQuery(
  filters: OlapFilters,
  geoLevel: GeoGranularity
): string {
  const geoExpr = DIMENSION_EXPR[geoLevel];
  const where = buildWhereClause(filters);
  return `SELECT
  ${geoExpr} AS geo_dim,
  ROUND(COALESCE(SUM(f.revenue) FILTER (WHERE f.order_quarter = 'Q1'), 0), 2)::DOUBLE AS q1_revenue,
  ROUND(COALESCE(SUM(f.revenue) FILTER (WHERE f.order_quarter = 'Q2'), 0), 2)::DOUBLE AS q2_revenue,
  ROUND(COALESCE(SUM(f.revenue) FILTER (WHERE f.order_quarter = 'Q3'), 0), 2)::DOUBLE AS q3_revenue,
  ROUND(COALESCE(SUM(f.revenue) FILTER (WHERE f.order_quarter = 'Q4'), 0), 2)::DOUBLE AS q4_revenue,
  ROUND(SUM(f.revenue), 2)::DOUBLE AS total_revenue
${STAR_JOIN}
${where}
GROUP BY 1
ORDER BY total_revenue DESC;`.trim();
}

export interface PresetQuery {
  id: string;
  title: string;
  badge: string;
  description: string;
  sql: string;
}

export const OLAP_PRESET_QUERIES: PresetQuery[] = [
  {
    id: 'cube',
    title: 'Multi-Dimensional OLAP CUBE',
    badge: 'GROUP BY CUBE',
    description:
      'Computes all 2^3 = 8 subtotal combinations across Region, Category, and Sales Channel in one vectorized pass.',
    sql: `SELECT
  COALESCE(s.region, '[ALL REGIONS]') AS region,
  COALESCE(p.category, '[ALL CATEGORIES]') AS category,
  COALESCE(f.sales_channel, '[ALL CHANNELS]') AS sales_channel,
  COUNT(*) AS orders,
  ROUND(SUM(f.revenue), 2) AS revenue,
  ROUND(SUM(f.profit), 2) AS profit,
  ROUND(SUM(f.profit) / SUM(f.revenue) * 100, 2) AS margin_pct
FROM fact_sales f
JOIN dim_stores s ON f.store_id = s.store_id
JOIN dim_products p ON f.product_id = p.product_id
GROUP BY CUBE(s.region, p.category, f.sales_channel)
ORDER BY GROUPING(s.region), GROUPING(p.category), GROUPING(f.sales_channel), revenue DESC
LIMIT 40;`,
  },
  {
    id: 'rollup',
    title: 'Hierarchical Time ROLLUP',
    badge: 'GROUP BY ROLLUP',
    description:
      'Drills down from Grand Total -> Year -> Quarter -> Month with automatic hierarchical subtotals.',
    sql: `SELECT
  COALESCE(CAST(f.order_year AS VARCHAR), 'GRAND TOTAL') AS year,
  COALESCE(f.order_quarter, 'Year Subtotal') AS quarter,
  COUNT(*) AS orders,
  SUM(f.quantity) AS units,
  ROUND(SUM(f.revenue), 2) AS revenue,
  ROUND(SUM(f.profit), 2) AS profit
FROM fact_sales f
GROUP BY ROLLUP(f.order_year, f.order_quarter)
ORDER BY f.order_year NULLS LAST, f.order_quarter NULLS LAST;`,
  },
  {
    id: 'pivot',
    title: 'DuckDB Native PIVOT Matrix',
    badge: 'PIVOT',
    description:
      'Cross-tabulates Revenue by Product Category (rows) across Customer Segments (columns) using native PIVOT.',
    sql: `PIVOT (
  SELECT
    p.category,
    f.customer_segment,
    f.revenue
  FROM fact_sales f
  JOIN dim_products p ON f.product_id = p.product_id
)
ON customer_segment
USING ROUND(SUM(revenue), 2)
ORDER BY category;`,
  },
  {
    id: 'window-qualify',
    title: 'Top-3 Products per Region (QUALIFY)',
    badge: 'WINDOW + QUALIFY',
    description:
      'Uses DENSE_RANK() window partitioning and DuckDB QUALIFY clause to isolate the top 3 SKUs in every region.',
    sql: `SELECT
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
ORDER BY s.region, region_rank;`,
  },
  {
    id: 'yoy-growth',
    title: 'Year-over-Year Revenue Growth (LAG)',
    badge: 'TIME INTELLIGENCE',
    description:
      'Computes annual revenue, prior-year revenue via LAG(), and YoY percentage growth per region.',
    sql: `WITH annual AS (
  SELECT
    s.region,
    f.order_year,
    ROUND(SUM(f.revenue), 2) AS revenue
  FROM fact_sales f
  JOIN dim_stores s ON f.store_id = s.store_id
  GROUP BY s.region, f.order_year
)
SELECT
  region,
  order_year,
  revenue,
  LAG(revenue) OVER (PARTITION BY region ORDER BY order_year) AS prev_year_revenue,
  ROUND(
    (revenue - LAG(revenue) OVER (PARTITION BY region ORDER BY order_year))
    / NULLIF(LAG(revenue) OVER (PARTITION BY region ORDER BY order_year), 0) * 100,
    2
  ) AS yoy_growth_pct
FROM annual
ORDER BY region, order_year;`,
  },
];
