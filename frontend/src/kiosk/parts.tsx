/** بخش‌های مشترک کیوسک: نوار بالا، کارت خوش‌آمدگویی و ساعت زنده. */
import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Cloud,
  CloudOff,
  Fingerprint,
  LogIn,
  LogOut,
  RefreshCw,
  Settings2,
  ShieldCheck,
  ShieldOff,
  Users,
} from 'lucide-react'
import clsx from 'clsx'
import { tehranClock, toPersianDigits } from '../lib/jalali'

export interface Greeting {
  name: string
  kind: 'in' | 'out'
  offline: boolean
  message: string
  photo?: string | null
  department?: string | null
}

// ------------------------------------------------------------------- ساعت زنده

export function useClock() {
  const [clock, setClock] = useState(tehranClock())
  useEffect(() => {
    const timer = setInterval(() => setClock(tehranClock()), 1000)
    return () => clearInterval(timer)
  }, [])
  return clock
}

// -------------------------------------------------------------------- نوار بالا

export function TopBar({
  online,
  pending,
  syncing,
  peopleCount,
  savedAt,
  inAdminMode,
  onRefresh,
  onSync,
  onReset,
  onAdminToggle,
}: {
  online: boolean
  pending: number
  syncing: boolean
  peopleCount: number
  savedAt: number | null
  inAdminMode: boolean
  onRefresh: () => void
  onSync: () => void
  onReset: () => void
  onAdminToggle: () => void
}) {
  return (
    <header className="z-10 flex items-center gap-3 border-b border-white/10 bg-ink-900/80 px-6 py-3 backdrop-blur">
      <div className="grid size-9 place-items-center rounded-xl bg-brand-600">
        <Fingerprint size={18} />
      </div>
      <span className="font-bold">سامانه حضور و غیاب</span>

      <div className="flex-1" />

      <span
        className={clsx(
          'badge',
          online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300',
        )}
      >
        {online ? <Cloud size={14} /> : <CloudOff size={14} />}
        {online ? 'آنلاین' : 'آفلاین'}
      </span>

      {pending > 0 && (
        <button onClick={onSync} className="badge bg-amber-500/15 text-amber-300">
          {syncing ? <RefreshCw size={14} className="animate-spin" /> : <CloudOff size={14} />}
          {toPersianDigits(pending)} تردد در صف
        </button>
      )}

      <span className="badge bg-white/10 text-ink-200">
        <Users size={14} />
        {toPersianDigits(peopleCount)}
      </span>

      <button
        onClick={onRefresh}
        className="rounded-lg p-2 text-ink-300 transition hover:bg-white/10 hover:text-white"
        title={savedAt ? `آخرین به‌روزرسانی: ${new Date(savedAt).toLocaleString('fa-IR')}` : 'به‌روزرسانی'}
      >
        <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
      </button>
      <button
        onClick={onAdminToggle}
        className={clsx(
          'rounded-lg p-2 transition hover:bg-white/10 hover:text-white',
          inAdminMode ? 'text-amber-300' : 'text-ink-300',
        )}
        title={inAdminMode ? 'خروج از حالت مدیر' : 'ورود مدیر — ثبت چهره پرسنل'}
      >
        {inAdminMode ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}
      </button>
      <button
        onClick={onReset}
        className="rounded-lg p-2 text-ink-300 transition hover:bg-white/10 hover:text-white"
        title="تنظیمات دستگاه"
      >
        <Settings2 size={16} />
      </button>
    </header>
  )
}

// ------------------------------------------------------------- خوش‌آمدگویی

export function GreetingCard({ greeting }: { greeting: Greeting }) {
  const isIn = greeting.kind === 'in'
  return (
    <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center">
      <div
        className={clsx(
          'grid size-28 place-items-center rounded-full',
          isIn ? 'bg-emerald-500' : 'bg-brand-500',
        )}
      >
        {isIn ? <LogIn size={52} /> : <LogOut size={52} />}
      </div>

      <div>
        <p className={clsx('text-lg font-medium', isIn ? 'text-emerald-300' : 'text-brand-300')}>
          {isIn ? 'ورود شما ثبت شد' : 'خروج شما ثبت شد'}
        </p>
        <h2 className="mt-1 text-5xl font-bold">{greeting.name}</h2>
        {greeting.department && <p className="mt-2 text-ink-300">{greeting.department}</p>}
      </div>

      <p className="text-2xl font-bold tabular-nums">{toPersianDigits(tehranClock())}</p>

      <div
        className={clsx(
          'badge px-4 py-2 text-sm',
          greeting.offline ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300',
        )}
      >
        {greeting.offline ? <CloudOff size={15} /> : <CheckCircle2 size={15} />}
        {greeting.message}
      </div>

      <p className="text-sm text-ink-400">{isIn ? 'روز خوبی داشته باشید' : 'خسته نباشید'}</p>
    </div>
  )
}
