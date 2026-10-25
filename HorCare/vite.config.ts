import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode, command }) => {
  // Local dev forwards /api to the functions. It never points at production by default (NFR-10): without
  // API_PROXY_TARGET it uses `vercel dev` on localhost:3000. Set API_PROXY_TARGET in .env.local to a Vercel
  // Preview / staging deployment (e.g. https://hor-care-git-<branch>-<team>.vercel.app) — or, deliberately,
  // to production.
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.API_PROXY_TARGET || 'http://localhost:3000'
  if (command === 'serve' && !env.API_PROXY_TARGET) {
    console.warn('[horcare] API_PROXY_TARGET is not set: /api goes to http://localhost:3000 (run `vercel dev`), not production.')
  }

  return {
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Firebase SDK — large but shared across the whole app; cache separately
          'firebase-core': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          'firebase-extra': ['firebase/storage', 'firebase/messaging'],
          // PDF / image export — only needed when user clicks "export"
          'pdf-export': ['jspdf', 'jspdf-autotable', 'html2canvas', 'html-to-image'],
          // QR code generation
          'qr': ['qrcode.react', 'promptpay-qr'],
          // React runtime
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      // Only precache lightweight app-shell assets — NOT large PNGs (they get
      // runtime-cached on first use instead, keeping the SW install fast)
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'HorCare - ระบบจัดการหอพัก',
        short_name: 'HorCare',
        description: 'ระบบจัดการหอพักอัจฉริยะ จดมิเตอร์ คำนวณค่าเช่า ออกบิลอัตโนมัติ',
        theme_color: '#0A5DAA',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        id: '/',
        categories: ['business', 'utilities'],
        lang: 'th',
        icons: [
          { src: '/pwa-192.png',         sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png',         sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512.png',sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only JS, CSS, HTML, SVG — skip large PNGs
        globPatterns: ['**/*.{js,css,html,svg,ico,woff2}'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        runtimeCaching: [
          // App icons & logos — revalidate in background, cacheName v2 to clear old stale logos
          {
            urlPattern: /\.(?:png|jpg|jpeg|webp|gif)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'images-cache-v2',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Google Fonts
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // NOTE: firestore.googleapis.com intentionally NOT cached here.
          // Firebase SDK's persistentLocalCache() (IndexedDB) handles Firestore
          // offline support correctly — workbox HTTP-level caching would conflict.
        ],
      },
    }),
  ],
  }
})
