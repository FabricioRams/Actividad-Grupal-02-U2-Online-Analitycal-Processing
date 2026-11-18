import { useEffect, useMemo, useState } from 'react';
import {
  Code2,
  Filter,
  Layers,
  RotateCcw,
  SlidersHorizontal,
  Table2,
  TrendingUp,
} from 'lucide-react';
import { runQuery } from '../lib/duckdb';
import { formatCurrency, formatNumber, formatPercent } from '../lib/formatters';
import {
  type BreakdownDimension,
  EMPTY_FILTERS,
  type GeoGranularity,
  type OlapFilters,
  type ProductGranularity,
  type TimeGranularity,
  buildDimensionBreakdownQuery,
  buildKpiQuery,
  buildQuarterlyCrossTabQuery,
  buildRollupCubeQuery,
  buildTimeSeriesQuery,
} from '../lib/olapSql';
import {
  type BreakdownPoint,
  HorizontalBarChart,
  TimeSeriesChart,
  type TimeSeriesPoint,
} from './Charts';

interface KpiSummary {
  order_count: number;
  total_units: number;
  total_revenue: number;
  total_cost: number;
  total_profit: number;
  avg_order_value: number;
  margin_pct: number;
}

interface RollupRow {
  geo_dim: string;
  prod_dim: string;
  is_geo_total: number;
  is_prod_total: number;
  orders: number;
  units: number;
  revenue: number;
  profit: number;
  margin_pct: number;
}

interface CrossTabRow {
  geo_dim: string;
  q1_revenue: number;
  q2_revenue: number;
  q3_revenue: number;
  q4_revenue: number;
  total_revenue: number;
}

interface FilterOptions {
  years: number[];
  regions: string[];
  categories: string[];
  channels: string[];
  segments: string[];
}

export function CubeExplorer({
  onOpenSql,
}: {
  onOpenSql: (sql: string) => void;
}) {
  const [options, setOptions] = useState<FilterOptions>({
    years: [2023, 2024, 2025, 2026],
    regions: [],
    categories: [],
    channels: [],
    segments: [],
  });
  const [filters, setFilters] = useState<OlapFilters>(EMPTY_FILTERS);
  const [timeGranularity, setTimeGranularity] = useState<TimeGranularity>('quarter');
  const [geoGranularity, setGeoGranularity] = useState<GeoGranularity>('region');
  const [prodGranularity, setProdGranularity] =
    useState<ProductGranularity>('category');
  const [breakdownDim, setBreakdownDim] =
    useState<BreakdownDimension>('category');

  const [kpi, setKpi] = useState<KpiSummary | null>(null);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[]>([]);
  const [breakdown, setBreakdown] = useState<BreakdownPoint[]>([]);
  const [rollupRows, setRollupRows] = useState<RollupRow[]>([]);
  const [crossTabRows, setCrossTabRows] = useState<CrossTabRow[]>([]);
  const [totalQueryMs, setTotalQueryMs] = useState<number>(0);
  const [showSql, setShowSql] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadDimensions() {
      try {
        const [yRes, rRes, cRes, chRes, segRes] = await Promise.all([
          runQuery('SELECT DISTINCT order_year FROM fact_sales ORDER BY 1;'),
          runQuery('SELECT DISTINCT region FROM dim_stores ORDER BY 1;'),
          runQuery('SELECT DISTINCT category FROM dim_products ORDER BY 1;'),
          runQuery('SELECT DISTINCT sales_channel FROM fact_sales ORDER BY 1;'),
          runQuery('SELECT DISTINCT customer_segment FROM fact_sales ORDER BY 1;'),
        ]);
        if (!active) return;
        setOptions({
          years: yRes.rows.map((r) => Number(r.order_year)),
          regions: rRes.rows.map((r) => String(r.region)),
          categories: cRes.rows.map((r) => String(r.category)),
          channels: chRes.rows.map((r) => String(r.sales_channel)),
          segments: segRes.rows.map((r) => String(r.customer_segment)),
        });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void loadDimensions();
    return () => {
      active = false;
    };
  }, []);

  const generatedQueries = useMemo(
    () => ({
      kpi: buildKpiQuery(filters),
      timeSeries: buildTimeSeriesQuery(filters, timeGranularity),
      breakdown: buildDimensionBreakdownQuery(filters, breakdownDim, 10),
      rollup: buildRollupCubeQuery(filters, geoGranularity, prodGranularity),
      crossTab: buildQuarterlyCrossTabQuery(filters, geoGranularity),
    }),
    [filters, timeGranularity, breakdownDim, geoGranularity, prodGranularity]
  );

  useEffect(() => {
    let active = true;
    async function refreshCube() {
      setError(null);
      try {
        const [kpiRes, tsRes, bdRes, ruRes, ctRes] = await Promise.all([
          runQuery(generatedQueries.kpi),
          runQuery(generatedQueries.timeSeries),
          runQuery(generatedQueries.breakdown),
          runQuery(generatedQueries.rollup),
          runQuery(generatedQueries.crossTab),
        ]);
        if (!active) return;

        setKpi((kpiRes.rows[0] as unknown as KpiSummary) ?? null);
        setTimeSeries(tsRes.rows as unknown as TimeSeriesPoint[]);
        setBreakdown(bdRes.rows as unknown as BreakdownPoint[]);
        setRollupRows(ruRes.rows as unknown as RollupRow[]);
        setCrossTabRows(ctRes.rows as unknown as CrossTabRow[]);
        setTotalQueryMs(
          Math.round(
            (kpiRes.durationMs +
              tsRes.durationMs +
              bdRes.durationMs +
              ruRes.durationMs +
              ctRes.durationMs) *
              10
          ) / 10
        );
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void refreshCube();
    return () => {
      active = false;
    };
  }, [generatedQueries]);

  function toggleValue<K extends keyof OlapFilters>(
    key: K,
    val: OlapFilters[K][number]
  ) {
    setFilters((prev) => {
      const list = prev[key] as Array<OlapFilters[K][number]>;
      const exists = list.includes(val);
      return {
        ...prev,
        [key]: exists ? list.filter((item) => item !== val) : [...list, val],
      };
    });
  }

  const activeFilterCount =
    filters.years.length +
    filters.regions.length +
    filters.categories.length +
    filters.channels.length +
    filters.segments.length;

  return (
    <div className="cube-layout">
      <aside className="sidebar card">
        <div className="card-header" style={{ marginBottom: '0.25rem' }}>
          <h2 className="card-title">
            <Filter size={16} color="var(--accent-cyan)" />
            Slice &amp; Dice Filters
          </h2>
          {activeFilterCount > 0 && (
            <button
              className="btn"
              style={{ padding: '0.22rem 0.5rem', fontSize: '0.72rem' }}
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              <RotateCcw size={12} /> Reset ({activeFilterCount})
            </button>
          )}
        </div>

        <div className="filter-group">
          <span className="filter-label">Fiscal Year</span>
          <div className="chip-wrap">
            {options.years.map((y) => (
              <button
                key={y}
                className={`chip ${filters.years.includes(y) ? 'selected' : ''}`}
                onClick={() => toggleValue('years', y)}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">Region</span>
          <div className="chip-wrap">
            {options.regions.map((r) => (
              <button
                key={r}
                className={`chip ${filters.regions.includes(r) ? 'selected' : ''}`}
                onClick={() => toggleValue('regions', r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">Product Category</span>
          <div className="chip-wrap">
            {options.categories.map((c) => (
              <button
                key={c}
                className={`chip ${filters.categories.includes(c) ? 'selected' : ''}`}
                onClick={() => toggleValue('categories', c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">Sales Channel</span>
          <div className="chip-wrap">
            {options.channels.map((ch) => (
              <button
                key={ch}
                className={`chip ${filters.channels.includes(ch) ? 'selected' : ''}`}
                onClick={() => toggleValue('channels', ch)}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">Customer Segment</span>
          <div className="chip-wrap">
            {options.segments.map((seg) => (
              <button
                key={seg}
                className={`chip ${filters.segments.includes(seg) ? 'selected' : ''}`}
                onClick={() => toggleValue('segments', seg)}
              >
                {seg}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
        {error && <div className="error-banner">{error}</div>}

        <div className="control-bar">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.85rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <SlidersHorizontal size={14} color="var(--accent-cyan)" />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Time:</span>
              <div className="seg-group">
                {(['year', 'quarter', 'month'] as TimeGranularity[]).map((g) => (
                  <button
                    key={g}
                    className={`seg-btn ${timeGranularity === g ? 'active' : ''}`}
                    onClick={() => setTimeGranularity(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Geo:</span>
              <div className="seg-group">
                {(['region', 'country', 'city'] as GeoGranularity[]).map((g) => (
                  <button
                    key={g}
                    className={`seg-btn ${geoGranularity === g ? 'active' : ''}`}
                    onClick={() => setGeoGranularity(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Product:
              </span>
              <div className="seg-group">
                {(['category', 'sub_category', 'brand'] as ProductGranularity[]).map(
                  (g) => (
                    <button
                      key={g}
                      className={`seg-btn ${prodGranularity === g ? 'active' : ''}`}
                      onClick={() => setProdGranularity(g)}
                    >
                      {g.replace('_', ' ')}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="pill pill-emerald">5 OLAP queries in {totalQueryMs} ms</span>
            <button className="btn" onClick={() => setShowSql((s) => !s)}>
              <Code2 size={14} /> {showSql ? 'Hide SQL' : 'Inspect SQL'}
            </button>
          </div>
        </div>

        {showSql && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <Code2 size={15} color="var(--accent-cyan)" /> Generated DuckDB OLAP SQL (ROLLUP)
              </h3>
              <button
                className="btn btn-primary"
                style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
                onClick={() => onOpenSql(generatedQueries.rollup)}
              >
                Open in SQL Workbench
              </button>
            </div>
            <pre className="sql-preview">{generatedQueries.rollup}</pre>
          </div>
        )}

        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Total Revenue</div>
            <div className="kpi-value" style={{ color: 'var(--accent-cyan)' }}>
              {kpi ? formatCurrency(kpi.total_revenue, true) : '—'}
            </div>
            <div className="kpi-sub">
              {kpi ? formatCurrency(kpi.total_revenue) : ''}
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">Gross Profit</div>
            <div className="kpi-value" style={{ color: 'var(--accent-emerald)' }}>
              {kpi ? formatCurrency(kpi.total_profit, true) : '—'}
            </div>
            <div className="kpi-sub">
              Margin: {kpi ? formatPercent(kpi.margin_pct) : '—'}
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">Orders Scanned</div>
            <div className="kpi-value">{kpi ? formatNumber(kpi.order_count) : '—'}</div>
            <div className="kpi-sub">
              Avg Order: {kpi ? formatCurrency(kpi.avg_order_value) : '—'}
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">Units Sold</div>
            <div className="kpi-value" style={{ color: 'var(--accent-indigo)' }}>
              {kpi ? formatNumber(kpi.total_units, true) : '—'}
            </div>
            <div className="kpi-sub">
              {kpi ? `${formatNumber(kpi.total_units)} units` : ''}
            </div>
          </div>
        </div>

        <div className="charts-grid">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <TrendingUp size={16} color="var(--accent-cyan)" />
                Time Roll-Up ({timeGranularity.toUpperCase()})
              </h3>
              <span className="card-meta">{timeSeries.length} periods</span>
            </div>
            <TimeSeriesChart data={timeSeries} />
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <Layers size={16} color="var(--accent-indigo)" />
                Dimension Breakdown
              </h3>
              <select
                value={breakdownDim}
                onChange={(e) => setBreakdownDim(e.target.value as BreakdownDimension)}
                style={{
                  background: 'var(--bg-canvas)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  padding: '0.25rem 0.45rem',
                  fontSize: '0.76rem',
                }}
              >
                <option value="category">Category</option>
                <option value="sub_category">Sub-Category</option>
                <option value="brand">Brand</option>
                <option value="region">Region</option>
                <option value="country">Country</option>
                <option value="sales_channel">Sales Channel</option>
                <option value="customer_segment">Customer Segment</option>
              </select>
            </div>
            <HorizontalBarChart data={breakdown} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Table2 size={16} color="var(--accent-emerald)" />
              Quarterly Revenue Cross-Tab ({geoGranularity.toUpperCase()} × Quarter)
            </h3>
            <span className="card-meta">Computed via DuckDB FILTER (WHERE ...)</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{geoGranularity.toUpperCase()}</th>
                  <th className="num">Q1 Revenue</th>
                  <th className="num">Q2 Revenue</th>
                  <th className="num">Q3 Revenue</th>
                  <th className="num">Q4 Revenue</th>
                  <th className="num">Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                {crossTabRows.map((row) => (
                  <tr key={row.geo_dim}>
                    <td style={{ fontWeight: 500 }}>{row.geo_dim}</td>
                    <td className="num">{formatCurrency(row.q1_revenue)}</td>
                    <td className="num">{formatCurrency(row.q2_revenue)}</td>
                    <td className="num">{formatCurrency(row.q3_revenue)}</td>
                    <td className="num">{formatCurrency(row.q4_revenue)}</td>
                    <td className="num" style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>
                      {formatCurrency(row.total_revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Layers size={16} color="var(--accent-cyan)" />
              OLAP Cube Matrix: GROUP BY ROLLUP({geoGranularity}, {prodGranularity})
            </h3>
            <span className="card-meta">Includes subtotals &amp; grand total</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Geography ({geoGranularity})</th>
                  <th>Product ({prodGranularity.replace('_', ' ')})</th>
                  <th className="num">Orders</th>
                  <th className="num">Units</th>
                  <th className="num">Revenue</th>
                  <th className="num">Profit</th>
                  <th className="num">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {rollupRows.map((row, idx) => {
                  const isGrand = row.is_geo_total === 1 && row.is_prod_total === 1;
                  const isSub = !isGrand && (row.is_geo_total === 1 || row.is_prod_total === 1);
                  return (
                    <tr
                      key={`${row.geo_dim}-${row.prod_dim}-${idx}`}
                      className={
                        isGrand ? 'grandtotal-row' : isSub ? 'subtotal-row' : undefined
                      }
                    >
                      <td>{row.geo_dim}</td>
                      <td>{row.prod_dim}</td>
                      <td className="num">{formatNumber(row.orders)}</td>
                      <td className="num">{formatNumber(row.units)}</td>
                      <td className="num">{formatCurrency(row.revenue)}</td>
                      <td className="num">{formatCurrency(row.profit)}</td>
                      <td className="num">{formatPercent(row.margin_pct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
