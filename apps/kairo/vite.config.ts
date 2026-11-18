import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'brand/*'],
      manifest: {
        name: 'KAIRO by TECHMED', short_name: 'KAIRO',
        description: 'JAMB CBT practice that explains why.',
        theme_color: '#012748', background_color: '#f6f8fa', display: 'standalone',
        start_url: '/', scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}', 'icons/*.png'],
        globIgnores: ['qimg/**', 'design-preview.html'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/qimg/'), handler: 'CacheFirst',
            options: { cacheName: 'qimg', expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 180 } } },
        ],
      },
    }),
  ],
  test: { environment: 'jsdom' },
} as never);
