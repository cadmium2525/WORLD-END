import { defineConfig } from 'vite';

// GitHub Pages のサブパス（/リポジトリ名/）でも動くよう相対パスでビルド
export default defineConfig({
  base: './',
  build: { target: 'es2020', outDir: 'dist' },
  server: { host: true },
});
