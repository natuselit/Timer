import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const basePath = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['pwa.svg', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'Облік робочого часу',
        short_name: 'Облік часу',
        description: 'Offline-first PWA для обліку робочого часу',
        theme_color: '#2563eb',
        background_color: '#f8fafc',
        display: 'standalone',
        lang: 'uk',
        orientation: 'portrait',
        scope: basePath,
        start_url: basePath,
        icons: [
          {
            src: `${basePath}pwa-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: `${basePath}pwa-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: `${basePath}pwa.svg`,
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any'
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: `${basePath}index.html`,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}']
      }
    })
  ]
});
