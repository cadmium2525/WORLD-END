import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// GitHub Pages のサブパス（/リポジトリ名/）でも動くよう相対パスでビルド
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
      },
    },
  },
  worker: { format: 'es' },
  server: { host: true },
});
