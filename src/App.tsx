import { useEffect, useState } from 'react';
import { Box, Cpu, Database, Github, Layers, Terminal } from 'lucide-react';
import { CubeExplorer } from './components/CubeExplorer';
import { SchemaExplorer } from './components/SchemaExplorer';
import { SqlWorkbench } from './components/SqlWorkbench';
import { type EngineInfo, getDuckDb } from './lib/duckdb';

type Tab = 'cube' | 'sql' | 'schema';

export function App() {
  const [tab, setTab] = useState<Tab>('cube');
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [workbenchSql, setWorkbenchSql] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getDuckDb()
      .then((res) => {
        if (active) setEngine(res.info);
      })
      .catch((err) => {
        if (active) {
          setBootError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function openInWorkbench(sql: string) {
    setWorkbenchSql(sql);
    setTab('sql');
  }

  return (
    <div className="app-shell">
      <header className="top-header">
        <div className="brand-group">
          <div className="brand-logo">
            <Box size={20} />
          </div>
          <div>
            <h1 className="brand-title">ParquetCube OLAP Studio</h1>
            <p className="brand-subtitle">
              Zero-AWS Browser-Native OLAP powered by DuckDB-WASM &amp; Apache Parquet
            </p>
          </div>
        </div>

        <nav className="nav-tabs" aria-label="Workspace sections">
          <button
            className={`nav-tab ${tab === 'cube' ? 'active' : ''}`}
            onClick={() => setTab('cube')}
          >
            <Layers size={15} /> OLAP Cube Explorer
          </button>
          <button
            className={`nav-tab ${tab === 'sql' ? 'active' : ''}`}
            onClick={() => setTab('sql')}
          >
            <Terminal size={15} /> SQL Workbench
          </button>
          <button
            className={`nav-tab ${tab === 'schema' ? 'active' : ''}`}
            onClick={() => setTab('schema')}
          >
            <Database size={15} /> Star Schema &amp; Parquet
          </button>
        </nav>

        <div className="status-pills">
          {engine ? (
            <>
              <span className="pill pill-emerald">
                <Cpu size={13} /> DuckDB {engine.version} · {engine.bundle}
              </span>
              <span className="pill pill-cyan">Booted in {engine.bootMs} ms</span>
            </>
          ) : (
            <span className="pill">Initializing DuckDB-WASM...</span>
          )}
          <a
            className="pill"
            href="https://github.com/FabricioRams/Actividad-Grupal-02-U2-Online-Analitycal-Processing"
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none', color: 'var(--text-primary)' }}
          >
            <Github size={13} /> Source
          </a>
        </div>
      </header>

      <main className="main-content">
        {bootError ? (
          <div className="error-banner">
            <strong>Failed to initialize DuckDB-WASM OLAP engine:</strong> {bootError}
          </div>
        ) : !engine ? (
          <div className="loading-screen">
            <div className="spinner" />
            <div>
              <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem' }}>
                Booting In-Browser DuckDB-WASM OLAP Engine
              </h2>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
                Loading columnar ZSTD-compressed Apache Parquet Star Schema (120,000 fact rows)...
              </p>
            </div>
          </div>
        ) : (
          <>
            {tab === 'cube' && <CubeExplorer onOpenSql={openInWorkbench} />}
            {tab === 'sql' && <SqlWorkbench initialSql={workbenchSql} />}
            {tab === 'schema' && <SchemaExplorer onRunTableSql={openInWorkbench} />}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
