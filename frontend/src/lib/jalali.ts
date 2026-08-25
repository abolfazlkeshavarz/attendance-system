/**
 * ابزارهای تاریخ شمسی سمت مرورگر.
 *
 * از تقویم فارسی داخلی مرورگر (`Intl` با `fa-IR-u-ca-persian`) استفاده می‌کنیم تا
 * بدون وابستگی اضافه، تبدیل دقیق داشته باشیم. سرور همیشه رشته «۱۴۰۳/۰۵/۱۲» با
 * ارقام لاتین می‌فرستد و می‌گیرد.
 */

export const WEEKDAYS_FA = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه']
export const MONTHS_FA = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
]

const jalaliParts = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Tehran',
})

const tehranTime = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Tehran',
})

export interface JalaliDate {
  year: number
  month: number
  day: number
}

/** تاریخ میلادی (Date) را به اجزای شمسی تبدیل می‌کند. */
export function toJalali(date: Date = new Date()): JalaliDate {
  const parts = jalaliParts.formatToParts(date)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** «۱۴۰۳/۰۵/۱۲» با ارقام لاتین — قالبی که سرور می‌فهمد. */
export function toJalaliString(date: Date = new Date()): string {
  const { year, month, day } = toJalali(date)
  return `${pad(year, 4)}/${pad(month)}/${pad(day)}`
}

/** رشته شمسی را به Date میلادی (نیمه‌شب تهران) تبدیل می‌کند. */
export function fromJalaliString(value: string): Date | null {
  const [y, m, d] = normalizeDigits(value).replace(/-/g, '/').split('/').map(Number)
  if (!y || !m || !d) return null
  return jalaliToGregorian(y, m, d)
}

/**
 * تبدیل شمسی به میلادی با جست‌وجوی دودویی روی تقویم مرورگر.
 * سریع است (حداکثر ~۲۰ گام) و نیازی به پیاده‌سازی دستی الگوریتم ندارد.
 */
export function jalaliToGregorian(jy: number, jm: number, jd: number): Date {
  // تخمین اولیه: نوروز حدوداً ۲۱ مارس
  let lo = Date.UTC(jy + 620, 0, 1)
  let hi = Date.UTC(jy + 622, 11, 31)
  const target = jy * 10000 + jm * 100 + jd

  for (let i = 0; i < 64 && lo <= hi; i++) {
    const mid = lo + Math.floor((hi - lo) / 2 / 86400000) * 86400000
    const j = toJalali(new Date(mid))
    const current = j.year * 10000 + j.month * 100 + j.day
    if (current === target) return new Date(mid)
    if (current < target) lo = mid + 86400000
    else hi = mid - 86400000
  }
  return new Date(lo)
}

/** «شنبه ۱۲ مرداد ۱۴۰۳» */
export function jalaliLong(date: Date = new Date()): string {
  const { year, month, day } = toJalali(date)
  return `${WEEKDAYS_FA[iranWeekday(date)]} ${toPersianDigits(day)} ${MONTHS_FA[month - 1]} ${toPersianDigits(year)}`
}

/** شنبه = ۰ ... جمعه = ۶ */
export function iranWeekday(date: Date = new Date()): number {
  return (date.getDay() + 1) % 7
}

/** ساعت به وقت تهران — «۰۷:۳۲» */
export function tehranClock(date: Date = new Date()): string {
  return tehranTime.format(date)
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** ابتدا و انتهای هفته ایرانی (شنبه تا جمعه). */
export function weekRange(date: Date = new Date()): [Date, Date] {
  const start = addDays(date, -iranWeekday(date))
  return [start, addDays(start, 6)]
}

// ---------------------------------------------------------------------- ارقام

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

export function toPersianDigits(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)])
}

export function normalizeDigits(value: string): string {
  return (value ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
}

function pad(n: number, size = 2): string {
  return String(n).padStart(size, '0')
}

/** «۸:۳۰» از تعداد دقیقه */
export function minutesToHhmm(minutes?: number | null): string {
  const m = Math.round(Math.abs(minutes ?? 0))
  const sign = (minutes ?? 0) < 0 ? '−' : ''
  return `${sign}${toPersianDigits(Math.floor(m / 60))}:${toPersianDigits(pad(m % 60))}`
}

/** جداکننده هزارگان با ارقام فارسی */
export function formatNumber(value?: number | null): string {
  if (value === null || value === undefined) return '—'
  return toPersianDigits(value.toLocaleString('en-US'))
}
