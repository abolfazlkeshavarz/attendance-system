import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { ToastProvider } from './components/ui'
import './index.css'

// ثبت دستیِ سرویس‌ورکر (injectRegister:false در vite.config.ts) تا خودمان هر
// چند دقیقه بررسیِ نسخهٔ تازه را صدا بزنیم. کیوسکِ ورودی معمولاً هفته‌ها بدون
// رفرشِ دستی باز می‌ماند؛ مرورگر خودش را روی هر ناوبری برای آپدیت چک می‌کند،
// ولی تبی که هرگز رفرش نمی‌شود ممکن است تا مدت‌ها یک نسخهٔ قدیمی را اجرا کند.
// registerType «autoUpdate» یعنی همین‌که سرویس‌ورکرِ تازه پیدا و فعال شود،
// صفحه خودش رفرش می‌شود — نیازی به تأیید کاربر نیست.
if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => void registration.update(), 20 * 60_000)
    },
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
