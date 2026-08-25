import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CloudOff,
  Download,
  Fingerprint,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import { api, downloadFile, errorMessage } from '../lib/api'
import { canEdit, useAuth } from '../lib/auth'
import type { AttendanceRecord, Department, Employee, Page } from '../lib/types'
import { toJalaliString, toPersianDigits } from '../lib/jalali'
import {
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  Field,
  LoadingBlock,
  Modal,
  Pagination,
  SectionTitle,
  Spinner,
  StatusBadge,
  useToast,
} from '../components/ui'
import { JalaliDatePicker } from '../components/JalaliDatePicker'

const PAGE_SIZE = 30

export default function Attendance() {
  const { user } = useAuth()
  const editable = canEdit(user)
  const toast = useToast()
  const qc = useQueryClient()

  const today = toJalaliString()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [employeeId, setEmployeeId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(1)

  const [manualOpen, setManualOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null)
  const [deleting, setDeleting] = useState<AttendanceRecord | null>(null)

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api.get<Department[]>('/org/departments')).data,
  })
  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: async () =>
      (await api.get<Page<Employee>>('/employees', { params: { page_size: 500 } })).data.items,
  })

  const list = useQuery({
    queryKey: ['attendance', from, to, employeeId, departmentId, kind, page],
    queryFn: async () =>
      (
        await api.get<Page<AttendanceRecord>>('/attendance', {
          params: {
            from_jalali: from || undefined,
            to_jalali: to || undefined,
            employee_id: employeeId || undefined,
            department_id: departmentId || undefined,
            kind: kind || undefined,
            page,
            page_size: PAGE_SIZE,
          },
        })
      ).data,
  })

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/attendance/${id}`)).data,
    onSuccess: () => {
      toast.success('تردد حذف شد')
      setDeleting(null)
      void qc.invalidateQueries({ queryKey: ['attendance'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  async function exportExcel() {
    try {
      await downloadFile('/reports/export/punches.xlsx', {
        from_jalali: from,
        to_jalali: to,
        employee_id: employeeId || undefined,
        department_id: departmentId || undefined,
      })
      toast.success('فایل اکسل آماده شد')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="ریز ترددها"
          subtitle={list.data ? `${toPersianDigits(list.data.total)} تردد ثبت‌شده` : undefined}
          action={
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => void exportExcel()}>
                <Download size={16} />
                خروجی اکسل
              </button>
              {editable && (
                <button className="btn-primary" onClick={() => setManualOpen(true)}>
                  <Plus size={16} />
                  ثبت دستی
                </button>
              )}
            </div>
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <JalaliDatePicker value={from} onChange={(v) => { setFrom(v); setPage(1) }} placeholder="از تاریخ" />
          <JalaliDatePicker value={to} onChange={(v) => { setTo(v); setPage(1) }} placeholder="تا تاریخ" />
          <select className="input" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setPage(1) }}>
            <option value="">همه پرسنل</option>
            {employees.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
          <select className="input" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1) }}>
            <option value="">همه واحدها</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select className="input" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1) }}>
            <option value="">ورود و خروج</option>
            <option value="in">فقط ورود</option>
            <option value="out">فقط خروج</option>
          </select>
        </div>
      </Card>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.error ? (
        <ErrorBlock message={errorMessage(list.error)} />
      ) : list.data!.items.length === 0 ? (
        <Card>
          <EmptyState
            title="ترددی در این بازه ثبت نشده"
            description="تاریخ یا فیلترها را تغییر دهید."
            icon={<Fingerprint size={40} />}
          />
        </Card>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>پرسنل</th>
                  <th>تاریخ</th>
                  <th>ساعت</th>
                  <th>نوع</th>
                  <th>روش ثبت</th>
                  <th>دستگاه</th>
                  <th>اطمینان</th>
                  <th>توضیح</th>
                  {editable && <th className="text-center">عملیات</th>}
                </tr>
              </thead>
              <tbody>
                {list.data!.items.map((rec) => (
                  <tr key={rec.id}>
                    <td>
                      <p className="font-medium text-ink-800">{rec.employee_name}</p>
                      <p className="text-xs text-ink-400">{toPersianDigits(rec.personnel_code ?? '')}</p>
                    </td>
                    <td className="text-ink-600">{toPersianDigits(rec.jalali_date)}</td>
                    <td className="font-medium text-ink-800">{toPersianDigits(rec.clock)}</td>
                    <td>
                      <span
                        className={clsx(
                          'badge',
                          rec.kind === 'in'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-brand-50 text-brand-700',
                        )}
                      >
                        {rec.kind === 'in' ? <LogIn size={13} /> : <LogOut size={13} />}
                        {rec.kind_fa}
                      </span>
                    </td>
                    <td>
                      <span className="badge bg-ink-100 text-ink-600">{rec.method_fa}</span>
                      {rec.created_offline && (
                        <span className="badge mr-1 bg-amber-50 text-amber-700">
                          <CloudOff size={12} />
                          آفلاین
                        </span>
                      )}
                    </td>
                    <td className="text-ink-600">{rec.device_name ?? '—'}</td>
                    <td className="text-ink-600">
                      {rec.confidence != null
                        ? `${toPersianDigits(Math.round(rec.confidence * 100))}٪`
                        : '—'}
                    </td>
                    <td className="max-w-40 truncate text-ink-500">{rec.note ?? '—'}</td>
                    {editable && (
                      <td>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setEditRecord(rec)}
                            className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100"
                            title="اصلاح"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => setDeleting(rec)}
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
          <Pagination page={page} pageSize={PAGE_SIZE} total={list.data!.total} onChange={setPage} />
        </>
      )}

      <ManualPunchModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        employees={employees.data ?? []}
      />

      <EditPunchModal record={editRecord} onClose={() => setEditRecord(null)} />

      <ConfirmDialog
        open={!!deleting}
        message="این تردد حذف شود؟ محاسبات گزارش این روز دوباره انجام می‌شود."
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

// ------------------------------------------------------------------ ثبت دستی

function ManualPunchModal({
  open,
  onClose,
  employees,
}: {
  open: boolean
  onClose: () => void
  employees: Employee[]
}) {
  const toast = useToast()
  const qc = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [kind, setKind] = useState<'in' | 'out'>('in')
  const [date, setDate] = useState(toJalaliString())
  const [clock, setClock] = useState('08:00')
  const [note, setNote] = useState('')

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/attendance/manual', {
          employee_id: Number(employeeId),
          kind,
          jalali_date: date,
          clock,
          note: note || null,
        })
      ).data,
    onSuccess: () => {
      toast.success('تردد ثبت شد')
      onClose()
      setNote('')
      void qc.invalidateQueries({ queryKey: ['attendance'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ثبت دستی تردد"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={!employeeId || save.isPending}
          >
            {save.isPending && <Spinner className="size-4" />}
            ثبت
          </button>
        </>
      }
    >
      <p className="mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs leading-6 text-amber-800">
        ثبت دستی برای مواردی است که پرسنل فراموش کرده یا دستگاه خاموش بوده. این ترددها در گزارش با
        برچسب «ثبت دستی» مشخص می‌شوند.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="پرسنل" required className="sm:col-span-2">
          <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">انتخاب کنید</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} — {e.personnel_code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="نوع تردد" required>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'in' | 'out')}>
            <option value="in">ورود</option>
            <option value="out">خروج</option>
          </select>
        </Field>
        <Field label="تاریخ" required>
          <JalaliDatePicker value={date} onChange={setDate} />
        </Field>
        <Field label="ساعت" required hint="قالب ۲۴ ساعته، مثلاً 08:15">
          <input className="input" value={clock} onChange={(e) => setClock(e.target.value)} dir="ltr" />
        </Field>
        <Field label="توضیح">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------- اصلاح تردد

function EditPunchModal({
  record,
  onClose,
}: {
  record: AttendanceRecord | null
  onClose: () => void
}) {
  const toast = useToast()
  const qc = useQueryClient()
  const [clock, setClock] = useState('')
  const [kind, setKind] = useState<'in' | 'out'>('in')
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState<number | null>(null)

  if (record && loaded !== record.id) {
    setLoaded(record.id)
    setClock(record.clock)
    setKind(record.kind)
    setNote(record.note ?? '')
  }

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch(`/attendance/${record!.id}`, { clock, kind, note: note || null })).data,
    onSuccess: () => {
      toast.success('تردد اصلاح شد')
      onClose()
      void qc.invalidateQueries({ queryKey: ['attendance'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Modal
      open={!!record}
      onClose={onClose}
      title={`اصلاح تردد — ${record?.employee_name ?? ''}`}
      size="sm"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Spinner className="size-4" />}
            ذخیره
          </button>
        </>
      }
    >
      <div className="mb-4 flex items-center gap-2 text-sm text-ink-500">
        <span>تاریخ: {toPersianDigits(record?.jalali_date ?? '')}</span>
        <StatusBadge status="admin_fix" label="اصلاح توسط مدیر ثبت می‌شود" />
      </div>
      <div className="grid gap-4">
        <Field label="نوع تردد">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'in' | 'out')}>
            <option value="in">ورود</option>
            <option value="out">خروج</option>
          </select>
        </Field>
        <Field label="ساعت">
          <input className="input" value={clock} onChange={(e) => setClock(e.target.value)} dir="ltr" />
        </Field>
        <Field label="توضیح">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
