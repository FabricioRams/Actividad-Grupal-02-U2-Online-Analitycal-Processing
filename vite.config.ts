import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages deploys under /<repo-name>/ while local dev runs at /
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base:
    mode === 'production'
      ? '/Actividad-Grupal-02-U2-Online-Analitycal-Processing/'
      : '/',
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
}));
