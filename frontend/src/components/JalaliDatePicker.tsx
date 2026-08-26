// frontend/src/components/JalaliDatePicker.tsx
import React, { useState, useEffect, useRef } from 'react'
import { Calendar } from 'lucide-react'
import { toPersianDigits } from '../lib/jalali'

// کامپوننت ساده و مستقل - بدون وابستگی به کتابخانه‌های خارجی
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
  const [displayValue, setDisplayValue] = useState('')
  const [isValid, setIsValid] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  // وقتی value از بیرون تغییر می‌کند
  useEffect(() => {
    if (value) {
      const parts = value.split('/')
      if (parts.length === 3) {
        setDisplayValue(`${toPersianDigits(parts[0])}/${toPersianDigits(parts[1])}/${toPersianDigits(parts[2])}`)
        setIsValid(true)
      } else {
        setDisplayValue(value)
      }
    } else {
      setDisplayValue('')
      setIsValid(true)
    }
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setDisplayValue(raw)
    
    // تبدیل اعداد فارسی به لاتین
    const normalized = raw
      .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[^0-9/]/g, '')
    
    if (normalized === '') {
      // فیلد خالی درست است، ولی «متنی که هیچ رقمی ندارد» باید نامعتبر نشان داده شود
      setIsValid(raw.trim() === '')
      onChange('')
      return
    }

    // ماه و روز یک‌رقمی هم پذیرفته می‌شود: «۱۴۰۵/۶/۳» → «1405/06/03»
    const parts = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
    if (!parts) {
      setIsValid(false)
      return
    }

    const [, year, month, day] = parts
    const m = Number(month)
    const d = Number(day)
    // اسفند ۳۰ روز دارد و بقیه ماه‌ها حداکثر ۳۱ روز
    if (m < 1 || m > 12 || d < 1 || d > 31 || (m === 12 && d > 30)) {
      setIsValid(false)
      return
    }

    setIsValid(true)
    onChange(`${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`)
  }

  // کلیک روی آیکون، فوکوس روی input
  const handleIconClick = () => {
    inputRef.current?.focus()
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        ref={inputRef}
        className={`input ps-10 ${!isValid ? 'border-rose-500 ring-rose-100' : ''}`}
        value={displayValue}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        dir="ltr"
      />
      <Calendar
        size={16}
        className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-400"
        onClick={handleIconClick}
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