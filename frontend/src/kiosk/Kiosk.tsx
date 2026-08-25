import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  CloudOff,
  Cloud,
  Delete,
  Fingerprint,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  ScanFace,
  Settings2,
  Users,
} from 'lucide-react'
import clsx from 'clsx'
import { deviceKey, errorMessage, kioskApi } from '../lib/api'
import { jalaliLong, tehranClock, toPersianDigits } from '../lib/jalali'
import {
  captureSnapshot,
  DEFAULT_THRESHOLD,
  distanceToConfidence,
  faceEngine,
  findBestMatch,
  type MatchResult,
} from '../lib/faceEngine'
import {
  hasDeviceKey,
  submitPunch,
  useCamera,
  useFaceModels,
  useGallery,
  useOnline,
  useSyncQueue,
} from './useKiosk'

type Screen = 'setup' | 'scan' | 'result' | 'pin'

interface Greeting {
  name: string
  kind: 'in' | 'out'
  offline: boolean
  message: string
  photo?: string | null
  department?: string | null
}

export default function Kiosk() {
  const [screen, setScreen] = useState<Screen>(hasDeviceKey() ? 'scan' : 'setup')
  const online = useOnline()
  const sync = useSyncQueue(online)
  const paired = screen !== 'setup'

  const { gallery, candidates, savedAt, syncing, refresh } = useGallery(paired)
  const threshold = gallery?.threshold ?? DEFAULT_THRESHOLD
  const models = useFaceModels(paired)
  const { videoRef, error: cameraError, running } = useCamera(paired)

  const [greeting, setGreeting] = useState<Greeting | null>(null)
  const [hint, setHint] = useState('صورتتان را مقابل دوربین قرار دهید')
  const busyRef = useRef(false)
  const cooldownRef = useRef<Record<number, number>>({})

  const clock = useClock()

  // ------------------------------------------------------------- حلقه تشخیص
  const scanTick = useCallback(async () => {
    if (busyRef.current || !running || !models.ready || screen !== 'scan') return
    const video = videoRef.current
    if (!video || video.readyState < 2) return

    busyRef.current = true
    try {
      const face = await faceEngine.detect(video)
      if (!face) {
        setHint('صورتتان را مقابل دوربین قرار دهید')
        return
      }
      if (face.box.width < video.videoWidth * 0.12) {
        setHint('کمی به دوربین نزدیک‌تر شوید')
        return
      }

      const match: MatchResult | null = findBestMatch(face.descriptor, candidates, threshold)
      if (!match) {
        setHint('شناسایی نشدید — از کد پرسنلی استفاده کنید')
        return
      }

      // جلوگیری از ثبت پشت‌سرهم برای یک نفر
      const last = cooldownRef.current[match.candidate.employeeId] ?? 0
      if (Date.now() - last < 20_000) {
        setHint(`${match.candidate.fullName} — تردد شما ثبت شده است`)
        return
      }
      cooldownRef.current[match.candidate.employeeId] = Date.now()

      const snapshot = captureSnapshot(video)
      const outcome = await submitPunch({
        employeeId: match.candidate.employeeId,
        employeeName: match.candidate.fullName,
        method: 'face',
        confidence: distanceToConfidence(match.distance, threshold),
        snapshot,
      })

      setGreeting({
        name: match.candidate.fullName,
        kind: outcome.kind,
        offline: outcome.offline,
        message: outcome.message,
        photo: match.candidate.photoPath,
        department: match.candidate.departmentName,
      })
      setScreen('result')
      void sync.refreshCount()
    } catch {
      // خطای گذرا در یک فریم — حلقه ادامه پیدا می‌کند
    } finally {
      busyRef.current = false
    }
  }, [candidates, models.ready, running, screen, sync, threshold, videoRef])

  useEffect(() => {
    if (screen !== 'scan') return
    const timer = setInterval(() => void scanTick(), 700)
    return () => clearInterval(timer)
  }, [scanTick, screen])

  // بازگشت خودکار به صفحه اسکن پس از نمایش خوش‌آمدگویی
  useEffect(() => {
    if (screen !== 'result') return
    const timer = setTimeout(() => {
      setScreen('scan')
      setGreeting(null)
      setHint('صورتتان را مقابل دوربین قرار دهید')
    }, 4000)
    return () => clearTimeout(timer)
  }, [screen])

  if (screen === 'setup') {
    return <SetupScreen onPaired={() => setScreen('scan')} />
  }

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-ink-900 text-white">
      <TopBar
        online={online}
        pending={sync.pending}
        syncing={sync.syncing || syncing}
        peopleCount={candidates.length}
        savedAt={savedAt}
        onRefresh={() => void refresh(true)}
        onSync={() => void sync.flush()}
        onReset={() => {
          deviceKey.clear()
          setScreen('setup')
        }}
      />

      <div className="relative flex flex-1 items-center justify-center">
        {/* ویدیو زنده */}
        <video
          ref={videoRef}
          muted
          playsInline
          className={clsx(
            'absolute inset-0 h-full w-full scale-x-[-1] object-cover transition',
            screen === 'result' ? 'blur-md brightness-50' : 'brightness-90',
          )}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/25 to-ink-900/60" />

        {screen === 'scan' && (
          <ScanOverlay
            hint={hint}
            cameraError={cameraError}
            modelsReady={models.ready}
            modelsError={models.error}
            peopleCount={candidates.length}
            onPinMode={() => setScreen('pin')}
          />
        )}

        {screen === 'result' && greeting && <GreetingCard greeting={greeting} />}

        {screen === 'pin' && (
          <PinPad
            onDone={(g) => {
              setGreeting(g)
              setScreen('result')
              void sync.refreshCount()
            }}
            onCancel={() => setScreen('scan')}
          />
        )}
      </div>

      <footer className="flex items-center justify-between px-8 py-4 text-sm text-ink-300">
        <span>{jalaliLong()}</span>
        <span className="text-3xl font-bold tabular-nums text-white">
          {toPersianDigits(clock)}
        </span>
        <span>{candidates.length > 0 ? `${toPersianDigits(candidates.length)} پرسنل ثبت‌شده` : '—'}</span>
      </footer>
    </div>
  )
}

// ------------------------------------------------------------------- ساعت زنده

function useClock() {
  const [clock, setClock] = useState(tehranClock())
  useEffect(() => {
    const timer = setInterval(() => setClock(tehranClock()), 1000)
    return () => clearInterval(timer)
  }, [])
  return clock
}

// -------------------------------------------------------------------- نوار بالا

function TopBar({
  online,
  pending,
  syncing,
  peopleCount,
  savedAt,
  onRefresh,
  onSync,
  onReset,
}: {
  online: boolean
  pending: number
  syncing: boolean
  peopleCount: number
  savedAt: number | null
  onRefresh: () => void
  onSync: () => void
  onReset: () => void
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
        onClick={onReset}
        className="rounded-lg p-2 text-ink-300 transition hover:bg-white/10 hover:text-white"
        title="تنظیمات دستگاه"
      >
        <Settings2 size={16} />
      </button>
    </header>
  )
}

// ------------------------------------------------------------------ صفحه اسکن

function ScanOverlay({
  hint,
  cameraError,
  modelsReady,
  modelsError,
  peopleCount,
  onPinMode,
}: {
  hint: string
  cameraError: string
  modelsReady: boolean
  modelsError: string
  peopleCount: number
  onPinMode: () => void
}) {
  const blocking = cameraError || modelsError

  return (
    <div className="relative z-10 flex flex-col items-center gap-6 px-6 text-center">
      <div className="relative">
        <div className="pulse-ring relative grid size-40 place-items-center rounded-full border-4 border-brand-400/70 text-brand-400">
          <ScanFace size={64} className="text-white" />
        </div>
      </div>

      {blocking ? (
        <div className="max-w-lg rounded-2xl border border-rose-400/40 bg-rose-500/15 px-6 py-4 text-rose-100">
          <p className="font-bold">{cameraError ? 'دوربین در دسترس نیست' : 'مدل تشخیص چهره'}</p>
          <p className="mt-1 text-sm leading-7">{cameraError || modelsError}</p>
        </div>
      ) : !modelsReady ? (
        <div className="flex items-center gap-2.5 text-ink-200">
          <RefreshCw size={18} className="animate-spin" />
          در حال آماده‌سازی موتور تشخیص چهره…
        </div>
      ) : (
        <>
          <h2 className="text-3xl font-bold">{hint}</h2>
          {peopleCount === 0 && (
            <p className="max-w-md text-sm leading-7 text-amber-300">
              هنوز چهره هیچ پرسنلی ثبت نشده است. از پنل مدیریت، بخش «پرسنل ← ثبت چهره» را تکمیل
              کنید.
            </p>
          )}
        </>
      )}

      <button onClick={onPinMode} className="btn bg-white/10 px-6 py-3 text-base text-white hover:bg-white/20">
        <KeyRound size={18} />
        ثبت با کد پرسنلی
      </button>
    </div>
  )
}

// ------------------------------------------------------------- خوش‌آمدگویی

function GreetingCard({ greeting }: { greeting: Greeting }) {
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

// ---------------------------------------------------------------- کد پرسنلی

function PinPad({
  onDone,
  onCancel,
}: {
  onDone: (greeting: Greeting) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<'code' | 'pin'>('code')
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const value = step === 'code' ? code : pin
  const setValue = step === 'code' ? setCode : setPin

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const res = await kioskApi.post('/kiosk/punch/pin', null, {
        params: { personnel_code: code, pin },
      })
      onDone({
        name: res.data.message?.split(' — ')[0] ?? 'پرسنل',
        kind: (res.data.kind as 'in' | 'out') ?? 'in',
        offline: false,
        message: 'ثبت شد',
      })
    } catch (err) {
      setError(errorMessage(err, 'ثبت ناموفق بود'))
      setPin('')
      setStep('pin')
    } finally {
      setBusy(false)
    }
  }

  function press(key: string) {
    setError('')
    if (key === 'del') {
      setValue(value.slice(0, -1))
      return
    }
    if (key === 'ok') {
      if (step === 'code' && code.length > 0) setStep('pin')
      else if (step === 'pin' && pin.length >= 4) void submit()
      return
    }
    if (value.length < 12) setValue(value + key)
  }

  return (
    <div className="relative z-10 w-full max-w-sm rounded-3xl bg-ink-800/95 p-6 backdrop-blur">
      <h3 className="mb-1 text-center text-xl font-bold">
        {step === 'code' ? 'کد پرسنلی خود را وارد کنید' : 'رمز پشتیبان را وارد کنید'}
      </h3>
      <p className="mb-4 text-center text-sm text-ink-400">
        {step === 'code' ? 'سپس دکمه تأیید را بزنید' : 'رمز ۴ تا ۸ رقمی'}
      </p>

      <div className="mb-4 flex h-14 items-center justify-center rounded-2xl bg-ink-900 text-3xl font-bold tracking-[0.3em]">
        {step === 'code' ? toPersianDigits(code) || '—' : '•'.repeat(pin.length) || '—'}
      </div>

      {error && (
        <p className="mb-3 rounded-xl bg-rose-500/15 px-3 py-2 text-center text-sm text-rose-200">
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((key) => (
          <button
            key={key}
            onClick={() => press(key)}
            disabled={busy}
            className={clsx(
              'grid h-16 place-items-center rounded-2xl text-2xl font-bold transition active:scale-95',
              key === 'ok'
                ? 'bg-brand-600 hover:bg-brand-500'
                : key === 'del'
                  ? 'bg-white/10 hover:bg-white/20'
                  : 'bg-white/10 hover:bg-white/20',
            )}
          >
            {key === 'del' ? (
              <Delete size={24} />
            ) : key === 'ok' ? (
              <CheckCircle2 size={26} />
            ) : (
              toPersianDigits(key)
            )}
          </button>
        ))}
      </div>

      <button onClick={onCancel} className="mt-4 w-full py-2.5 text-sm text-ink-400 hover:text-white">
        انصراف و بازگشت به تشخیص چهره
      </button>
    </div>
  )
}

// ------------------------------------------------------------- راه‌اندازی دستگاه

function SetupScreen({ onPaired }: { onPaired: () => void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [device, setDevice] = useState<{ name: string; location?: string | null } | null>(null)

  async function connect() {
    setBusy(true)
    setError('')
    deviceKey.set(key.trim())
    try {
      const res = await kioskApi.get('/kiosk/handshake')
      setDevice(res.data.device)
      setTimeout(onPaired, 900)
    } catch (err) {
      deviceKey.clear()
      setError(errorMessage(err, 'اتصال ناموفق بود. کلید دستگاه را بررسی کنید.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-ink-900 px-6 text-white">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brand-600">
            <Fingerprint size={28} />
          </div>
          <h1 className="text-2xl font-bold">راه‌اندازی تبلت ورودی</h1>
          <p className="mt-2 text-sm leading-7 text-ink-400">
            از پنل مدیریت، بخش «تنظیمات ← دستگاه‌ها» یک دستگاه جدید بسازید و کلید نمایش‌داده‌شده را
            اینجا وارد کنید. این کلید فقط یک‌بار نمایش داده می‌شود.
          </p>
        </div>

        {device ? (
          <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-5 py-4 text-center">
            <CheckCircle2 className="mx-auto mb-2 text-emerald-300" size={28} />
            <p className="font-bold">دستگاه «{device.name}» متصل شد</p>
            {device.location && <p className="mt-1 text-sm text-emerald-200">{device.location}</p>}
          </div>
        ) : (
          <>
            <input
              className="input mb-3 bg-ink-800 text-center font-mono text-white placeholder:text-ink-500"
              placeholder="کلید دستگاه را اینجا بچسبانید"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoFocus
            />
            {error && (
              <p className="mb-3 rounded-xl bg-rose-500/15 px-3 py-2 text-center text-sm text-rose-200">
                {error}
              </p>
            )}
            <button
              className="btn-primary w-full py-3"
              onClick={connect}
              disabled={busy || key.trim().length < 8}
            >
              {busy && <RefreshCw size={16} className="animate-spin" />}
              اتصال به سرور
            </button>
          </>
        )}
      </div>
    </div>
  )
}
