import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: './client',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api':      { target: 'http://localhost:5000', changeOrigin: true },
      '/socket.io':{ target: 'http://localhost:5000', ws: true },
      '/uploads':  { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
});