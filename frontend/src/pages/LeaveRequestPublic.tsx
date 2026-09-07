/**
 * صفحهٔ عمومی «درخواست مرخصی».
 *
 * پرسنل با اسکن QR این صفحه را باز می‌کند، کد پرسنلی‌اش را می‌زند، نوع مرخصی و
 * بازه را انتخاب می‌کند و توضیحِ اجباری می‌نویسد. درخواست در وضعیت «در انتظار
 * تأیید» ساخته می‌شود؛ مدیر از پنل آن را تأیید یا رد می‌کند و پس از تأیید در
 * صفحهٔ مرخصی‌ها و گزارش‌ها اثر می‌گذارد. هیچ احراز هویتی لازم نیست.
 */
import { useState } from 'react'
import {
  ArrowLeft,
  Briefcase,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  Siren,
  Stethoscope,
  Wallet,
} from 'lucide-react'
import clsx from 'clsx'
import { publicApi, errorMessage } from '../lib/api'
import { Field, Spinner } from '../components/ui'
import { JalaliDatePicker } from '../components/JalaliDatePicker'
import { jalaliLong, normalizeDigits, toJalaliString, toPersianDigits } from '../lib/jalali'

type LeaveKey = 'daily' | 'hourly' | 'sick' | 'emergency' | 'mission' | 'unpaid'

const LEAVE_TYPES: {
  value: LeaveKey
  label: string
  hint: string
  Icon: typeof CalendarDays
}[] = [
  { value: 'daily', label: 'روزانه', hint: 'مرخصی استحقاقی', Icon: CalendarDays },
  { value: 'hourly', label: 'ساعتی', hint: 'چند ساعت در روز', Icon: Clock },
  { value: 'sick', label: 'استعلاجی', hint: 'بیماری / پزشکی', Icon: Stethoscope },
  { value: 'emergency', label: 'اضطراری', hint: 'موارد فوری', Icon: Siren },
  { value: 'mission', label: 'مأموریت', hint: 'خارج از محل کار', Icon: Briefcase },
  { value: 'unpaid', label: 'بدون حقوق', hint: 'مرخصی بدون حقوق', Icon: Wallet },
]

const REASON_MIN = 5

interface Employee {
  personnel_code: string
  full_name: string
}

interface SubmitResult {
  employee_name: string
  leave_type_fa: string
  start_jalali: string
  end_jalali: string
  message: string
}

export default function LeaveRequestPublic() {
  const [step, setStep] = useState<'code' | 'form' | 'done'>('code')

  const [code, setCode] = useState('')
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupError, setLookupError] = useState('')

  const [type, setType] = useState<LeaveKey>('daily')
  const [startDate, setStartDate] = useState(toJalaliString())
  const [endDate, setEndDate] = useState(toJalaliString())
  const [startClock, setStartClock] = useState('08:00')
  const [endClock, setEndClock] = useState('12:00')
  const [reason, setReason] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const [result, setResult] = useState<SubmitResult | null>(null)

  const reasonError =
    showErrors && reason.trim().length < REASON_MIN
      ? `نوشتن توضیحات الزامی است (حداقل ${toPersianDigits(REASON_MIN)} نویسه)`
      : ''

  async function lookup(e: React.FormEvent) {
    e.preventDefault()
    const clean = normalizeDigits(code).trim()
    if (!clean) return
    setLookupBusy(true)
    setLookupError('')
    try {
      const res = await publicApi.get<Employee>(
        `/leaves/public/employee/${encodeURIComponent(clean)}`,
      )
      setEmployee(res.data)
      setCode(clean)
      setStep('form')
    } catch (err) {
      setLookupError(errorMessage(err, 'کد پرسنلی یافت نشد'))
    } finally {
      setLookupBusy(false)
    }
  }

  async function submit() {
    setShowErrors(true)
    setSubmitError('')
    if (reason.trim().length < REASON_MIN) return
    setSubmitBusy(true)
    try {
      const res = await publicApi.post<SubmitResult>('/leaves/public', {
        personnel_code: code,
        leave_type: type,
        start_jalali_date: startDate,
        end_jalali_date: endDate,
        start_clock: type === 'hourly' ? startClock : null,
        end_clock: type === 'hourly' ? endClock : null,
        reason: reason.trim(),
      })
      setResult(res.data)
      setStep('done')
    } catch (err) {
      setSubmitError(errorMessage(err, 'ثبت درخواست انجام نشد'))
    } finally {
      setSubmitBusy(false)
    }
  }

  function reset() {
    setStep('code')
    setCode('')
    setEmployee(null)
    setLookupError('')
    setType('daily')
    setStartDate(toJalaliString())
    setEndDate(toJalaliString())
    setStartClock('08:00')
    setEndClock('12:00')
    setReason('')
    setShowErrors(false)
    setSubmitError('')
    setResult(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 via-ink-50 to-ink-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        {/* سربرگ */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/25">
            <CalendarClock size={26} />
          </div>
          <h1 className="text-xl font-bold text-ink-900">فرم درخواست مرخصی</h1>
          <p className="mt-1 text-sm text-ink-500">
            سامانه حضور و غیاب — {jalaliLong()}
          </p>
        </div>

        <div className="card p-5 sm:p-6">
          {step === 'code' && (
            <form onSubmit={lookup}>
              <Field label="کد پرسنلی" required error={lookupError}>
                <input
                  className="input text-center text-lg tracking-[0.3em]"
                  dir="ltr"
                  inputMode="numeric"
                  autoFocus
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value)
                    setLookupError('')
                  }}
                  placeholder="۱۲۳۴"
                />
              </Field>
              <button
                type="submit"
                className="btn-primary mt-5 w-full py-3"
                disabled={lookupBusy || !normalizeDigits(code).trim()}
              >
                {lookupBusy && <Spinner className="size-4" />}
                ادامه
              </button>
              <p className="mt-4 text-center text-xs leading-6 text-ink-400">
                کد پرسنلی خود را وارد کنید تا نام شما تأیید شود.
              </p>
            </form>
          )}

          {step === 'form' && employee && (
            <div className="space-y-4">
              {/* کارت هویت */}
              <div className="flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
                <div>
                  <p className="text-xs text-brand-700/70">درخواست‌دهنده</p>
                  <p className="font-bold text-brand-900">{employee.full_name}</p>
                  <p className="text-xs text-brand-700/70">
                    کد پرسنلی: {toPersianDigits(employee.personnel_code)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => {
                    setStep('code')
                    setLookupError('')
                  }}
                >
                  <ArrowLeft size={14} />
                  تغییر
                </button>
              </div>

              {/* نوع مرخصی */}
              <div>
                <label className="label">
                  نوع مرخصی<span className="mr-1 text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {LEAVE_TYPES.map(({ value, label, hint, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setType(value)}
                      className={clsx(
                        'flex items-start gap-2.5 rounded-xl border p-3 text-right transition',
                        type === value
                          ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100'
                          : 'border-ink-200 bg-white hover:border-ink-300',
                      )}
                    >
                      <Icon
                        size={18}
                        className={clsx(
                          'mt-0.5 shrink-0',
                          type === value ? 'text-brand-600' : 'text-ink-400',
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink-800">{label}</span>
                        <span className="block text-[11px] leading-4 text-ink-400">{hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* بازهٔ تاریخ */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="از تاریخ" required>
                  <JalaliDatePicker value={startDate} onChange={setStartDate} />
                </Field>
                <Field label="تا تاریخ" required>
                  <JalaliDatePicker value={endDate} onChange={setEndDate} />
                </Field>
              </div>

              {type === 'hourly' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="از ساعت" required hint="نمونه: ۰۸:۳۰">
                    <input
                      className="input"
                      dir="ltr"
                      type="time"
                      value={startClock}
                      onChange={(e) => setStartClock(e.target.value)}
                    />
                  </Field>
                  <Field label="تا ساعت" required hint="نمونه: ۱۲:۰۰">
                    <input
                      className="input"
                      dir="ltr"
                      type="time"
                      value={endClock}
                      onChange={(e) => setEndClock(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {/* توضیحات — اجباری */}
              <Field
                label="توضیحات و علت مرخصی"
                required
                error={reasonError}
                hint={!reasonError ? 'نوشتن علت درخواست الزامی است.' : undefined}
              >
                <textarea
                  className={clsx('input min-h-24 resize-y', reasonError && 'border-rose-400')}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثلاً: مراجعه به پزشک به‌همراه فرزند"
                  maxLength={1000}
                />
              </Field>

              {submitError && (
                <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
                  {submitError}
                </p>
              )}

              <button
                type="button"
                className="btn-primary w-full py-3"
                onClick={submit}
                disabled={submitBusy}
              >
                {submitBusy && <Spinner className="size-4" />}
                ثبت درخواست
              </button>
              <p className="text-center text-xs leading-6 text-ink-400">
                پس از ثبت، درخواست برای تأیید مدیر ارسال می‌شود.
              </p>
            </div>
          )}

          {step === 'done' && result && (
            <div className="py-4 text-center">
              <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 size={36} />
              </div>
              <h2 className="text-lg font-bold text-ink-900">درخواست شما ثبت شد</h2>
              <p className="mt-1 text-sm text-ink-500">{result.message}</p>

              <dl className="mt-5 space-y-2 rounded-xl bg-ink-50 p-4 text-right text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-400">نام</dt>
                  <dd className="font-medium text-ink-800">{result.employee_name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-400">نوع</dt>
                  <dd className="font-medium text-ink-800">{result.leave_type_fa}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-400">از</dt>
                  <dd className="font-medium text-ink-800">
                    {toPersianDigits(result.start_jalali)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-400">تا</dt>
                  <dd className="font-medium text-ink-800">{toPersianDigits(result.end_jalali)}</dd>
                </div>
              </dl>

              <button className="btn-ghost mt-5 w-full py-3" onClick={reset}>
                ثبت درخواست جدید
              </button>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-ink-400">
          این صفحه عمومی است و نیازی به ورود ندارد.
        </p>
      </div>
    </div>
  )
}
