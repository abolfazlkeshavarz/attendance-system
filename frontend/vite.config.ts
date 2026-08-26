import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

import basicSsl from '@vitejs/plugin-basic-ssl'

/**
 * HTTPS برای تبلت اجباری است.
 *
 * مرورگرها فقط در «بستر امن» به دوربین اجازه دسترسی می‌دهند: یعنی localhost یا
 * HTTPS. چون تبلت ورودی از طریق IP شبکه داخلی (مثلاً 192.168.100.217) به سرور
 * وصل می‌شود، بدون HTTPS دوربین اصلاً باز نمی‌شود و تشخیص چهره کار نمی‌کند.
 *
 * دو حالت پشتیبانی می‌شود:
 *   ۱. اگر cert.pem و key.pem در ریشه پروژه باشند (خروجی create-cert.ps1)،
 *      همان‌ها استفاده می‌شوند. مزیتش این است که می‌توانید این گواهی را یک‌بار
 *      روی تبلت «معتبر» کنید تا دیگر هر بار صفحه هشدار نبینید.
 *   ۲. در غیر این صورت basicSsl یک گواهی موقت می‌سازد (برای توسعه سریع کافی است،
 *      ولی هر بار باید هشدار مرورگر را رد کنید).
 */
function localHttps() {
  const here = dirname(fileURLToPath(import.meta.url))
  const root = resolve(here, '..')
  const cert = resolve(root, 'cert.pem')
  const key = resolve(root, 'key.pem')
  if (!existsSync(cert) || !existsSync(key)) return undefined
  return { cert: readFileSync(cert), key: readFileSync(key) }
}

// اگر پشت یک reverse proxy (Nginx/Caddy) هستید که خودش TLS را مدیریت می‌کند،
// با VITE_NO_HTTPS=1 می‌توانید HTTPS داخلی را خاموش کنید.
const noHttps = process.env.VITE_NO_HTTPS === '1'
const explicitCert = noHttps ? undefined : localHttps()

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // فقط وقتی گواهی مشخصی نداریم، گواهی موقت ساخته شود
    ...(noHttps || explicitCert ? [] : [basicSsl()]),
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
          // اندروید آیکون را داخل شکل دلخواه خودش می‌برد و نیاز به حاشیه امن دارد
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
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
    host: true, // روی همه رابط‌های شبکه گوش می‌دهد تا تبلت بتواند وصل شود
    https: explicitCert,
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