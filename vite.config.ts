import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { tenantShells } from './scripts/vite/tenantShells.ts';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    tenantShells(),
    VitePWA({
      // Our own worker (src/sw.ts); manifests and registration are per studio,
      // written by scripts/build/tenant-shells.ts and src/pwa/registerServiceWorker.ts.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        // Classic script: works on every browser that supports service workers.
        rollupFormat: 'iife',
        globPatterns: ['assets/**/*.{js,css,woff2,svg,png,webp}'],
        globIgnores: ['**/s/**', '**/index.html'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
