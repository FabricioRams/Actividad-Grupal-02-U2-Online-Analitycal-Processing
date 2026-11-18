import * as duckdb from '@duckdb/duckdb-wasm';

export interface QueryResult {
  columns: string[];
  columnTypes: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
}

export interface EngineInfo {
  version: string;
  bundle: string;
  bootMs: number;
}

interface DuckDbSingleton {
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
  worker: Worker;
  info: EngineInfo;
}

let instancePromise: Promise<DuckDbSingleton> | null = null;

function normalizeArrowValue(value: unknown, typeName: string): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (
    typeof value === 'number' &&
    (typeName.startsWith('Date') || typeName.startsWith('Timestamp'))
  ) {
    return new Date(value).toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object' && value !== null && 'toJSON' in value) {
    return (value as { toJSON: () => unknown }).toJSON();
  }
  return value;
}

async function registerParquetTable(
  db: duckdb.AsyncDuckDB,
  conn: duckdb.AsyncDuckDBConnection,
  tableName: string,
  fileUrl: string
): Promise<void> {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${fileUrl}: HTTP ${response.status}`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  const virtualPath = `${tableName}.parquet`;
  await db.registerFileBuffer(virtualPath, buffer);
  await conn.query(
    `CREATE OR REPLACE VIEW ${tableName} AS SELECT * FROM read_parquet('${virtualPath}');`
  );
}

async function bootDuckDb(): Promise<DuckDbSingleton> {
  const start = performance.now();
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;

  const localBundles: duckdb.DuckDBBundles = {
    mvp: {
      mainModule: `${normalizedBase}duckdb/duckdb-mvp.wasm`,
      mainWorker: `${normalizedBase}duckdb/duckdb-browser-mvp.worker.js`,
    },
    eh: {
      mainModule: `${normalizedBase}duckdb/duckdb-eh.wasm`,
      mainWorker: `${normalizedBase}duckdb/duckdb-browser-eh.worker.js`,
    },
  };

  const bundle = await duckdb.selectBundle(localBundles);
  const workerUrl = bundle.mainWorker!;
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);

  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const conn = await db.connect();

  // Register Star Schema Parquet files in parallel
  await Promise.all([
    registerParquetTable(
      db,
      conn,
      'dim_products',
      `${normalizedBase}data/dim_products.parquet`
    ),
    registerParquetTable(
      db,
      conn,
      'dim_stores',
      `${normalizedBase}data/dim_stores.parquet`
    ),
    registerParquetTable(
      db,
      conn,
      'fact_sales',
      `${normalizedBase}data/fact_sales.parquet`
    ),
  ]);

  const versionResult = await conn.query('SELECT version() AS v;');
  const versionRow = versionResult.toArray()[0];
  const version = versionRow ? String(versionRow.v) : 'unknown';

  const bootMs = Math.round(performance.now() - start);
  const bundleName = bundle.mainModule.includes('eh') ? 'eh (WASM-EH)' : 'mvp (WASM)';

  return {
    db,
    conn,
    worker,
    info: { version, bundle: bundleName, bootMs },
  };
}

export async function getDuckDb(): Promise<DuckDbSingleton> {
  if (!instancePromise) {
    instancePromise = bootDuckDb().catch((err) => {
      instancePromise = null;
      throw err;
    });
  }
  return instancePromise;
}

export async function runQuery(sql: string): Promise<QueryResult> {
  const { conn } = await getDuckDb();
  const start = performance.now();
  const table = await conn.query(sql);
  const durationMs = Math.round((performance.now() - start) * 10) / 10;

  const fields = table.schema.fields;
  const columns = fields.map((f) => f.name);
  const columnTypes = fields.map((f) => String(f.type));

  const rawRows = table.toArray();
  const rows: Record<string, unknown>[] = rawRows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      obj[col] = normalizeArrowValue(row[col], columnTypes[i]);
    }
    return obj;
  });

  return {
    columns,
    columnTypes,
    rows,
    rowCount: rows.length,
    durationMs,
  };
}

export async function registerUploadedFile(file: File): Promise<string> {
  const { db, conn } = await getDuckDb();
  const buffer = new Uint8Array(await file.arrayBuffer());
  const ext = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'parquet';
  const safeViewName =
    file.name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^(\d)/, '_$1') || 'custom_table';

  const virtualPath = `uploaded_${safeViewName}.${ext}`;
  await db.registerFileBuffer(virtualPath, buffer);

  if (ext === 'parquet') {
    await conn.query(
      `CREATE OR REPLACE VIEW ${safeViewName} AS SELECT * FROM read_parquet('${virtualPath}');`
    );
  } else {
    await conn.query(
      `CREATE OR REPLACE VIEW ${safeViewName} AS SELECT * FROM read_csv_auto('${virtualPath}');`
    );
  }

  return safeViewName;
}
