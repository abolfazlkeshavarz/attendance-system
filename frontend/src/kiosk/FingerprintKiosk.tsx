/**
 * صفحهٔ کیوسک برای دربِ اثر انگشت.
 *
 * تطبیق اثر انگشت روی خودِ ماژول ESP32 انجام می‌شود؛ این صفحه فقط وضعیتی را که
 * ماژول + سرور گزارش می‌کنند آینه می‌کند: «در حال بررسی»، نام فردِ تأییدشده،
 * ورود/خروج و پیام تأیید — درست مثل کیوسک تشخیص چهره.
 */
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Fingerprint, RefreshCw, XCircle } from 'lucide-react'
import clsx from 'clsx'
import type { FingerprintScanStatus } from '../lib/types'
import { GreetingCard, type Greeting } from './parts'
import { useFingerprintStatus } from './useKiosk'

// از نمایش دوبارهٔ کارتِ یک نفر تا وقتی انگشتش را برمی‌دارد جلوگیری می‌کند
const SAME_PERSON_COOLDOWN_MS = 15_000

export function FingerprintKiosk() {
  const status = useFingerprintStatus(true)
  const [card, setCard] = useState<Greeting | null>(null)
  const lastShownRef = useRef<{ name: string; at: number }>({ name: '', at: 0 })

  useEffect(() => {
    if (!status) return
    if (status.phase === 'success' && status.employee_name) {
      const now = Date.now()
      const last = lastShownRef.current
      if (last.name === status.employee_name && now - last.at < SAME_PERSON_COOLDOWN_MS) return
      lastShownRef.current = { name: status.employee_name, at: now }
      setCard({
        name: status.employee_name,
        kind: status.kind === 'out' ? 'out' : 'in',
        offline: false,
        message: status.message?.split(' — ').slice(1).join(' — ') || 'ثبت شد',
      })
    } else if (status.phase === 'idle') {
      setCard(null)
    }
  }, [status])

  // کارت خوش‌آمد پس از چند ثانیه خودش کنار می‌رود
  useEffect(() => {
    if (!card) return
    const t = setTimeout(() => setCard(null), 4000)
    return () => clearTimeout(t)
  }, [card])

  if (card) return <GreetingCard greeting={card} />

  const phase = status?.phase ?? 'idle'
  const scanning = phase === 'scanning' || phase === 'matched' || phase === 'enroll_scanning'
  const isError = phase === 'error' || phase === 'enroll_error'
  const enrollOk = phase === 'enroll_success'

  if (isError) {
    return (
      <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center">
        <div className="grid size-28 place-items-center rounded-full bg-rose-500/90">
          <XCircle size={52} />
        </div>
        <h2 className="text-3xl font-bold">{phase === 'enroll_error' ? 'ثبت اثر انگشت ناموفق بود' : 'ثبت تردد انجام نشد'}</h2>
        {status?.message && <p className="max-w-md text-ink-300">{status.message}</p>}
      </div>
    )
  }

  if (enrollOk) {
    return (
      <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center">
        <div className="grid size-28 place-items-center rounded-full bg-emerald-500">
          <CheckCircle2 size={52} />
        </div>
        <h2 className="text-3xl font-bold">اثر انگشت ثبت شد</h2>
        {status?.employee_name && <p className="text-ink-300">{status.employee_name}</p>}
      </div>
    )
  }

  return (
    <div className="relative z-10 flex flex-col items-center gap-6 px-6 text-center">
      <div
        className={clsx(
          'relative grid size-40 place-items-center rounded-full border-4 text-brand-400',
          scanning ? 'border-emerald-400 text-emerald-400' : 'pulse-ring border-brand-400/70',
        )}
      >
        <Fingerprint size={64} className="text-white" />
      </div>

      {scanning ? (
        <div className="flex items-center gap-2.5 text-emerald-200">
          <RefreshCw size={20} className="animate-spin" />
          <span className="text-2xl font-bold">
            {phase === 'enroll_scanning'
              ? `در حال ثبت اثر انگشت${status?.employee_name ? ` — ${status.employee_name}` : ''}`
              : 'در حال بررسی اثر انگشت…'}
          </span>
        </div>
      ) : (
        <h2 className="text-3xl font-bold">انگشت خود را روی حسگر قرار دهید</h2>
      )}

      {status?.device_name && (
        <p className="text-sm text-ink-400">{status.device_name}</p>
      )}
    </div>
  )
}

/** برای استفاده در نوار وضعیتِ کیوسکِ ترکیبی (تبلت + اثر انگشت). */
export function fingerprintHint(status: FingerprintScanStatus | null): string | null {
  if (!status) return null
  switch (status.phase) {
    case 'scanning':
    case 'matched':
      return 'در حال بررسی اثر انگشت روی دستگاه کنار درب…'
    case 'success':
      return status.employee_name ? `${status.employee_name} — تردد با اثر انگشت ثبت شد` : null
    case 'error':
      return status.message ?? null
    default:
      return null
  }
}
