import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      injectManifest: { rollupFormat: 'iife', globPatterns: ['**/*.{js,css,html,png,svg,woff2}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
      manifest: {
        name: 'カヴ - 保有株・配当金管理',
        short_name: 'カヴ',
        description: '日本株の保有銘柄・配当金・利回り・増配減配を一元管理',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#070f22',
        theme_color: '#070f22',
        categories: ['finance'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: 'node' },
});
