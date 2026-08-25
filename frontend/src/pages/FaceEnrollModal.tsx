import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, CheckCircle2, RefreshCw, ScanFace, Trash2, TriangleAlert } from 'lucide-react'
import clsx from 'clsx'
import { api, errorMessage } from '../lib/api'
import type { Employee, FaceSample } from '../lib/types'
import { cropFace, faceEngine } from '../lib/faceEngine'
import { toPersianDigits } from '../lib/jalali'
import { Modal, Spinner, useToast } from '../components/ui'

const TARGET_SAMPLES = 3
const POSES = [
  'مستقیم به دوربین نگاه کنید',
  'کمی سر را به راست بچرخانید',
  'کمی سر را به چپ بچرخانید',
  'کمی لبخند بزنید',
]

/**
 * ثبت چهره پرسنل.
 *
 * بردار ویژگی همین‌جا در مرورگر استخراج می‌شود و فقط ۱۲۸ عدد به سرور می‌رود —
 * تصویر خام اختیاری است و صرفاً برای نمایش پروفایل ذخیره می‌شود.
 * چند نمونه از زوایای مختلف، دقت تشخیص روی تبلت را به‌طور محسوسی بالا می‌برد.
 */
export function FaceEnrollModal({
  employee,
  open,
  onClose,
}: {
  employee: Employee | null
  open: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const qc = useQueryClient()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [modelsReady, setModelsReady] = useState(faceEngine.ready)
  const [cameraError, setCameraError] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [liveState, setLiveState] = useState<'searching' | 'ok' | 'far'>('searching')

  const { data: samples, isLoading } = useQuery({
    queryKey: ['faces', employee?.id],
    queryFn: async () =>
      (await api.get<FaceSample[]>(`/employees/${employee!.id}/faces`)).data,
    enabled: open && !!employee,
  })

  // مدل‌ها
  useEffect(() => {
    if (!open || modelsReady) return
    faceEngine
      .load()
      .then(() => setModelsReady(true))
      .catch(() => toast.error('بارگذاری مدل تشخیص چهره ناموفق بود'))
  }, [open, modelsReady, toast])

  // دوربین
  useEffect(() => {
    if (!open) return
    let stream: MediaStream | null = null
    let cancelled = false

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
      .then(async (s) => {
        stream = s
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = s
          await videoRef.current.play()
        }
      })
      .catch(() =>
        setCameraError('دسترسی به دوربین ممکن نشد. مجوز دوربین را در مرورگر فعال کنید.'),
      )

    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [open])

  // بازخورد زنده: آیا چهره در کادر هست و اندازه‌اش مناسب است؟
  useEffect(() => {
    if (!open || !modelsReady) return
    const timer = setInterval(async () => {
      const video = videoRef.current
      if (!video || video.readyState < 2 || capturing) return
      const face = await faceEngine.detect(video)
      if (!face) setLiveState('searching')
      else if (face.box.width < video.videoWidth * 0.16) setLiveState('far')
      else setLiveState('ok')
    }, 600)
    return () => clearInterval(timer)
  }, [open, modelsReady, capturing])

  const enroll = useMutation({
    mutationFn: async (payload: { vector: number[]; image_base64: string | null; quality: number }) =>
      (await api.post(`/employees/${employee!.id}/faces`, payload)).data,
    onSuccess: () => {
      toast.success('نمونه چهره ثبت شد')
      void qc.invalidateQueries({ queryKey: ['faces', employee?.id] })
      void qc.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: async (faceId: number) =>
      (await api.delete(`/employees/${employee!.id}/faces/${faceId}`)).data,
    onSuccess: () => {
      toast.success('نمونه حذف شد')
      void qc.invalidateQueries({ queryKey: ['faces', employee?.id] })
      void qc.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const capture = useCallback(async () => {
    const video = videoRef.current
    if (!video || !modelsReady) return
    setCapturing(true)
    try {
      const face = await faceEngine.detect(video)
      if (!face) {
        toast.error('چهره‌ای در تصویر پیدا نشد. نور محیط و فاصله را بررسی کنید.')
        return
      }
      if (face.box.width < video.videoWidth * 0.16) {
        toast.error('چهره خیلی کوچک است — به دوربین نزدیک‌تر شوید.')
        return
      }
      await enroll.mutateAsync({
        vector: Array.from(face.descriptor),
        image_base64: cropFace(video, face.box),
        quality: Math.round(face.score * 100) / 100,
      })
    } finally {
      setCapturing(false)
    }
  }, [enroll, modelsReady, toast])

  if (!employee) return null

  const count = samples?.length ?? 0
  const enough = count >= TARGET_SAMPLES

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`ثبت چهره — ${employee.full_name}`}
      size="lg"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            بستن
          </button>
          <button
            className="btn-primary"
            onClick={() => void capture()}
            disabled={!modelsReady || capturing || enroll.isPending || !!cameraError}
          >
            {capturing || enroll.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <Camera size={16} />
            )}
            ثبت نمونه {toPersianDigits(count + 1)}
          </button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="relative aspect-4/3 overflow-hidden rounded-2xl bg-ink-900">
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full scale-x-[-1] object-cover"
            />
            {/* کادر راهنما */}
            <div
              className={clsx(
                'pointer-events-none absolute left-1/2 top-1/2 size-52 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 transition',
                liveState === 'ok'
                  ? 'border-emerald-400'
                  : liveState === 'far'
                    ? 'border-amber-400'
                    : 'border-white/40',
              )}
            />
            {cameraError && (
              <div className="absolute inset-0 grid place-items-center bg-ink-900/85 px-6 text-center text-sm leading-7 text-rose-200">
                {cameraError}
              </div>
            )}
            {!modelsReady && !cameraError && (
              <div className="absolute inset-0 grid place-items-center bg-ink-900/70 text-sm text-white">
                <span className="flex items-center gap-2">
                  <RefreshCw size={16} className="animate-spin" />
                  آماده‌سازی موتور تشخیص چهره…
                </span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-900 to-transparent px-4 py-3 text-center text-sm text-white">
              {liveState === 'ok'
                ? POSES[count % POSES.length]
                : liveState === 'far'
                  ? 'کمی نزدیک‌تر شوید'
                  : 'چهره‌ای در کادر دیده نمی‌شود'}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-xl bg-brand-50 px-3.5 py-2.5 text-xs leading-6 text-brand-800">
            <ScanFace size={16} className="shrink-0" />
            تصویر از دستگاه خارج نمی‌شود؛ فقط بردار عددی چهره ذخیره می‌گردد.
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="font-bold text-ink-800">نمونه‌های ثبت‌شده</h4>
            <span
              className={clsx(
                'badge',
                enough ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
              )}
            >
              {enough ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />}
              {toPersianDigits(count)} از {toPersianDigits(TARGET_SAMPLES)}
            </span>
          </div>

          {!enough && (
            <p className="mb-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs leading-6 text-amber-800">
              برای تشخیص مطمئن روی تبلت، حداقل {toPersianDigits(TARGET_SAMPLES)} نمونه از زوایای
              مختلف ثبت کنید.
            </p>
          )}

          {isLoading ? (
            <div className="py-8 text-center text-sm text-ink-400">در حال بارگذاری…</div>
          ) : count === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink-200 py-10 text-center text-sm text-ink-400">
              هنوز نمونه‌ای ثبت نشده است
            </div>
          ) : (
            <ul className="space-y-2">
              {samples!.map((s, index) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-xl border border-ink-200 p-2.5"
                >
                  {s.image_path ? (
                    <img
                      src={`/static/${s.image_path}`}
                      alt=""
                      className="size-12 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="grid size-12 place-items-center rounded-lg bg-ink-100 text-ink-400">
                      <ScanFace size={20} />
                    </div>
                  )}
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-ink-800">نمونه {toPersianDigits(index + 1)}</p>
                    <p className="text-xs text-ink-400">
                      کیفیت: {s.quality ? toPersianDigits(Math.round(s.quality * 100)) + '٪' : '—'}
                    </p>
                  </div>
                  <button
                    onClick={() => remove.mutate(s.id)}
                    className="rounded-lg p-2 text-ink-400 transition hover:bg-rose-50 hover:text-rose-600"
                    title="حذف نمونه"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
