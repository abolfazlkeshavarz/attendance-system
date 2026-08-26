/** منطق تبلت ورودی: دوربین، گالری چهره، صف آفلاین و همگام‌سازی. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { deviceKey, kioskApi } from '../lib/api'
import type { FaceGallery, GalleryItem } from '../lib/types'
import type { MatchCandidate } from '../lib/faceEngine'
import { faceEngine } from '../lib/faceEngine'
import {
  enqueue,
  gallerySavedAt,
  lastKindFor,
  loadGallery,
  markAttempt,
  newUuid,
  queued,
  queueSize,
  rememberLastKind,
  removeMany,
  saveGallery,
} from '../lib/offlineQueue'

export const APP_VERSION = '1.0.0'

export interface KioskSettings {
  face_threshold: number
  min_seconds_between_punches: number
  require_liveness: boolean
  liveness_turn_threshold: number
  liveness_timeout_seconds: number
}

const FALLBACK_SETTINGS: KioskSettings = {
  face_threshold: 0.6,
  min_seconds_between_punches: 60,
  require_liveness: true,
  liveness_turn_threshold: 0.06,
  liveness_timeout_seconds: 12,
}

/**
 * تنظیمات را از سرور می‌گیرد و در حافظه محلی نگه می‌دارد.
 *
 * اگر تبلت آفلاین بالا بیاید، آخرین تنظیمات ذخیره‌شده استفاده می‌شود — نه مقادیر
 * پیش‌فرض. مهم است که تشخیص زنده بودن با قطع اینترنت بی‌سروصدا خاموش نشود.
 */
export function useKioskSettings(enabled: boolean) {
  const [settings, setSettings] = useState<KioskSettings>(() => {
    const cached = localStorage.getItem('att.kioskSettings')
    return cached ? { ...FALLBACK_SETTINGS, ...JSON.parse(cached) } : FALLBACK_SETTINGS
  })

  useEffect(() => {
    if (!enabled) return
    kioskApi
      .get('/kiosk/handshake')
      .then((res) => {
        const fresh = { ...FALLBACK_SETTINGS, ...res.data.settings }
        localStorage.setItem('att.kioskSettings', JSON.stringify(fresh))
        setSettings(fresh)
      })
      .catch(() => undefined)
  }, [enabled])

  return settings
}

export type KioskPhase = 'setup' | 'booting' | 'scanning' | 'greeting' | 'error'

export function toCandidates(items: GalleryItem[]): MatchCandidate[] {
  return items.map((item) => ({
    employeeId: item.employee_id,
    fullName: item.full_name,
    personnelCode: item.personnel_code,
    photoPath: item.photo_path,
    departmentName: item.department_name,
    vectors: item.vectors.map((v) => Float32Array.from(v)),
  }))
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

/** دوربین جلوی تبلت. */
export function useCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!active) return
    let stream: MediaStream | null = null
    let cancelled = false

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setRunning(true)
          setError('')
        }
      } catch (err) {
        const name = (err as DOMException)?.name
        setError(
          name === 'NotAllowedError'
            ? 'دسترسی به دوربین داده نشده است. از تنظیمات مرورگر اجازه دسترسی به دوربین را فعال کنید.'
            : name === 'NotFoundError'
              ? 'دوربینی روی این دستگاه پیدا نشد.'
              : 'دوربین در دسترس نیست. اتصال و مجوزها را بررسی کنید.',
        )
        setRunning(false)
      }
    }

    void start()
    return () => {
      cancelled = true
      setRunning(false)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [active])

  return { videoRef, error, running }
}

/** گالری چهره‌ها: از سرور می‌گیرد، در IndexedDB نگه می‌دارد، آفلاین هم کار می‌کند. */
export function useGallery(enabled: boolean) {
  const [gallery, setGallery] = useState<FaceGallery | null>(null)
  const [candidates, setCandidates] = useState<MatchCandidate[]>([])
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)

  const apply = useCallback((data: FaceGallery) => {
    setGallery(data)
    setCandidates(toCandidates(data.items))
  }, [])

  const refresh = useCallback(
    async (force = false) => {
      setSyncing(true)
      try {
        const cached = await loadGallery()
        if (cached && !force) {
          apply(cached)
          setSavedAt(await gallerySavedAt())
        }
        // بررسی نسخه سرور — اگر تغییر کرده بود، دوباره دانلود کن
        const version = (await kioskApi.get<{ version: string }>('/kiosk/gallery/version')).data
        if (!cached || force || cached.version !== version.version) {
          const fresh = (await kioskApi.get<FaceGallery>('/kiosk/gallery')).data
          await saveGallery(fresh)
          apply(fresh)
          setSavedAt(Date.now())
        }
      } catch {
        // آفلاین: به نسخه ذخیره‌شده بسنده کن
        const cached = await loadGallery()
        if (cached) {
          apply(cached)
          setSavedAt(await gallerySavedAt())
        }
      } finally {
        setSyncing(false)
      }
    },
    [apply],
  )

  useEffect(() => {
    if (enabled) void refresh()
  }, [enabled, refresh])

  return { gallery, candidates, savedAt, syncing, refresh }
}

export interface SyncState {
  pending: number
  lastSyncAt: number | null
  lastResult: string
  syncing: boolean
}

/** صف آفلاین و ارسال دسته‌ای آن. */
export function useSyncQueue(online: boolean) {
  const [state, setState] = useState<SyncState>({
    pending: 0,
    lastSyncAt: null,
    lastResult: '',
    syncing: false,
  })

  const refreshCount = useCallback(async () => {
    const pending = await queueSize()
    setState((s) => ({ ...s, pending }))
  }, [])

  const flush = useCallback(async () => {
    if (!navigator.onLine) return
    const items = await queued()
    if (items.length === 0) {
      await refreshCount()
      return
    }
    setState((s) => ({ ...s, syncing: true }))
    try {
      const res = await kioskApi.post('/kiosk/sync', {
        app_version: APP_VERSION,
        records: items.map((item) => ({
          employee_id: item.employee_id,
          kind: item.kind,
          method: item.method,
          happened_at: item.happened_at,
          confidence: item.confidence,
          client_uuid: item.client_uuid,
          created_offline: true,
          snapshot_base64: item.snapshot_base64,
        })),
      })
      const results: { client_uuid: string; status: string }[] = res.data.results ?? []
      // رکوردهای ثبت‌شده و تکراری از صف حذف می‌شوند؛ ردشده‌ها فقط شمارش می‌شوند
      const settled = results
        .filter((r) => r.status === 'created' || r.status === 'duplicate')
        .map((r) => r.client_uuid)
      const rejected = results.filter((r) => r.status === 'rejected').map((r) => r.client_uuid)
      await removeMany(settled)
      await markAttempt(rejected)
      setState({
        pending: await queueSize(),
        lastSyncAt: Date.now(),
        lastResult: `${res.data.created} تردد ارسال شد`,
        syncing: false,
      })
    } catch {
      setState((s) => ({ ...s, syncing: false, lastResult: 'ارسال ناموفق — دوباره تلاش می‌شود' }))
    }
  }, [refreshCount])

  useEffect(() => {
    void refreshCount()
  }, [refreshCount])

  // به‌محض وصل شدن اینترنت و سپس هر ۲ دقیقه، صف را خالی کن
  useEffect(() => {
    if (!online) return
    void flush()
    const timer = setInterval(() => void flush(), 120_000)
    return () => clearInterval(timer)
  }, [online, flush])

  // اعلام وضعیت به سرور تا پنل مدیریت بداند چند تردد روی این تبلت معطل مانده
  useEffect(() => {
    if (!online) return
    const beat = async () => {
      try {
        await kioskApi.post('/kiosk/heartbeat', {
          pending_count: await queueSize(),
          app_version: APP_VERSION,
        })
      } catch {
        // آفلاین — ضربان بعدی دوباره تلاش می‌کند
      }
    }
    void beat()
    const timer = setInterval(() => void beat(), 120_000)
    return () => clearInterval(timer)
  }, [online, state.pending])

  return { ...state, flush, refreshCount }
}

export interface PunchOutcome {
  ok: boolean
  kind: 'in' | 'out'
  message: string
  offline: boolean
}

/**
 * ثبت یک تردد: اول تلاش برای ارسال آنلاین، در غیر این صورت ذخیره در صف.
 * در هر دو حالت `client_uuid` یکسان است تا رکورد تکراری ساخته نشود.
 */
export async function submitPunch(params: {
  employeeId: number
  employeeName: string
  method: 'face' | 'pin'
  confidence?: number | null
  snapshot?: string | null
  forcedKind?: 'in' | 'out'
}): Promise<PunchOutcome> {
  const clientUuid = newUuid()
  const happenedAt = new Date().toISOString()
  const remembered = await lastKindFor(params.employeeId)
  const kind: 'in' | 'out' = params.forcedKind ?? (remembered === 'in' ? 'out' : 'in')

  const payload = {
    employee_id: params.employeeId,
    kind,
    method: params.method,
    happened_at: happenedAt,
    confidence: params.confidence ?? null,
    client_uuid: clientUuid,
    created_offline: false,
    snapshot_base64: params.snapshot ?? null,
  }

  if (navigator.onLine) {
    try {
      const res = await kioskApi.post('/kiosk/punch', payload)
      const serverKind = (res.data.kind as 'in' | 'out') ?? kind
      await rememberLastKind(params.employeeId, serverKind)
      return {
        ok: res.data.status !== 'rejected',
        kind: serverKind,
        message: res.data.status === 'duplicate' ? 'این تردد قبلاً ثبت شده بود' : 'ثبت شد',
        offline: false,
      }
    } catch {
      // به صف آفلاین برمی‌گردیم
    }
  }

  await enqueue({
    client_uuid: clientUuid,
    employee_id: params.employeeId,
    employee_name: params.employeeName,
    kind,
    method: params.method,
    happened_at: happenedAt,
    confidence: params.confidence ?? null,
    snapshot_base64: params.snapshot ?? null,
  })
  await rememberLastKind(params.employeeId, kind)
  return { ok: true, kind, message: 'ذخیره شد؛ پس از وصل شدن اینترنت ارسال می‌شود', offline: true }
}

/** بارگذاری مدل‌های تشخیص چهره با گزارش وضعیت. */
export function useFaceModels(enabled: boolean) {
  const [ready, setReady] = useState(faceEngine.ready)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled || ready) return
    let cancelled = false
    faceEngine
      .load()
      .then(() => !cancelled && setReady(true))
      .catch(() => !cancelled && setError('بارگذاری مدل تشخیص چهره ناموفق بود'))
    return () => {
      cancelled = true
    }
  }, [enabled, ready])

  return { ready, error }
}

export function hasDeviceKey(): boolean {
  return deviceKey.get().length > 0
}
