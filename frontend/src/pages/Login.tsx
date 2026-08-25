import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Fingerprint, Lock, User as UserIcon } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/api'
import { ErrorBlock, Field, Spinner } from '../components/ui'
import { jalaliLong } from '../lib/jalali'

export default function Login() {
  const { user, login, loading } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(username.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(err, 'ورود ناموفق بود'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* ستون تبلیغاتی */}
      <div className="relative hidden flex-col justify-between bg-ink-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-brand-600">
            <Fingerprint size={22} />
          </div>
          <span className="text-lg font-bold">سامانه حضور و غیاب</span>
        </div>

        <div className="max-w-md">
          <h2 className="text-3xl font-bold leading-relaxed">
            ثبت خودکار ورود و خروج پرسنل با تشخیص چهره
          </h2>
          <p className="mt-4 leading-8 text-ink-300">
            پرسنل کافی است روبه‌روی تبلت ورودی بایستد؛ سامانه او را شناسایی می‌کند و تردد ثبت
            می‌شود. حتی اگر اینترنت قطع باشد، اطلاعات روی دستگاه ذخیره و پس از وصل شدن، به‌صورت
            خودکار همگام‌سازی می‌شود.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-ink-300">
            {[
              'گزارش روزانه، هفتگی و ماهانه با خروجی اکسل',
              'مدیریت شرح وظایف و تکالیف پرسنل',
              'محاسبه تأخیر، تعجیل، اضافه‌کاری و مرخصی',
              'تقویم کامل شمسی و تعطیلات رسمی',
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <span className="size-1.5 rounded-full bg-brand-400" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-ink-500">{jalaliLong()}</p>
      </div>

      {/* فرم ورود */}
      <div className="flex items-center justify-center bg-white px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 text-center lg:text-right">
            <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-brand-600 text-white lg:hidden">
              <Fingerprint size={24} />
            </div>
            <h1 className="text-2xl font-bold text-ink-900">ورود به پنل مدیریت</h1>
            <p className="mt-1.5 text-sm text-ink-500">
              برای مشاهده گزارش‌ها و مدیریت پرسنل وارد شوید
            </p>
          </div>

          {error && (
            <div className="mb-4">
              <ErrorBlock message={error} />
            </div>
          )}

          <Field label="نام کاربری" required className="mb-4">
            <div className="relative">
              <UserIcon
                size={16}
                className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-400"
              />
              <input
                className="input ps-10"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="admin"
                required
              />
            </div>
          </Field>

          <Field label="رمز عبور" required className="mb-6">
            <div className="relative">
              <Lock
                size={16}
                className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-400"
              />
              <input
                className="input ps-10"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
            </div>
          </Field>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner className="size-4" />}
            ورود به سامانه
          </button>

          <p className="mt-6 text-center text-xs leading-6 text-ink-400">
            اگر تازه سامانه را راه‌اندازی کرده‌اید، با نام کاربری <b className="text-ink-600">admin</b>{' '}
            و رمز <b className="text-ink-600">admin1234</b> وارد شوید و بلافاصله رمز را تغییر دهید.
          </p>
        </form>
      </div>
    </div>
  )
}
