/**
 * تشخیص زنده بودن چهره (ضد جعل).
 *
 * بدون این بخش، هر کسی می‌تواند عکس چاپی یا عکس روی گوشیِ همکارش را جلوی
 * دوربین بگیرد و به‌جای او تردد بزند.
 *
 * روش کار: پس از شناسایی چهره، از فرد خواسته می‌شود سرش را کمی بچرخاند و
 * برگرداند. یک عکس ثابت هرگز نمی‌تواند این کار را انجام دهد.
 *
 * چرا «چرخش سر» و نه «پلک زدن»؟ پلک زدن حدود ۲۰۰ میلی‌ثانیه طول می‌کشد و روی
 * تبلت که هر فریم چند صد میلی‌ثانیه پردازش می‌برد معمولاً اصلاً دیده نمی‌شود.
 * چرخش سر یک حالت پایدار است و با همین نرخ نمونه‌برداری قابل‌اتکاست.
 * با این حال اگر پلک زدن تصادفاً دیده شود، آن هم پذیرفته می‌شود تا کار سریع‌تر پیش برود.
 *
 * جهت چرخش عمداً مهم نیست: تصویر دوربین روی صفحه آینه‌ای نمایش داده می‌شود و
 * گفتن «به راست بچرخید» می‌تواند برای کاربر گیج‌کننده و برای کد خطاخیز باشد.
 */

export type LivenessState =
  | 'idle'        // هنوز شروع نشده
  | 'centering'   // در حال گرفتن حالت پایه صورت
  | 'turn'        // منتظر چرخش سر
  | 'return'      // چرخید؛ حالا باید برگردد
  | 'passed'      // تأیید شد
  | 'timeout'     // در مهلت مقرر انجام نشد

export interface LivenessSample {
  /** نسبت فاصله نوک بینی تا هر چشم — معیار بی‌بعدِ چرخش افقی سر */
  yaw: number
  /** باز بودن چشم‌ها (Eye Aspect Ratio) — برای تشخیص پلک */
  ear: number
}

export interface LivenessConfig {
  /** حداقل انحراف از حالت پایه که «چرخش» حساب شود */
  turnThreshold: number
  /** برای «برگشت»، باید تا این نسبت از آستانه به مرکز نزدیک شود */
  returnRatio: number
  /** مهلت کل چالش (میلی‌ثانیه) */
  timeoutMs: number
  /** چند نمونه اول برای تعیین حالت پایه صورت استفاده شود */
  baselineSamples: number
}

export const DEFAULT_LIVENESS: LivenessConfig = {
  turnThreshold: 0.06,
  returnRatio: 0.45,
  timeoutMs: 12_000,
  baselineSamples: 3,
}

export class LivenessChallenge {
  state: LivenessState = 'idle'
  /** پیشرفت چرخش، بین ۰ و ۱ — برای نوار راهنما روی صفحه */
  progress = 0

  private config: LivenessConfig
  private baseline: number | null = null
  private baselineBuffer: number[] = []
  private startedAt = 0
  private peakDeviation = 0
  private earPeak = 0
  private eyesClosed = false

  constructor(config: Partial<LivenessConfig> = {}) {
    this.config = { ...DEFAULT_LIVENESS, ...config }
  }

  /** شروع یک چالش تازه. برای هر نفر و هر تردد باید دوباره صدا زده شود. */
  start(): void {
    this.reset()
    this.state = 'centering'
    this.startedAt = Date.now()
  }

  reset(): void {
    this.state = 'idle'
    this.progress = 0
    this.baseline = null
    this.baselineBuffer = []
    this.peakDeviation = 0
    this.earPeak = 0
    this.eyesClosed = false
    this.startedAt = 0
  }

  get isActive(): boolean {
    return this.state === 'centering' || this.state === 'turn' || this.state === 'return'
  }

  get passed(): boolean {
    return this.state === 'passed'
  }

  get remainingMs(): number {
    if (!this.isActive) return 0
    return Math.max(0, this.config.timeoutMs - (Date.now() - this.startedAt))
  }

  /** پیام فارسیِ متناسب با مرحله فعلی، برای نمایش روی تبلت. */
  get prompt(): string {
    switch (this.state) {
      case 'centering':
        return 'مستقیم به دوربین نگاه کنید'
      case 'turn':
        return 'سرتان را کمی بچرخانید'
      case 'return':
        return 'حالا دوباره مستقیم نگاه کنید'
      case 'passed':
        return 'تأیید شد'
      case 'timeout':
        return 'زمان تمام شد — دوباره تلاش کنید'
      default:
        return ''
    }
  }

  /**
   * یک نمونه جدید از وضعیت چهره را وارد می‌کند و وضعیت چالش را جلو می‌برد.
   * خروجی: وضعیت جدید.
   */
  push(sample: LivenessSample): LivenessState {
    if (!this.isActive) return this.state

    if (Date.now() - this.startedAt > this.config.timeoutMs) {
      this.state = 'timeout'
      return this.state
    }

    this.trackBlink(sample.ear)

    // مرحله ۱: تعیین حالت پایه (صورت رو به دوربین)
    if (this.baseline === null) {
      this.baselineBuffer.push(sample.yaw)
      if (this.baselineBuffer.length >= this.config.baselineSamples) {
        const sorted = [...this.baselineBuffer].sort((a, b) => a - b)
        this.baseline = sorted[Math.floor(sorted.length / 2)] // میانه، مقاوم به نویز
        this.state = 'turn'
      }
      return this.state
    }

    const deviation = Math.abs(sample.yaw - this.baseline)
    this.peakDeviation = Math.max(this.peakDeviation, deviation)

    if (this.state === 'turn') {
      this.progress = Math.min(1, deviation / this.config.turnThreshold)
      if (deviation >= this.config.turnThreshold) {
        this.state = 'return'
        this.progress = 1
      }
      return this.state
    }

    if (this.state === 'return') {
      // برگشتن به مرکز، «ویدیوی از پیش ضبط‌شده تصادفی» را هم سخت‌تر می‌کند
      if (deviation <= this.config.turnThreshold * this.config.returnRatio) {
        this.state = 'passed'
      }
      return this.state
    }

    return this.state
  }

  /**
   * پلک زدن را با خط پایه تطبیقی تشخیص می‌دهد.
   *
   * مقدار مطلق EAR بین افراد (و با عینک) خیلی فرق می‌کند، پس به‌جای آستانه ثابت،
   * افت نسبی نسبت به بیشترین مقدار دیده‌شده سنجیده می‌شود.
   */
  private trackBlink(ear: number): void {
    if (!Number.isFinite(ear) || ear <= 0) return
    this.earPeak = Math.max(this.earPeak, ear)
    if (this.earPeak <= 0) return

    const ratio = ear / this.earPeak
    if (!this.eyesClosed && ratio < 0.72) {
      this.eyesClosed = true
      return
    }
    if (this.eyesClosed && ratio > 0.9) {
      // یک پلک کامل دیده شد — عکس چاپی نمی‌تواند این کار را بکند
      this.eyesClosed = false
      this.state = 'passed'
    }
  }
}

/** میانگین نسبت باز بودن دو چشم از نقاط ۶تایی هر چشم. */
export function eyeAspectRatio(eye: { x: number; y: number }[]): number {
  if (eye.length < 6) return 0
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y)
  const horizontal = d(eye[0], eye[3])
  if (horizontal < 1e-6) return 0
  return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * horizontal)
}

/**
 * معیار چرخش افقی سر.
 *
 * نسبت فاصله نوک بینی تا مرکز هر چشم را می‌سنجد. چون خارج‌قسمت است، به اندازه
 * صورت و فاصله از دوربین وابسته نیست.
 */
export function horizontalYaw(
  noseTip: { x: number; y: number },
  leftEye: { x: number; y: number }[],
  rightEye: { x: number; y: number }[],
): number {
  const centroid = (points: { x: number; y: number }[]) => ({
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  })
  const l = centroid(leftEye)
  const r = centroid(rightEye)
  const dl = Math.hypot(noseTip.x - l.x, noseTip.y - l.y)
  const dr = Math.hypot(noseTip.x - r.x, noseTip.y - r.y)
  const total = dl + dr
  if (total < 1e-6) return 0
  return (dl - dr) / total
}
