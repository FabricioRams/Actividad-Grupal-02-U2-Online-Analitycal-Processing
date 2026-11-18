import { useEffect, useState } from 'react';
import { Database, FileSpreadsheet, HardDrive, Upload } from 'lucide-react';
import { registerUploadedFile, runQuery } from '../lib/duckdb';
import { formatCellValue } from '../lib/formatters';

interface TableSummary {
  name: string;
  role: string;
  rows: number;
  columns: { column_name: string; column_type: string }[];
}

export function SchemaExplorer({
  onRunTableSql,
}: {
  onRunTableSql: (sql: string) => void;
}) {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [parquetMeta, setParquetMeta] = useState<Record<string, unknown>[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadCatalog() {
    try {
      const showRes = await runQuery('SHOW TABLES;');
      const tableNames = showRes.rows.map((r) => String(r.name));

      const summaries = await Promise.all(
        tableNames.map(async (name) => {
          const [cntRes, descRes] = await Promise.all([
            runQuery(`SELECT COUNT(*)::DOUBLE AS cnt FROM "${name}";`),
            runQuery(`DESCRIBE "${name}";`),
          ]);
          const role =
            name === 'fact_sales'
              ? 'Fact Table (Measures & Foreign Keys)'
              : name.startsWith('dim_')
              ? 'Dimension Table (Hierarchies)'
              : 'Custom Uploaded Table';
          return {
            name,
            role,
            rows: Number(cntRes.rows[0]?.cnt ?? 0),
            columns: descRes.rows.map((r) => ({
              column_name: String(r.column_name),
              column_type: String(r.column_type),
            })),
          };
        })
      );
      setTables(summaries);

      const metaRes = await runQuery(`
        SELECT
          row_group_id,
          row_group_num_rows,
          column_id,
          path_in_schema,
          type,
          compression,
          total_compressed_size,
          total_uncompressed_size
        FROM parquet_metadata('fact_sales.parquet')
        WHERE row_group_id = 0
        ORDER BY column_id;
      `);
      setParquetMeta(metaRes.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  async function handleFileUpload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploadStatus(`Loading ${file.name} into DuckDB-WASM...`);
    try {
      const viewName = await registerUploadedFile(file);
      setUploadStatus(
        `Registered view "${viewName}" from ${file.name}. Ready for OLAP SQL queries!`
      );
      await loadCatalog();
    } catch (err) {
      setUploadStatus(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Upload size={16} color="var(--accent-cyan)" />
            Bring Your Own Parquet / CSV (Zero-Server Upload)
          </h2>
          <span className="pill pill-emerald">Processed 100% locally in WebAssembly</span>
        </div>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
          Register any local <code>.parquet</code> or <code>.csv</code> file directly into the
          in-browser DuckDB Virtual File System and query it immediately with SQL OLAP operators.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            <FileSpreadsheet size={15} /> Select .parquet or .csv
            <input
              type="file"
              accept=".parquet,.csv"
              style={{ display: 'none' }}
              onChange={(e) => void handleFileUpload(e.target.files?.[0])}
            />
          </label>
          {uploadStatus && (
            <span style={{ fontSize: '0.82rem', color: '#34d399' }}>{uploadStatus}</span>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
          gap: '1rem',
        }}
      >
        {tables.map((t) => (
          <div key={t.name} className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <Database size={15} color="var(--accent-indigo)" />
                  {t.name}
                </h3>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{t.role}</div>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <span className="pill">{t.rows.toLocaleString()} rows</span>
                <button
                  className="btn"
                  style={{ padding: '0.25rem 0.55rem', fontSize: '0.74rem' }}
                  onClick={() => onRunTableSql(`SUMMARIZE SELECT * FROM "${t.name}";`)}
                >
                  SUMMARIZE
                </button>
              </div>
            </div>
            <div className="table-scroll" style={{ maxHeight: 260 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>DuckDB Type</th>
                  </tr>
                </thead>
                <tbody>
                  {t.columns.map((c) => (
                    <tr key={c.column_name}>
                      <td style={{ fontWeight: 500 }}>{c.column_name}</td>
                      <td style={{ color: 'var(--accent-cyan)', fontSize: '0.76rem' }}>
                        {c.column_type}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <HardDrive size={16} color="var(--accent-emerald)" />
            Apache Parquet Columnar Storage Introspection (fact_sales.parquet · Row Group 0)
          </h3>
          <span className="card-meta">Queried via parquet_metadata()</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Parquet Physical Type</th>
                <th>Compression</th>
                <th className="num">Rows</th>
                <th className="num">Compressed Bytes</th>
                <th className="num">Uncompressed Bytes</th>
              </tr>
            </thead>
            <tbody>
              {parquetMeta.map((m, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 500 }}>{formatCellValue(m.path_in_schema)}</td>
                  <td>{formatCellValue(m.type)}</td>
                  <td>
                    <span className="pill pill-cyan">{formatCellValue(m.compression)}</span>
                  </td>
                  <td className="num">{formatCellValue(m.row_group_num_rows)}</td>
                  <td className="num">{formatCellValue(m.total_compressed_size)}</td>
                  <td className="num">{formatCellValue(m.total_uncompressed_size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
