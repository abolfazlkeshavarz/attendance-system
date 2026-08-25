import { create } from 'zustand'
import { api, tokens } from './api'
import type { User } from './types'

interface AuthState {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  restore: () => Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,

  async login(username, password) {
    const res = await api.post('/auth/login', { username, password })
    tokens.set(res.data.access_token, res.data.refresh_token)
    const me = await api.get('/auth/me')
    set({ user: me.data, loading: false })
  },

  logout() {
    tokens.clear()
    set({ user: null, loading: false })
  },

  async restore() {
    if (!tokens.access) {
      set({ user: null, loading: false })
      return
    }
    try {
      const me = await api.get('/auth/me')
      set({ user: me.data, loading: false })
    } catch {
      tokens.clear()
      set({ user: null, loading: false })
    }
  },
}))

/** آیا کاربر جاری اجازه تغییر داده‌ها را دارد؟ (ناظر فقط می‌بیند) */
export function canEdit(user: User | null): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function isAdmin(user: User | null): boolean {
  return user?.role === 'admin'
}

export const ROLE_LABELS: Record<string, string> = {
  admin: 'مدیر ارشد',
  manager: 'سرپرست',
  viewer: 'ناظر',
}
