import { useState } from 'react';
import { formatCurrency, formatNumber, formatPercent } from '../lib/formatters';

export interface TimeSeriesPoint {
  period: string;
  revenue: number;
  profit: number;
  orders: number;
  units: number;
}

export interface BreakdownPoint {
  label: string;
  revenue: number;
  profit: number;
  margin_pct: number;
  orders: number;
}

export function TimeSeriesChart({ data }: { data: TimeSeriesPoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>
        No data matches the active OLAP slice.
      </div>
    );
  }

  const width = 680;
  const height = 250;
  const padLeft = 58;
  const padRight = 18;
  const padTop = 20;
  const padBottom = 42;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxRev = Math.max(...data.map((d) => d.revenue), 1);
  const stepX = plotW / data.length;
  const barW = Math.max(4, Math.min(34, stepX * 0.62));

  const profitPoints = data
    .map((d, idx) => {
      const x = padLeft + idx * stepX + stepX / 2;
      const y = padTop + plotH - (d.profit / maxRev) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const hovered = hoverIdx !== null ? data[hoverIdx] : null;
  const labelStep = data.length > 18 ? Math.ceil(data.length / 10) : data.length > 10 ? 2 : 1;

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          marginBottom: '0.4rem',
          minHeight: '20px',
        }}
      >
        <div style={{ display: 'flex', gap: '1rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: '#38bdf8',
                display: 'inline-block',
              }}
            />
            Revenue
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span
              style={{
                width: 12,
                height: 3,
                borderRadius: 2,
                background: '#10b981',
                display: 'inline-block',
              }}
            />
            Gross Profit
          </span>
        </div>
        {hovered && (
          <div style={{ color: '#e0f2fe', fontWeight: 500 }}>
            {hovered.period}: {formatCurrency(hovered.revenue, true)} rev ·{' '}
            {formatCurrency(hovered.profit, true)} profit · {formatNumber(hovered.orders)} orders
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = padTop + plotH * (1 - tick);
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="rgba(148,163,184,0.12)"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                fill="#64748b"
                fontSize="10"
              >
                {formatCurrency(maxRev * tick, true)}
              </text>
            </g>
          );
        })}

        {data.map((d, idx) => {
          const xCenter = padLeft + idx * stepX + stepX / 2;
          const barH = Math.max(2, (d.revenue / maxRev) * plotH);
          const y = padTop + plotH - barH;
          const isHover = hoverIdx === idx;
          return (
            <g
              key={d.period}
              onMouseEnter={() => setHoverIdx(idx)}
              style={{ cursor: 'crosshair' }}
            >
              <rect
                x={xCenter - stepX / 2}
                y={padTop}
                width={stepX}
                height={plotH}
                fill="transparent"
              />
              <rect
                x={xCenter - barW / 2}
                y={y}
                width={barW}
                height={barH}
                rx={3}
                fill={isHover ? '#7dd3fc' : 'rgba(56, 189, 248, 0.72)'}
              />
              {idx % labelStep === 0 && (
                <text
                  x={xCenter}
                  y={height - 14}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="10"
                >
                  {d.period}
                </text>
              )}
            </g>
          );
        })}

        <polyline
          fill="none"
          stroke="#10b981"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={profitPoints}
        />

        {data.map((d, idx) => {
          const x = padLeft + idx * stepX + stepX / 2;
          const y = padTop + plotH - (d.profit / maxRev) * plotH;
          return (
            <circle
              key={`pt-${d.period}`}
              cx={x}
              cy={y}
              r={hoverIdx === idx ? 4.5 : 2.6}
              fill="#34d399"
              stroke="#070b14"
              strokeWidth="1"
            />
          );
        })}
      </svg>
    </div>
  );
}

export function HorizontalBarChart({
  data,
  onSelectLabel,
}: {
  data: BreakdownPoint[];
  onSelectLabel?: (label: string) => void;
}) {
  if (data.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>
        No dimension rows available.
      </div>
    );
  }

  const maxRev = Math.max(...data.map((d) => d.revenue), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.62rem' }}>
      {data.map((row) => {
        const pct = Math.max(2, (row.revenue / maxRev) * 100);
        return (
          <div
            key={row.label}
            onClick={() => onSelectLabel?.(row.label)}
            style={{
              cursor: onSelectLabel ? 'pointer' : 'default',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.24rem',
            }}
            title={onSelectLabel ? `Click to filter by ${row.label}` : undefined}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.79rem',
                gap: '0.5rem',
              }}
            >
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                {row.label}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                {formatCurrency(row.revenue, true)}{' '}
                <span style={{ color: '#34d399', fontSize: '0.73rem' }}>
                  ({formatPercent(row.margin_pct)})
                </span>
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: '8px',
                background: 'rgba(148, 163, 184, 0.12)',
                borderRadius: '999px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #0ea5e9, #818cf8)',
                  borderRadius: '999px',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
