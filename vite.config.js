import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ mode }) => ({
  plugins: [vue(), ...(mode === 'gas' ? [viteSingleFile()] : [])],
  publicDir: false,
  // Shown in the footer so users can tell which release a Web App deployment runs.
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001' },
  },
  preview: {
    proxy: { '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001' },
  },
  build: {
    outDir: mode === 'gas' ? 'build/gas' : 'dist',
    sourcemap: false,
  },
}));
