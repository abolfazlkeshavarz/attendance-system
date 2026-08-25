import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    basicSsl(),  // This creates a self-signed certificate automatically
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'سامانه حضور و غیاب',
        short_name: 'حضور و غیاب',
        description: 'ثبت ورود و خروج پرسنل با تشخیص چهره',
        lang: 'fa',
        dir: 'rtl',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'fullscreen',
        orientation: 'landscape',
        start_url: '/kiosk',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,bin}'],
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /\/models\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'face-models', expiration: { maxEntries: 60 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { 
        target: 'http://127.0.0.1:8000', 
        changeOrigin: true,
        secure: false,
      },
      '/static': { 
        target: 'http://127.0.0.1:8000', 
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
})