import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const destDir = path.join(rootDir, 'public', 'duckdb');

const filesToCopy = [
  'duckdb-eh.wasm',
  'duckdb-browser-eh.worker.js',
  'duckdb-mvp.wasm',
  'duckdb-browser-mvp.worker.js',
];

fs.mkdirSync(destDir, { recursive: true });

for (const file of filesToCopy) {
  const from = path.join(srcDir, file);
  const to = path.join(destDir, file);
  if (!fs.existsSync(from)) {
    throw new Error(`Missing DuckDB WASM asset: ${from}`);
  }
  fs.copyFileSync(from, to);
}

console.log(`Copied ${filesToCopy.length} DuckDB-WASM assets into public/duckdb/`);
