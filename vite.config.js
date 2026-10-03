import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  plugins: [vue(), ...(mode === 'gas' ? [viteSingleFile()] : [])],
  publicDir: false,
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
