import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  buildDimensionBreakdownQuery,
  buildKpiQuery,
  buildQuarterlyCrossTabQuery,
  buildRollupCubeQuery,
  buildTimeSeriesQuery,
  buildWhereClause,
  escapeSqlString,
} from './olapSql';

describe('olapSql query builders', () => {
  it('escapes single quotes in SQL string literals safely', () => {
    expect(escapeSqlString("O'Reilly")).toBe("'O''Reilly'");
    expect(escapeSqlString('Latin America')).toBe("'Latin America'");
  });

  it('builds an empty WHERE clause for empty filters', () => {
    expect(buildWhereClause(EMPTY_FILTERS)).toBe('');
  });

  it('builds combined slice & dice WHERE predicates and ignores non-integer years', () => {
    const sql = buildWhereClause({
      years: [2025, 2026, Number.NaN],
      regions: ['Latin America', "Cote d'Ivoire"],
      categories: ['Electronics'],
      channels: ['Direct Web'],
      segments: ['Enterprise'],
    });
    expect(sql).toContain('f.order_year IN (2025, 2026)');
    expect(sql).toContain("s.region IN ('Latin America', 'Cote d''Ivoire')");
    expect(sql).toContain("p.category IN ('Electronics')");
    expect(sql).toContain("f.sales_channel IN ('Direct Web')");
    expect(sql).toContain("f.customer_segment IN ('Enterprise')");
  });

  it('builds KPI query referencing Star Schema joins', () => {
    const sql = buildKpiQuery(EMPTY_FILTERS);
    expect(sql).toContain('FROM fact_sales f');
    expect(sql).toContain('JOIN dim_stores s ON f.store_id = s.store_id');
    expect(sql).toContain('JOIN dim_products p ON f.product_id = p.product_id');
    expect(sql).toContain('total_revenue');
    expect(sql).toContain('margin_pct');
  });

  it('supports time granularity roll-up/drill-down', () => {
    expect(buildTimeSeriesQuery(EMPTY_FILTERS, 'year')).toContain(
      'CAST(f.order_year AS VARCHAR) AS period'
    );
    expect(buildTimeSeriesQuery(EMPTY_FILTERS, 'quarter')).toContain(
      "CAST(f.order_year AS VARCHAR) || '-' || f.order_quarter AS period"
    );
    expect(buildTimeSeriesQuery(EMPTY_FILTERS, 'month')).toContain(
      'f.order_month AS period'
    );
  });

  it('builds ROLLUP cube query with GROUPING() indicators', () => {
    const sql = buildRollupCubeQuery(EMPTY_FILTERS, 'country', 'sub_category');
    expect(sql).toContain('GROUP BY ROLLUP(s.country, p.sub_category)');
    expect(sql).toContain('GROUPING(s.country)::INTEGER AS is_geo_total');
    expect(sql).toContain('GROUPING(p.sub_category)::INTEGER AS is_prod_total');
  });

  it('clamps dimension breakdown limits and builds quarterly cross-tab', () => {
    const breakdown = buildDimensionBreakdownQuery(EMPTY_FILTERS, 'brand', 999);
    expect(breakdown).toContain('LIMIT 100');
    expect(breakdown).toContain('p.brand AS label');

    const crossTab = buildQuarterlyCrossTabQuery(EMPTY_FILTERS, 'region');
    expect(crossTab).toContain("FILTER (WHERE f.order_quarter = 'Q1')");
    expect(crossTab).toContain("FILTER (WHERE f.order_quarter = 'Q4')");
  });
});
