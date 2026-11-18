import { useEffect, useState } from 'react';
import { Download, Play, Sparkles, Terminal } from 'lucide-react';
import { type QueryResult, runQuery } from '../lib/duckdb';
import { formatCellValue } from '../lib/formatters';
import { OLAP_PRESET_QUERIES } from '../lib/olapSql';

export function SqlWorkbench({ initialSql }: { initialSql?: string | null }) {
  const [sql, setSql] = useState<string>(
    initialSql || OLAP_PRESET_QUERIES[0].sql
  );
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSql) {
      setSql(initialSql);
    }
  }, [initialSql]);

  async function execute(queryText = sql) {
    setRunning(true);
    setError(null);
    try {
      const res = await runQuery(queryText);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void execute(initialSql || OLAP_PRESET_QUERIES[0].sql);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function downloadCsv() {
    if (!result) return;
    const header = result.columns.join(',');
    const lines = result.rows.map((row) =>
      result.columns
        .map((col) => {
          const val = row[col];
          const text = val === null || val === undefined ? '' : String(val);
          return `"${text.replace(/"/g, '""')}"`;
        })
        .join(',')
    );
    const blob = new Blob([[header, ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'olap_query_result.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadJson() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.rows, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'olap_query_result.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Sparkles size={16} color="var(--accent-cyan)" />
            OLAP SQL Presets (DuckDB Dialect)
          </h2>
          <span className="card-meta">Click any preset to load &amp; execute</span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {OLAP_PRESET_QUERIES.map((preset) => (
            <button
              key={preset.id}
              onClick={() => {
                setSql(preset.sql);
                void execute(preset.sql);
              }}
              style={{
                textAlign: 'left',
                padding: '0.75rem 0.9rem',
                borderRadius: 10,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-canvas)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '0.84rem' }}>
                  {preset.title}
                </span>
                <span className="pill pill-cyan" style={{ fontSize: '0.68rem' }}>
                  {preset.badge}
                </span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {preset.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Terminal size={16} color="var(--accent-emerald)" />
            Interactive DuckDB SQL Editor
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className="card-meta">Ctrl + Enter to run</span>
            <button
              className="btn btn-primary"
              onClick={() => void execute()}
              disabled={running}
            >
              <Play size={14} /> {running ? 'Running...' : 'Run Query'}
            </button>
          </div>
        </div>

        <textarea
          className="sql-editor"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              void execute();
            }
          }}
          spellCheck={false}
        />

        {error && (
          <div className="error-banner" style={{ marginTop: '0.75rem' }}>
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
              <h3 className="card-title">Query Output</h3>
              <span className="pill pill-emerald">{result.durationMs} ms</span>
              <span className="pill">{result.rowCount.toLocaleString()} rows</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn" onClick={downloadCsv}>
                <Download size={14} /> CSV
              </button>
              <button className="btn" onClick={downloadJson}>
                <Download size={14} /> JSON
              </button>
            </div>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {result.columns.map((col, idx) => (
                    <th key={col}>
                      <div>{col}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                        {result.columnTypes[idx]}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 500).map((row, rIdx) => (
                  <tr key={rIdx}>
                    {result.columns.map((col) => {
                      const val = row[col];
                      const isNum = typeof val === 'number' || typeof val === 'bigint';
                      return (
                        <td key={col} className={isNum ? 'num' : undefined}>
                          {formatCellValue(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
