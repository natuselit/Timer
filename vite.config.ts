import { sites } from '@openai/sites-vite-plugin';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa';

type AppManifest = Partial<ManifestOptions> & {
  color_scheme_dark: {
    theme_color: string;
    background_color: string;
  };
};

const createManifest = (basePath: string): AppManifest => ({
  name: 'Облік робочого часу',
  short_name: 'Облік часу',
  description: 'Offline-first PWA для обліку робочого часу',
  theme_color: '#0b0f14',
  background_color: '#0b0f14',
  color_scheme_dark: {
    theme_color: '#0b0f14',
    background_color: '#0b0f14'
  },
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
});

export default defineConfig(async ({ mode }) => {
  const isGitHubPagesBuild = mode === 'github-pages';
  const basePath = isGitHubPagesBuild ? '/Timer/' : '/';
  const manifest = createManifest(basePath);

  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  const hostingPlugins =
    mode === 'test' || isGitHubPagesBuild
      ? []
      : [
          sites(),
          (await import('@cloudflare/vite-plugin')).cloudflare({
            viteEnvironment: { name: 'server' }
          })
        ];

  return {
    base: basePath,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['pwa.svg', 'pwa-192.png', 'pwa-512.png'],
        manifest,
        integration: {
          beforeBuildServiceWorker(options) {
            options.workbox.additionalManifestEntries =
              options.workbox.additionalManifestEntries?.filter((entry) =>
                typeof entry === 'string'
                  ? entry !== options.manifestFilename
                  : entry.url !== options.manifestFilename
              );
          }
        },
        workbox: {
          cleanupOutdatedCaches: true,
          navigateFallback: `${basePath}index.html`,
          globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico}']
        }
      }),
      ...hostingPlugins
    ]
  };
});
