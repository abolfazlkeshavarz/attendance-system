/**
 * موتور تشخیص چهره — کاملاً داخل مرورگر.
 *
 * چرا سمت مرورگر؟ چون تبلت ورودی کارخانه باید در قطعی اینترنت هم کار کند.
 * مدل‌ها یک‌بار دانلود و توسط Service Worker کش می‌شوند؛ پس از آن تشخیص بدون
 * هیچ ارتباطی با سرور انجام می‌شود و فقط نتیجه (تردد) در صف ارسال قرار می‌گیرد.
 *
 * خروجی مدل یک بردار ۱۲۸ بُعدی نرمال‌شده است؛ تطبیق با فاصله اقلیدسی انجام
 * می‌شود (هرچه کمتر، شبیه‌تر). آستانه پیش‌فرض ۰٫۵۵ است و از سرور خوانده می‌شود.
 */
import * as faceapi from '@vladmandic/face-api'

const MODEL_URL = '/models'

/**
 * آستانه استاندارد این مدل روی بردار خام ۱۲۸بُعدی.
 * بردارها عمداً نرمال‌سازی نمی‌شوند (طول‌شان حدود ۱٫۴ است) چون این عدد
 * برای همان فضای خام کالیبره شده است. سرور هم دقیقاً همین قرارداد را دارد.
 */
export const DEFAULT_THRESHOLD = 0.6

export interface DetectedFace {
  descriptor: Float32Array
  box: { x: number; y: number; width: number; height: number }
  score: number
}

export interface MatchCandidate {
  employeeId: number
  fullName: string
  personnelCode: string
  photoPath?: string | null
  departmentName?: string | null
  vectors: Float32Array[]
}

export interface MatchResult {
  candidate: MatchCandidate
  distance: number
}

type Status = 'idle' | 'loading' | 'ready' | 'error'

class FaceEngine {
  status: Status = 'idle'
  error = ''
  /** موتور فعال TensorFlow: webgl (سریع) یا cpu (کند ولی همه‌جا کار می‌کند) */
  backend = ''
  private loadPromise: Promise<void> | null = null
  private options = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })

  get ready() {
    return this.status === 'ready'
  }

  /** بارگذاری مدل‌ها (یک‌بار). فراخوانی مکرر بی‌خطر است. */
  load(): Promise<void> {
    this.loadPromise ??= this.doLoad()
    return this.loadPromise
  }

  private async doLoad(): Promise<void> {
    this.status = 'loading'
    try {
      await this.selectBackend()
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ])
      this.status = 'ready'
    } catch (err) {
      this.status = 'error'
      this.error =
        err instanceof Error ? err.message : 'بارگذاری مدل‌های تشخیص چهره ناموفق بود'
      this.loadPromise = null
      throw err
    }
  }

  /**
   * انتخاب موتور محاسباتی TensorFlow.
   *
   * توجه: `setBackend` در صورت ناموفق بودن، خطا پرتاب نمی‌کند بلکه `false`
   * برمی‌گرداند. پس حتماً باید مقدار بازگشتی را بررسی کرد، وگرنه روی دستگاهی که
   * WebGL ندارد هیچ موتوری فعال نمی‌شود و تشخیص چهره بی‌صدا از کار می‌افتد.
   */
  private async selectBackend(): Promise<void> {
    // تایپ‌های بسته، سطح tf را کامل صادر نمی‌کنند
    const tf = faceapi.tf as unknown as {
      setBackend: (name: string) => Promise<boolean>
      ready: () => Promise<void>
      getBackend: () => string | null
    }

    for (const name of ['webgl', 'cpu']) {
      try {
        if (await tf.setBackend(name)) {
          await tf.ready()
          this.backend = name
          if (name === 'cpu') {
            console.warn(
              'WebGL در دسترس نیست؛ تشخیص چهره روی CPU اجرا می‌شود و کندتر خواهد بود.',
            )
          }
          return
        }
      } catch {
        // موتور بعدی را امتحان کن
      }
    }
    throw new Error('هیچ موتور محاسباتی در دسترس نیست (نه WebGL و نه CPU)')
  }

  /** یک چهره را در تصویر پیدا می‌کند و بردار ویژگی آن را برمی‌گرداند. */
  async detect(
    input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  ): Promise<DetectedFace | null> {
    if (!this.ready) return null
    const result = await faceapi
      .detectSingleFace(input, this.options)
      .withFaceLandmarks()
      .withFaceDescriptor()

    if (!result) return null
    const { x, y, width, height } = result.detection.box
    return {
      descriptor: result.descriptor,
      box: { x, y, width, height },
      score: result.detection.score,
    }
  }

  /** همه چهره‌های تصویر (برای هشدار «چند نفر جلوی دوربین‌اند»). */
  async detectAll(input: HTMLVideoElement | HTMLCanvasElement): Promise<number> {
    if (!this.ready) return 0
    const results = await faceapi.detectAllFaces(input, this.options)
    return results.length
  }
}

export const faceEngine = new FaceEngine()

// ------------------------------------------------------------------- تطبیق

export function euclidean(a: Float32Array | number[], b: Float32Array | number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum)
}

/**
 * نزدیک‌ترین پرسنل به بردار داده‌شده را پیدا می‌کند.
 * اگر فاصله از آستانه بیشتر باشد، `null` برمی‌گرداند (یعنی شناسایی نشد).
 */
export function findBestMatch(
  descriptor: Float32Array,
  candidates: MatchCandidate[],
  threshold = DEFAULT_THRESHOLD,
): MatchResult | null {
  let best: MatchResult | null = null
  for (const candidate of candidates) {
    for (const vector of candidate.vectors) {
      if (vector.length !== descriptor.length) continue
      const distance = euclidean(descriptor, vector)
      if (!best || distance < best.distance) best = { candidate, distance }
    }
  }
  if (!best || best.distance > threshold) return null
  return best
}

/** فاصله را به درصد اطمینان قابل‌فهم برای کاربر تبدیل می‌کند. */
export function distanceToConfidence(distance: number, threshold = DEFAULT_THRESHOLD): number {
  const raw = 1 - distance / (threshold * 2)
  return Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100
}

/** فریم فعلی ویدیو را به JPEG کوچک تبدیل می‌کند (برای بایگانی تردد). */
export function captureSnapshot(video: HTMLVideoElement, maxWidth = 320): string | null {
  if (!video.videoWidth) return null
  const scale = Math.min(1, maxWidth / video.videoWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.72)
}

/** بریدن ناحیه چهره از فریم — برای تصویر پروفایل هنگام ثبت‌نام. */
export function cropFace(
  video: HTMLVideoElement,
  box: DetectedFace['box'],
  size = 224,
): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const pad = Math.max(box.width, box.height) * 0.28
  const sx = Math.max(0, box.x - pad)
  const sy = Math.max(0, box.y - pad)
  const side = Math.min(
    Math.max(box.width, box.height) + pad * 2,
    video.videoWidth - sx,
    video.videoHeight - sy,
  )
  ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size)
  return canvas.toDataURL('image/jpeg', 0.85)
}
