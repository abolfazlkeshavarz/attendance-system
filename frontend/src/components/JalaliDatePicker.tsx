// frontend/src/components/JalaliDatePicker.tsx
import RawDatePicker from 'react-multi-date-picker'
import DateObject from 'react-date-object'
import rawPersian from 'react-date-object/calendars/persian'
import rawPersianFa from 'react-date-object/locales/persian_fa'
import { Calendar } from 'lucide-react'

/**
 * این کتابخانه‌ها به‌صورت UMD ساخته شده‌اند و Vite/esbuild همیشه نمی‌تواند
 * export پیش‌فرض واقعی را از خود شیء CJS تشخیص دهد — گاهی به‌جای کامپوننت،
 * کل شیء exports را برمی‌گرداند (که export واقعی زیر کلید .default آن است).
 * این تابع مستقل از رفتار باندلر، مقدار درست را برمی‌گرداند.
 */
function unwrapDefault<T>(mod: T | { default: T }): T {
  return (mod as { default?: T })?.default ?? (mod as T)
}

const DatePicker = unwrapDefault(RawDatePicker)
const persian = unwrapDefault(rawPersian)
const persian_fa = unwrapDefault(rawPersianFa)

/** «۱۴۰۳/۰۵/۱۲» → اجزای عددی (بدون توجه به رقم فارسی/لاتین ورودی) */
function parseJalaliString(value: string): { year: number; month: number; day: number } | null {
  const normalized = value
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  const parts = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (!parts) return null
  return { year: Number(parts[1]), month: Number(parts[2]), day: Number(parts[3]) }
}

/** DateObject کتابخانه را به رشته «YYYY/MM/DD» با ارقام لاتین (قالب مورد انتظار سرور) تبدیل می‌کند. */
function toApiString(date: DateObject): string {
  return `${date.year}/${String(date.month.number).padStart(2, '0')}/${String(date.day).padStart(2, '0')}`
}

export function JalaliDatePicker({
  value,
  onChange,
  placeholder = 'انتخاب تاریخ',
  disabled,
  className,
}: {
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const parsed = value ? parseJalaliString(value) : null
  const dateValue = parsed
    ? new DateObject({ year: parsed.year, month: parsed.month, day: parsed.day, calendar: persian, locale: persian_fa })
    : undefined

  return (
    <div className={`relative ${className ?? ''}`}>
      <DatePicker
        calendar={persian}
        locale={persian_fa}
        value={dateValue}
        onChange={(date) => onChange(date ? toApiString(date as DateObject) : '')}
        inputClass="input ps-10"
        placeholder={placeholder}
        disabled={disabled}
        containerClassName="w-full"
        calendarPosition="bottom-right"
      />
      <Calendar
        size={16}
        className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-400"
      />
    </div>
  )
}

export function JalaliRangePicker({
  from,
  to,
  onChange,
}: {
  from?: string
  to?: string
  onChange: (from: string, to: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <JalaliDatePicker value={from} onChange={(v) => onChange(v, to ?? '')} placeholder="از تاریخ" />
      <JalaliDatePicker value={to} onChange={(v) => onChange(from ?? '', v)} placeholder="تا تاریخ" />
    </div>
  )
}