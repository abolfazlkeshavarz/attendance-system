import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, ScanFace, Search, Trash2, Users } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { canEdit, useAuth } from '../lib/auth'
import type { Department, Employee, Page, Shift } from '../lib/types'
import { toPersianDigits } from '../lib/jalali'
import {
  Avatar,
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
  useToast,
} from '../components/ui'
import { JalaliDatePicker } from '../components/JalaliDatePicker'
const FaceEnrollModal = lazy(() =>
  import('./FaceEnrollModal').then((m) => ({ default: m.FaceEnrollModal })),
)

const PAGE_SIZE = 20

interface FormState {
  personnel_code: string
  first_name: string
  last_name: string
  national_code: string
  mobile: string
  position: string
  department_id: string
  shift_id: string
  hire_jalali_date: string
  pin: string
  notes: string
  is_active: boolean
}

const EMPTY_FORM: FormState = {
  personnel_code: '',
  first_name: '',
  last_name: '',
  national_code: '',
  mobile: '',
  position: '',
  department_id: '',
  shift_id: '',
  hire_jalali_date: '',
  pin: '',
  notes: '',
  is_active: true,
}

export default function Employees() {
  const { user } = useAuth()
  const editable = canEdit(user)
  const toast = useToast()
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [faceFilter, setFaceFilter] = useState('')
  const [page, setPage] = useState(1)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [faceTarget, setFaceTarget] = useState<Employee | null>(null)
  const [deleting, setDeleting] = useState<Employee | null>(null)

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api.get<Department[]>('/org/departments')).data,
  })
  const shifts = useQuery({
    queryKey: ['shifts'],
    queryFn: async () => (await api.get<Shift[]>('/org/shifts')).data,
  })

  const list = useQuery({
    queryKey: ['employees', search, departmentId, faceFilter, page],
    queryFn: async () =>
      (
        await api.get<Page<Employee>>('/employees', {
          params: {
            search: search || undefined,
            department_id: departmentId || undefined,
            face_enrolled: faceFilter === '' ? undefined : faceFilter === 'yes',
            page,
            page_size: PAGE_SIZE,
          },
        })
      ).data,
  })

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editing) return (await api.patch(`/employees/${editing.id}`, payload)).data
      return (await api.post('/employees', payload)).data
    },
    onSuccess: () => {
      toast.success(editing ? 'اطلاعات پرسنل به‌روزرسانی شد' : 'پرسنل جدید ثبت شد')
      setFormOpen(false)
      void qc.invalidateQueries({ queryKey: ['employees'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/employees/${id}`)).data,
    onSuccess: () => {
      toast.success('پرسنل حذف شد')
      setDeleting(null)
      void qc.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEdit(emp: Employee) {
    setEditing(emp)
    setForm({
      personnel_code: emp.personnel_code,
      first_name: emp.first_name,
      last_name: emp.last_name,
      national_code: emp.national_code ?? '',
      mobile: emp.mobile ?? '',
      position: emp.position ?? '',
      department_id: emp.department_id ? String(emp.department_id) : '',
      shift_id: emp.shift_id ? String(emp.shift_id) : '',
      hire_jalali_date: emp.hire_jalali_date ?? '',
      pin: '',
      notes: emp.notes ?? '',
      is_active: emp.is_active,
    })
    setFormOpen(true)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const payload: Record<string, unknown> = {
      personnel_code: form.personnel_code.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      national_code: form.national_code.trim() || null,
      mobile: form.mobile.trim() || null,
      position: form.position.trim() || null,
      department_id: form.department_id ? Number(form.department_id) : null,
      shift_id: form.shift_id ? Number(form.shift_id) : null,
      hire_jalali_date: form.hire_jalali_date || null,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    }
    if (form.pin.trim()) payload.pin = form.pin.trim()
    save.mutate(payload)
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="پرسنل کارخانه"
          subtitle={
            list.data ? `${toPersianDigits(list.data.total)} نفر مطابق فیلترهای انتخابی` : undefined
          }
          action={
            editable && (
              <button className="btn-primary" onClick={openCreate}>
                <Plus size={16} />
                افزودن پرسنل
              </button>
            )
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              className="input ps-10"
              placeholder="جست‌وجوی نام یا کد پرسنلی…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <select
            className="input"
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value)
              setPage(1)
            }}
          >
            <option value="">همه واحدها</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={faceFilter}
            onChange={(e) => {
              setFaceFilter(e.target.value)
              setPage(1)
            }}
          >
            <option value="">وضعیت ثبت چهره: همه</option>
            <option value="yes">چهره ثبت شده</option>
            <option value="no">بدون ثبت چهره</option>
          </select>
        </div>
      </Card>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.error ? (
        <ErrorBlock message={errorMessage(list.error)} />
      ) : list.data && list.data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="پرسنلی یافت نشد"
            description="فیلترها را تغییر دهید یا اولین پرسنل را اضافه کنید."
            icon={<Users size={40} />}
            action={
              editable && (
                <button className="btn-primary" onClick={openCreate}>
                  <Plus size={16} />
                  افزودن پرسنل
                </button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>پرسنل</th>
                  <th>کد پرسنلی</th>
                  <th>واحد</th>
                  <th>سمت</th>
                  <th>شیفت</th>
                  <th>چهره</th>
                  <th>وضعیت</th>
                  <th className="text-center">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {list.data!.items.map((emp) => (
                  <tr key={emp.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={emp.full_name} src={emp.photo_path} size={36} />
                        <div>
                          <p className="font-medium text-ink-800">{emp.full_name}</p>
                          {emp.mobile && (
                            <p className="text-xs text-ink-400">{toPersianDigits(emp.mobile)}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="text-ink-600">{toPersianDigits(emp.personnel_code)}</td>
                    <td className="text-ink-600">{emp.department_name ?? '—'}</td>
                    <td className="text-ink-600">{emp.position ?? '—'}</td>
                    <td className="text-ink-600">{emp.shift_name ?? '—'}</td>
                    <td>
                      {emp.face_enrolled ? (
                        <span className="badge bg-emerald-50 text-emerald-700">
                          <ScanFace size={13} />
                          {toPersianDigits(emp.face_count)} نمونه
                        </span>
                      ) : (
                        <span className="badge bg-rose-50 text-rose-700">ثبت نشده</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${emp.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'}`}
                      >
                        {emp.is_active ? 'فعال' : 'غیرفعال'}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center justify-center gap-1">
                        {editable && (
                          <>
                            <button
                              onClick={() => setFaceTarget(emp)}
                              className="rounded-lg p-2 text-brand-600 transition hover:bg-brand-50"
                              title="ثبت چهره"
                            >
                              <ScanFace size={16} />
                            </button>
                            <button
                              onClick={() => openEdit(emp)}
                              className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100"
                              title="ویرایش"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              onClick={() => setDeleting(emp)}
                              className="rounded-lg p-2 text-rose-500 transition hover:bg-rose-50"
                              title="حذف"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                        {!editable && <span className="text-xs text-ink-400">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={list.data!.total}
            onChange={setPage}
          />
        </>
      )}

      {/* فرم افزودن / ویرایش */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `ویرایش ${editing.full_name}` : 'افزودن پرسنل جدید'}
        size="lg"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setFormOpen(false)}>
              انصراف
            </button>
            <button className="btn-primary" form="employee-form" type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner className="size-4" />}
              ذخیره
            </button>
          </>
        }
      >
        <form id="employee-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="نام" required>
            <input
              className="input"
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              required
            />
          </Field>
          <Field label="نام خانوادگی" required>
            <input
              className="input"
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              required
            />
          </Field>
          <Field label="کد پرسنلی" required hint="در تبلت برای ثبت با کد استفاده می‌شود">
            <input
              className="input"
              value={form.personnel_code}
              onChange={(e) => setForm({ ...form, personnel_code: e.target.value })}
              required
            />
          </Field>
          <Field label="کد ملی" hint="۱۰ رقم — اعتبارسنجی می‌شود">
            <input
              className="input"
              value={form.national_code}
              onChange={(e) => setForm({ ...form, national_code: e.target.value })}
              inputMode="numeric"
            />
          </Field>
          <Field label="شماره موبایل">
            <input
              className="input"
              value={form.mobile}
              onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              placeholder="09121234567"
              inputMode="numeric"
            />
          </Field>
          <Field label="سمت">
            <input
              className="input"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
              placeholder="اپراتور خط تولید"
            />
          </Field>
          <Field label="واحد سازمانی">
            <select
              className="input"
              value={form.department_id}
              onChange={(e) => setForm({ ...form, department_id: e.target.value })}
            >
              <option value="">انتخاب کنید</option>
              {departments.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="شیفت کاری" hint="مبنای محاسبه تأخیر و اضافه‌کاری">
            <select
              className="input"
              value={form.shift_id}
              onChange={(e) => setForm({ ...form, shift_id: e.target.value })}
            >
              <option value="">انتخاب کنید</option>
              {shifts.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="تاریخ استخدام">
            <JalaliDatePicker
              value={form.hire_jalali_date}
              onChange={(v) => setForm({ ...form, hire_jalali_date: v })}
            />
          </Field>
          <Field
            label="رمز پشتیبان"
            hint={editing ? 'خالی بگذارید تا تغییر نکند' : '۴ تا ۸ رقم — وقتی دوربین کار نکند'}
          >
            <input
              className="input"
              value={form.pin}
              onChange={(e) => setForm({ ...form, pin: e.target.value })}
              inputMode="numeric"
              placeholder="••••"
            />
          </Field>
          <Field label="یادداشت" className="sm:col-span-2">
            <textarea
              className="input min-h-20"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2.5 text-sm text-ink-700 sm:col-span-2">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            پرسنل فعال است (غیرفعال‌ها روی تبلت شناسایی نمی‌شوند)
          </label>
        </form>
      </Modal>

      {faceTarget && (
        <Suspense fallback={null}>
          <FaceEnrollModal
            employee={faceTarget}
            open={!!faceTarget}
            onClose={() => setFaceTarget(null)}
          />
        </Suspense>
      )}

      <ConfirmDialog
        open={!!deleting}
        message={`آیا از حذف «${deleting?.full_name}» مطمئن هستید؟ همه ترددها، وظایف و نمونه‌های چهره او نیز حذف می‌شوند. برای نگه‌داشتن سوابق، به‌جای حذف او را غیرفعال کنید.`}
        confirmLabel="بله، حذف کن"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
