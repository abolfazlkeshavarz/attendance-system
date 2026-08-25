import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'
import clsx from 'clsx'
import { toPersianDigits } from '../lib/jalali'
import type { DayStatus } from '../lib/types'

// ------------------------------------------------------------------ کارت و بخش

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('card p-5', className)}>{children}</div>
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-ink-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ------------------------------------------------------------------- فرم‌ها

interface FieldProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
}

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  return (
    <div className={className}>
      <label className="label">
        {label}
        {required && <span className="mr-1 text-rose-500">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  )
}

// --------------------------------------------------------------------- مودال

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  const width = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }[size]

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4 backdrop-blur-sm sm:p-8">
      <div
        className={clsx('card my-auto w-full', width)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h3 className="font-bold text-ink-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
            aria-label="بستن"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-ink-100 px-5 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  title = 'تأیید عملیات',
  message,
  confirmLabel = 'بله، انجام بده',
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>
            انصراف
          </button>
          <button className="btn-danger" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        <AlertTriangle className="shrink-0 text-amber-500" />
        <p className="text-sm leading-6 text-ink-700">{message}</p>
      </div>
    </Modal>
  )
}

// -------------------------------------------------------------------- اعلان‌ها

type ToastKind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

const ToastContext = createContext<(kind: ToastKind, message: string) => void>(() => {})

export function useToast() {
  const push = useContext(ToastContext)
  return useMemo(
    () => ({
      success: (m: string) => push('success', m),
      error: (m: string) => push('error', m),
      info: (m: string) => push('info', m),
    }),
    [push],
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, kind, message }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4500)
  }, [])

  const icons = {
    success: <CheckCircle2 size={18} className="text-emerald-600" />,
    error: <XCircle size={18} className="text-rose-600" />,
    info: <Info size={18} className="text-brand-600" />,
  }

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-4 z-[60] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className="card pointer-events-auto flex items-start gap-2.5 px-4 py-3 text-sm shadow-lg"
          >
            {icons[t.kind]}
            <span className="leading-6 text-ink-700">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// -------------------------------------------------------------- وضعیت و نشان‌ها

const STATUS_STYLES: Record<DayStatus | string, string> = {
  present: 'bg-emerald-50 text-emerald-700',
  absent: 'bg-rose-50 text-rose-700',
  leave: 'bg-amber-50 text-amber-700',
  mission: 'bg-sky-50 text-sky-700',
  holiday: 'bg-ink-100 text-ink-600',
  weekend: 'bg-ink-100 text-ink-500',
  incomplete: 'bg-orange-50 text-orange-700',
  todo: 'bg-ink-100 text-ink-600',
  in_progress: 'bg-sky-50 text-sky-700',
  done: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-ink-100 text-ink-400',
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700',
  low: 'bg-ink-100 text-ink-600',
  normal: 'bg-brand-50 text-brand-700',
  high: 'bg-amber-50 text-amber-700',
  urgent: 'bg-rose-50 text-rose-700',
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={clsx('badge', STATUS_STYLES[status] ?? 'bg-ink-100 text-ink-600')}>{label}</span>
}

// -------------------------------------------------------- حالت‌های خالی و بارگذاری

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin', className)} />
}

export function LoadingBlock({ label = 'در حال بارگذاری…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-400">
      <Spinner className="size-7" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="mb-1 text-ink-300">{icon}</div>
      <p className="font-medium text-ink-700">{title}</p>
      {description && <p className="max-w-sm text-sm leading-6 text-ink-400">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-700">
      <XCircle size={18} className="shrink-0" />
      <span className="leading-6">{message}</span>
    </div>
  )
}

// ------------------------------------------------------------------ آمار و صفحه‌بندی

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  hint?: string
  icon?: ReactNode
  tone?: 'default' | 'success' | 'danger' | 'warning' | 'info'
}) {
  const tones = {
    default: 'text-ink-900 bg-ink-100',
    success: 'text-emerald-700 bg-emerald-50',
    danger: 'text-rose-700 bg-rose-50',
    warning: 'text-amber-700 bg-amber-50',
    info: 'text-brand-700 bg-brand-50',
  }
  return (
    <div className="card flex items-center gap-4 p-4">
      <div className={clsx('grid size-11 shrink-0 place-items-center rounded-xl', tones[tone])}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-ink-500">{label}</p>
        <p className="text-xl font-bold text-ink-900">{value}</p>
        {hint && <p className="truncate text-xs text-ink-400">{hint}</p>}
      </div>
    </div>
  )
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 text-sm">
      <span className="text-ink-500">
        نمایش {toPersianDigits((page - 1) * pageSize + 1)} تا{' '}
        {toPersianDigits(Math.min(page * pageSize, total))} از {toPersianDigits(total)} مورد
      </span>
      <div className="flex items-center gap-1.5">
        <button className="btn-ghost px-3 py-1.5" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          قبلی
        </button>
        <span className="px-2 text-ink-600">
          صفحه {toPersianDigits(page)} از {toPersianDigits(pages)}
        </span>
        <button
          className="btn-ghost px-3 py-1.5"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          بعدی
        </button>
      </div>
    </div>
  )
}

export function Avatar({
  name,
  src,
  size = 40,
}: {
  name: string
  src?: string | null
  size?: number
}) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')

  if (src) {
    return (
      <img
        src={`/static/${src}`}
        alt={name}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover ring-2 ring-white"
      />
    )
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className="grid shrink-0 place-items-center rounded-full bg-brand-100 font-bold text-brand-700"
    >
      {initials}
    </div>
  )
}
