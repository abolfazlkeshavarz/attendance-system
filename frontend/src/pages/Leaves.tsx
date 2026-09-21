import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Check, Download, Pencil, Plus, Trash2, X } from 'lucide-react'
import { api, downloadFile, errorMessage } from '../lib/api'
import { canEdit, useAuth } from '../lib/auth'
import type { Employee, Leave, Page } from '../lib/types'
import { toJalaliString, toPersianDigits } from '../lib/jalali'
import {
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  Field,
  LoadingBlock,
  Modal,
  SectionTitle,
  Spinner,
  StatusBadge,
  useToast,
} from '../components/ui'
import { JalaliDatePicker } from '../components/JalaliDatePicker'

const LEAVE_TYPES = [
  { value: 'daily', label: 'مرخصی روزانه' },
  { value: 'hourly', label: 'مرخصی ساعتی' },
  { value: 'sick', label: 'استعلاجی' },
  { value: 'emergency', label: 'اضطراری' },
  { value: 'mission', label: 'مأموریت' },
  { value: 'unpaid', label: 'بدون حقوق' },
]

export default function Leaves() {
  const { user } = useAuth()
  const editable = canEdit(user)
  const toast = useToast()
  const qc = useQueryClient()

  const [status, setStatus] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [leaveType, setLeaveType] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  // اگر مقدار داشته باشد، فرم در حالت «ویرایش» همین مرخصی است؛ وگرنه «ثبت جدید»
  const [editing, setEditing] = useState<Leave | null>(null)
  const [deleting, setDeleting] = useState<Leave | null>(null)
  const [downloading, setDownloading] = useState(false)

  const emptyForm = () => ({
    employee_id: '',
    leave_type: 'daily',
    start_jalali_date: toJalaliString(),
    end_jalali_date: toJalaliString(),
    start_clock: '08:00',
    end_clock: '12:00',
    reason: '',
    status: 'pending',
    review_note: '',
  })
  const [form, setForm] = useState(emptyForm)

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setFormOpen(true)
  }

  function openEdit(leave: Leave) {
    setEditing(leave)
    setForm({
      employee_id: String(leave.employee_id),
      leave_type: leave.leave_type,
      start_jalali_date: leave.start_jalali,
      end_jalali_date: leave.end_jalali,
      start_clock: leave.leave_type === 'hourly' ? leave.start_clock : '08:00',
      end_clock: leave.leave_type === 'hourly' ? leave.end_clock : '12:00',
      reason: leave.reason ?? '',
      status: leave.status,
      review_note: leave.review_note ?? '',
    })
    setFormOpen(true)
  }

  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: async () =>
      (await api.get<Page<Employee>>('/employees', { params: { page_size: 500 } })).data.items,
  })

  const list = useQuery({
    queryKey: ['leaves', status, employeeId, leaveType],
    queryFn: async () =>
      (
        await api.get<Leave[]>('/leaves', {
          params: {
            status: status || undefined,
            employee_id: employeeId || undefined,
            leave_type: leaveType || undefined,
          },
        })
      ).data,
  })

  async function exportExcel() {
    setDownloading(true)
    try {
      await downloadFile('/reports/export/leaves.xlsx', {
        status: status || undefined,
        employee_id: employeeId || undefined,
        leave_type: leaveType || undefined,
      })
      toast.success('فایل اکسل دانلود شد')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setDownloading(false)
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        employee_id: Number(form.employee_id),
        leave_type: form.leave_type,
        start_jalali_date: form.start_jalali_date,
        end_jalali_date: form.end_jalali_date,
        start_clock: form.leave_type === 'hourly' ? form.start_clock : null,
        end_clock: form.leave_type === 'hourly' ? form.end_clock : null,
        reason: form.reason || null,
      }
      if (!editing) return (await api.post('/leaves', body)).data
      return (
        await api.patch(`/leaves/${editing.id}`, {
          ...body,
          review_note: form.review_note || null,
          // وضعیت فقط وقتی فرستاده شود که عوض شده؛ ارسالش «بررسی‌کننده» را هم عوض می‌کند
          ...(form.status !== editing.status ? { status: form.status } : {}),
        })
      ).data
    },
    onSuccess: () => {
      toast.success(editing ? 'مرخصی ویرایش شد' : 'درخواست مرخصی ثبت شد')
      setFormOpen(false)
      void qc.invalidateQueries({ queryKey: ['leaves'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const review = useMutation({
    mutationFn: async ({ id, next }: { id: number; next: 'approved' | 'rejected' }) =>
      (await api.patch(`/leaves/${id}`, { status: next })).data,
    onSuccess: (_, variables) => {
      toast.success(variables.next === 'approved' ? 'مرخصی تأیید شد' : 'مرخصی رد شد')
      void qc.invalidateQueries({ queryKey: ['leaves'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/leaves/${id}`)).data,
    onSuccess: () => {
      toast.success('درخواست حذف شد')
      setDeleting(null)
      void qc.invalidateQueries({ queryKey: ['leaves'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="مرخصی‌ها و مأموریت‌ها"
          subtitle="مرخصی تأییدشده در گزارش‌ها به‌جای «غایب»، «مرخصی» ثبت می‌شود · پرسنل می‌توانند از صفحهٔ عمومی /leave-request (با QR) خودشان درخواست بدهند"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-ghost" onClick={() => void exportExcel()} disabled={downloading}>
                {downloading ? <Spinner className="size-4" /> : <Download size={16} />}
                خروجی اکسل
              </button>
              {editable && (
                <button className="btn-primary" onClick={openCreate}>
                  <Plus size={16} />
                  ثبت مرخصی
                </button>
              )}
            </div>
          }
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">همه پرسنل</option>
            {employees.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
          <select className="input" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
            <option value="">همه انواع مرخصی</option>
            {LEAVE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">همه وضعیت‌ها</option>
            <option value="pending">در انتظار تأیید</option>
            <option value="approved">تأیید شده</option>
            <option value="rejected">رد شده</option>
          </select>
        </div>
      </Card>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.error ? (
        <ErrorBlock message={errorMessage(list.error)} />
      ) : list.data!.length === 0 ? (
        <Card>
          <EmptyState
            title="درخواستی ثبت نشده"
            description="مرخصی‌های ثبت‌شده اینجا نمایش داده می‌شوند."
            icon={<CalendarDays size={40} />}
          />
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>پرسنل</th>
                <th>نوع</th>
                <th>از تاریخ</th>
                <th>تا تاریخ</th>
                <th>وضعیت</th>
                <th>دلیل</th>
                {editable && <th className="text-center">عملیات</th>}
              </tr>
            </thead>
            <tbody>
              {list.data!.map((leave) => (
                <tr key={leave.id}>
                  <td>
                    <p className="font-medium text-ink-800">{leave.employee_name}</p>
                    <p className="text-xs text-ink-400">
                      {toPersianDigits(leave.personnel_code ?? '')}
                    </p>
                  </td>
                  <td>
                    <span className="badge bg-ink-100 text-ink-600">{leave.leave_type_fa}</span>
                  </td>
                  <td className="text-ink-600">
                    {toPersianDigits(leave.start_jalali)}
                    {leave.leave_type === 'hourly' && (
                      <span className="mr-1.5 text-xs text-ink-400" dir="ltr">
                        {toPersianDigits(leave.start_clock)}
                      </span>
                    )}
                  </td>
                  <td className="text-ink-600">
                    {toPersianDigits(leave.end_jalali)}
                    {leave.leave_type === 'hourly' && (
                      <span className="mr-1.5 text-xs text-ink-400" dir="ltr">
                        {toPersianDigits(leave.end_clock)}
                      </span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={leave.status} label={leave.status_fa} />
                  </td>
                  <td
                    className="max-w-48 truncate text-ink-500"
                    title={leave.reason ?? undefined}
                  >
                    {leave.reason ?? '—'}
                  </td>
                  {editable && (
                    <td>
                      <div className="flex items-center justify-center gap-1">
                        {leave.status === 'pending' && (
                          <>
                            <button
                              onClick={() => review.mutate({ id: leave.id, next: 'approved' })}
                              className="rounded-lg p-2 text-emerald-600 transition hover:bg-emerald-50"
                              title="تأیید"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              onClick={() => review.mutate({ id: leave.id, next: 'rejected' })}
                              className="rounded-lg p-2 text-amber-600 transition hover:bg-amber-50"
                              title="رد"
                            >
                              <X size={16} />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => openEdit(leave)}
                          className="rounded-lg p-2 text-brand-600 transition hover:bg-brand-50"
                          title="ویرایش"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => setDeleting(leave)}
                          className="rounded-lg p-2 text-rose-500 transition hover:bg-rose-50"
                          title="حذف"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'ویرایش مرخصی / مأموریت' : 'ثبت مرخصی / مأموریت'}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setFormOpen(false)}>
              انصراف
            </button>
            <button
              className="btn-primary"
              onClick={() => save.mutate()}
              disabled={!form.employee_id || save.isPending}
            >
              {save.isPending && <Spinner className="size-4" />}
              {editing ? 'ذخیرهٔ تغییرات' : 'ثبت'}
            </button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="پرسنل" required className="sm:col-span-2">
            <select
              className="input"
              value={form.employee_id}
              onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
            >
              <option value="">انتخاب کنید</option>
              {employees.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name} — {e.personnel_code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="نوع" required className="sm:col-span-2">
            <select
              className="input"
              value={form.leave_type}
              onChange={(e) => setForm({ ...form, leave_type: e.target.value })}
            >
              {LEAVE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="از تاریخ" required>
            <JalaliDatePicker
              value={form.start_jalali_date}
              onChange={(v) => setForm({ ...form, start_jalali_date: v })}
            />
          </Field>
          <Field label="تا تاریخ" required>
            <JalaliDatePicker
              value={form.end_jalali_date}
              onChange={(v) => setForm({ ...form, end_jalali_date: v })}
            />
          </Field>
          {form.leave_type === 'hourly' && (
            <>
              <Field label="از ساعت" required>
                <input
                  className="input"
                  dir="ltr"
                  value={form.start_clock}
                  onChange={(e) => setForm({ ...form, start_clock: e.target.value })}
                />
              </Field>
              <Field label="تا ساعت" required>
                <input
                  className="input"
                  dir="ltr"
                  value={form.end_clock}
                  onChange={(e) => setForm({ ...form, end_clock: e.target.value })}
                />
              </Field>
            </>
          )}
          <Field label="دلیل" className="sm:col-span-2">
            <textarea
              className="input min-h-20"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </Field>
          {editing && (
            <>
              <Field label="وضعیت">
                <select
                  className="input"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="pending">در انتظار تأیید</option>
                  <option value="approved">تأیید شده</option>
                  <option value="rejected">رد شده</option>
                </select>
              </Field>
              <Field label="یادداشت بررسی">
                <input
                  className="input"
                  value={form.review_note}
                  onChange={(e) => setForm({ ...form, review_note: e.target.value })}
                />
              </Field>
            </>
          )}
        </div>
        <p className="mt-3 rounded-xl bg-brand-50 px-3.5 py-2.5 text-xs leading-6 text-brand-800">
          {editing
            ? 'تغییر بازه یا نوع روی گزارش‌ها هم اثر می‌گذارد (اگر مرخصی «تأیید شده» باشد، بلافاصله).'
            : 'پس از ثبت، درخواست در وضعیت «در انتظار تأیید» است و تا زمانی که تأیید نشود در گزارش‌ها به‌عنوان غیبت محاسبه می‌شود.'}
        </p>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        message="این درخواست مرخصی حذف شود؟"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
