import axios, { AxiosError, type AxiosInstance } from 'axios'

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

const ACCESS_KEY = 'att.access'
const REFRESH_KEY = 'att.refresh'
export const DEVICE_KEY = 'att.deviceKey'

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY)
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY)
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access)
    localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

export const deviceKey = {
  get() {
    return localStorage.getItem(DEVICE_KEY) ?? ''
  },
  set(value: string) {
    localStorage.setItem(DEVICE_KEY, value)
  },
  clear() {
    localStorage.removeItem(DEVICE_KEY)
  },
}

/** کلاینت پنل مدیریت — با توکن JWT. */
export const api: AxiosInstance = axios.create({ baseURL: API_BASE, timeout: 30_000 })

/** کلاینت تبلت — با کلید دستگاه. */
export const kioskApi: AxiosInstance = axios.create({ baseURL: API_BASE, timeout: 20_000 })

api.interceptors.request.use((config) => {
  const token = tokens.access
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

kioskApi.interceptors.request.use((config) => {
  config.headers['X-Device-Key'] = deviceKey.get()
  return config
})

let refreshing: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refresh = tokens.refresh
  if (!refresh) return null
  try {
    const res = await axios.post(`${API_BASE}/auth/refresh`, { refresh_token: refresh })
    tokens.set(res.data.access_token, res.data.refresh_token)
    return res.data.access_token
  } catch {
    tokens.clear()
    return null
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined
    // ۴۰۱ روی خودِ درخواست ورود یعنی «رمز اشتباه است»، نه «نشست منقضی شده» —
    // نباید تلاش برای refresh یا هدایت به /login راه بیفتد (مثلاً از داخل
    // صفحه ورود مدیر در تبلت، که اصلاً نباید کاربر را از /kiosk خارج کند)
    const isLoginCall = original?.url?.includes('/auth/login')
    if (error.response?.status === 401 && original && !original._retried && !isLoginCall) {
      original._retried = true
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null
      })
      const token = await refreshing
      if (token) {
        original.headers = original.headers ?? {}
        original.headers.Authorization = `Bearer ${token}`
        return api.request(original)
      }
      if (!location.pathname.startsWith('/login')) location.href = '/login'
    }
    return Promise.reject(error)
  },
)

/** پیام خطای فارسی را از پاسخ سرور بیرون می‌کشد. */
export function errorMessage(error: unknown, fallback = 'خطایی رخ داد. دوباره تلاش کنید.'): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg
    if (error.code === 'ERR_NETWORK') return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return fallback
}

/** دانلود فایل اکسل با حفظ نام فارسی پیشنهادی سرور. */
export async function downloadFile(url: string, params?: Record<string, unknown>, fallbackName = 'report.xlsx') {
  const res = await api.get(url, { params, responseType: 'blob' })
  const disposition = res.headers['content-disposition'] as string | undefined
  let filename = fallbackName
  const match = disposition?.match(/filename\*=UTF-8''([^;]+)/i)
  if (match) filename = decodeURIComponent(match[1])

  const blobUrl = URL.createObjectURL(res.data as Blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(blobUrl)
}
