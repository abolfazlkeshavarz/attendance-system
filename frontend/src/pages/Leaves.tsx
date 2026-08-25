import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Check, Plus, Trash2, X } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
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
  const [formOpen, setFormOpen] = useState(false)
  const [deleting, setDeleting] = useState<Leave | null>(null)

  const [form, setForm] = useState({
    employee_id: '',
    leave_type: 'daily',
    start_jalali_date: toJalaliString(),
    end_jalali_date: toJalaliString(),
    start_clock: '08:00',
    end_clock: '12:00',
    reason: '',
  })

  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: async () =>
      (await api.get<Page<Employee>>('/employees', { params: { page_size: 500 } })).data.items,
  })

  const list = useQuery({
    queryKey: ['leaves', status, employeeId],
    queryFn: async () =>
      (
        await api.get<Leave[]>('/leaves', {
          params: { status: status || undefined, employee_id: employeeId || undefined },
        })
      ).data,
  })

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/leaves', {
          employee_id: Number(form.employee_id),
          leave_type: form.leave_type,
          start_jalali_date: form.start_jalali_date,
          end_jalali_date: form.end_jalali_date,
          start_clock: form.leave_type === 'hourly' ? form.start_clock : null,
          end_clock: form.leave_type === 'hourly' ? form.end_clock : null,
          reason: form.reason || null,
        })
      ).data,
    onSuccess: () => {
      toast.success('درخواست مرخصی ثبت شد')
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
          subtitle="مرخصی تأییدشده در گزارش‌ها به‌جای «غایب»، «مرخصی» ثبت می‌شود"
          action={
            editable && (
              <button className="btn-primary" onClick={() => setFormOpen(true)}>
                <Plus size={16} />
                ثبت مرخصی
              </button>
            )
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">همه پرسنل</option>
            {employees.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
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
                  <td className="text-ink-600">{toPersianDigits(leave.start_jalali)}</td>
                  <td className="text-ink-600">{toPersianDigits(leave.end_jalali)}</td>
                  <td>
                    <StatusBadge status={leave.status} label={leave.status_fa} />
                  </td>
                  <td className="max-w-48 truncate text-ink-500">{leave.reason ?? '—'}</td>
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
        title="ثبت مرخصی / مأموریت"
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
              ثبت
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
        </div>
        <p className="mt-3 rounded-xl bg-brand-50 px-3.5 py-2.5 text-xs leading-6 text-brand-800">
          پس از ثبت، درخواست در وضعیت «در انتظار تأیید» است و تا زمانی که تأیید نشود در گزارش‌ها
          به‌عنوان غیبت محاسبه می‌شود.
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
