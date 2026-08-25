import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  CalendarDays,
  ClipboardList,
  FileBarChart,
  Fingerprint,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  Users,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { ROLE_LABELS, useAuth } from '../lib/auth'
import { jalaliLong } from '../lib/jalali'
import { Avatar } from './ui'

const NAV = [
  { to: '/', label: 'داشبورد', icon: LayoutDashboard, end: true },
  { to: '/employees', label: 'پرسنل', icon: Users },
  { to: '/attendance', label: 'ترددها', icon: Fingerprint },
  { to: '/tasks', label: 'وظایف', icon: ClipboardList },
  { to: '/leaves', label: 'مرخصی‌ها', icon: CalendarDays },
  { to: '/reports', label: 'گزارش‌ها', icon: FileBarChart },
  { to: '/settings', label: 'تنظیمات', icon: SettingsIcon },
]

export function AppLayout() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const location = useLocation()

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition',
              isActive
                ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
                : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
            )
          }
        >
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-ink-50">
      {/* نوار کناری — دسکتاپ */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-ink-200/70 bg-white lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="grid size-10 place-items-center rounded-xl bg-brand-600 text-white">
            <Fingerprint size={20} />
          </div>
          <div>
            <p className="text-sm font-bold text-ink-900">سامانه حضور و غیاب</p>
            <p className="text-xs text-ink-400">مدیریت پرسنل کارخانه</p>
          </div>
        </div>
        {nav}
        <div className="border-t border-ink-100 p-3">
          <div className="mb-2 flex items-center gap-3 rounded-xl bg-ink-50 px-3 py-2.5">
            <Avatar name={user?.full_name ?? ''} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-800">{user?.full_name}</p>
              <p className="text-xs text-ink-400">{ROLE_LABELS[user?.role ?? ''] ?? ''}</p>
            </div>
          </div>
          <button onClick={logout} className="btn-ghost w-full justify-center text-rose-600">
            <LogOut size={16} />
            خروج از حساب
          </button>
        </div>
      </aside>

      {/* نوار کناری — موبایل */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 flex w-72 flex-col bg-white">
            <div className="flex items-center justify-between px-5 py-5">
              <p className="font-bold text-ink-900">سامانه حضور و غیاب</p>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-ink-400">
                <X size={18} />
              </button>
            </div>
            {nav}
            <div className="border-t border-ink-100 p-3">
              <button onClick={logout} className="btn-ghost w-full justify-center text-rose-600">
                <LogOut size={16} />
                خروج
              </button>
            </div>
          </aside>
        </div>
      )}

      <div className="lg:ps-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-200/70 bg-white/85 px-4 py-3 backdrop-blur-md sm:px-6">
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 lg:hidden"
            aria-label="منو"
          >
            <Menu size={20} />
          </button>
          <div className="flex-1">
            <h1 className="text-base font-bold text-ink-900">
              {NAV.find((n) => n.to === location.pathname)?.label ?? 'داشبورد'}
            </h1>
            <p className="text-xs text-ink-400">{jalaliLong()}</p>
          </div>
          <a
            href="/kiosk"
            target="_blank"
            rel="noreferrer"
            className="btn-subtle hidden text-xs sm:inline-flex"
          >
            <Fingerprint size={15} />
            حالت تبلت ورودی
          </a>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
