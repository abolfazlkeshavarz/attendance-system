import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Fingerprint, RefreshCw, TriangleAlert, Trash2, XCircle } from 'lucide-react'
import clsx from 'clsx'
import { api, errorMessage } from '../lib/api'
import type { Device, Employee, FingerprintEnrollJob } from '../lib/types'
import { Modal, Spinner, useToast } from '../components/ui'

/**
 * ثبت اثر انگشت پرسنل — برخلاف چهره، این کار روی خودِ تبلت انجام نمی‌شود:
 * یک دستگاه ESP32 کنار درب باید انتخاب شود؛ درخواست به آن دستگاه فرستاده
 * می‌شود و تا وقتی پرسنل انگشتش را دو بار روی سنسور بگذارد (یا کار لغو/رد
 * شود) این پنجره وضعیت را هر ۱٫۵ ثانیه از سرور می‌پرسد.
 */
export function FingerprintEnrollModal({
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
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [jobId, setJobId] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      setJobId(null)
      setDeviceId(null)
    }
  }, [open])

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await api.get<Device[]>('/devices')).data,
    enabled: open,
  })
  const fpDevices = (devices.data ?? []).filter((d) => d.kind === 'fingerprint' && d.is_active)

  const job = useQuery({
    queryKey: ['fingerprint-enroll-job', jobId],
    queryFn: async () => (await api.get<FingerprintEnrollJob>(`/fingerprint/enroll/${jobId}`)).data,
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 1500 : false),
  })

  useEffect(() => {
    if (job.data?.status === 'done') {
      toast.success('اثر انگشت با موفقیت ثبت شد')
      void qc.invalidateQueries({ queryKey: ['employees'] })
    }
  }, [job.data?.status, qc, toast])

  const start = useMutation({
    mutationFn: async () =>
      (
        await api.post<FingerprintEnrollJob>('/fingerprint/enroll', {
          employee_id: employee!.id,
          device_id: deviceId,
        })
      ).data,
    onSuccess: (data) => setJobId(data.id),
    onError: (err) => toast.error(errorMessage(err)),
  })

  const cancel = useMutation({
    mutationFn: async () => (await api.delete(`/fingerprint/enroll/${jobId}`)).data,
    onSuccess: () => {
      toast.info('ثبت‌نام لغو شد')
      setJobId(null)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: async () => (await api.delete(`/employees/${employee!.id}/fingerprint`)).data,
    onSuccess: () => {
      toast.success('ثبت‌نام اثر انگشت حذف شد')
      void qc.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (!employee) return null

  const status = job.data?.status

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`ثبت اثر انگشت — ${employee.full_name}`}
      size="sm"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            بستن
          </button>
          {status === 'pending' ? (
            <button className="btn bg-rose-50 text-rose-700 hover:bg-rose-100" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              {cancel.isPending && <Spinner className="size-4" />}
              لغو ثبت‌نام
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={() => start.mutate()}
              disabled={!deviceId || start.isPending}
            >
              {start.isPending && <Spinner className="size-4" />}
              <Fingerprint size={16} />
              شروع ثبت‌نام
            </button>
          )}
        </>
      }
    >
      <div className="grid gap-4">
        <div className="flex items-center justify-between rounded-xl border border-ink-200 p-3.5">
          <span className="text-sm text-ink-700">وضعیت فعلی</span>
          <span
            className={clsx(
              'badge',
              employee.has_fingerprint ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
            )}
          >
            {employee.has_fingerprint ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />}
            {employee.has_fingerprint ? 'ثبت شده' : 'ثبت نشده'}
          </span>
        </div>

        {employee.has_fingerprint && (
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="btn bg-rose-50 text-rose-700 hover:bg-rose-100"
          >
            {remove.isPending ? <Spinner className="size-4" /> : <Trash2 size={16} />}
            حذف ثبت‌نام فعلی (از همه دستگاه‌ها)
          </button>
        )}

        {!jobId && (
          <>
            {fpDevices.length === 0 ? (
              <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs leading-6 text-amber-800">
                هیچ دستگاه اثر انگشتی ثبت نشده است. از «تنظیمات ← دستگاه‌ها» یک دستگاه از نوع «اثر
                انگشت» بسازید.
              </p>
            ) : (
              <label className="grid gap-1.5 text-sm text-ink-700">
                دستگاه (کدام درب)
                <select
                  className="input"
                  value={deviceId ?? ''}
                  onChange={(e) => setDeviceId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">انتخاب کنید…</option>
                  {fpDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.location ? ` — ${d.location}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-xs leading-6 text-brand-800">
              بعد از شروع، پرسنل باید انگشت خود را دو بار روی سنسور دستگاه انتخاب‌شده قرار دهد.
            </p>
          </>
        )}

        {jobId && status === 'pending' && (
          <div className="flex items-center gap-3 rounded-xl bg-brand-50 px-3.5 py-3 text-sm text-brand-800">
            <RefreshCw size={18} className="animate-spin shrink-0" />
            در انتظار اسکن روی دستگاه — پرسنل باید انگشت خود را دو بار روی سنسور بگذارد…
          </div>
        )}
        {jobId && status === 'done' && (
          <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
            <CheckCircle2 size={18} className="shrink-0" />
            ثبت با موفقیت انجام شد
          </div>
        )}
        {jobId && (status === 'failed' || status === 'cancelled') && (
          <div className="flex items-center gap-3 rounded-xl bg-rose-50 px-3.5 py-3 text-sm text-rose-800">
            <XCircle size={18} className="shrink-0" />
            {status === 'cancelled' ? 'ثبت‌نام لغو شد' : job.data?.error_message || 'ثبت‌نام ناموفق بود'}
          </div>
        )}
      </div>
    </Modal>
  )
}
