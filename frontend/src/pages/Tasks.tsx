import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Download,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import clsx from 'clsx'
import { api, downloadFile, errorMessage } from '../lib/api'
import { canEdit, useAuth } from '../lib/auth'
import type { Department, Employee, Page, Task } from '../lib/types'
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

const PAGE_SIZE = 20

const STATUSES = [
  { value: 'todo', label: 'انجام نشده' },
  { value: 'in_progress', label: 'در حال انجام' },
  { value: 'done', label: 'انجام شد' },
  { value: 'cancelled', label: 'لغو شده' },
]
const PRIORITIES = [
  { value: 'low', label: 'کم' },
  { value: 'normal', label: 'عادی' },
  { value: 'high', label: 'زیاد' },
  { value: 'urgent', label: 'فوری' },
]
const RECURRENCES = [
  { value: 'none', label: 'بدون تکرار (وظیفه یک‌باره)' },
  { value: 'daily', label: 'روزانه' },
  { value: 'weekly', label: 'هفتگی' },
  { value: 'monthly', label: 'ماهانه' },
]

interface TaskForm {
  title: string
  description: string
  employee_id: string
  priority: string
  recurrence: string
  due_jalali_date: string
  start_jalali_date: string
  end_jalali_date: string
  estimated_minutes: string
  status: string
  progress: number
}

const EMPTY: TaskForm = {
  title: '',
  description: '',
  employee_id: '',
  priority: 'normal',
  recurrence: 'none',
  due_jalali_date: '',
  start_jalali_date: '',
  end_jalali_date: '',
  estimated_minutes: '',
  status: 'todo',
  progress: 0,
}

export default function Tasks() {
  const { user } = useAuth()
  const editable = canEdit(user)
  const toast = useToast()
  const qc = useQueryClient()

  const [tab, setTab] = useState<'all' | 'today'>('all')
  const [status, setStatus] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [page, setPage] = useState(1)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [form, setForm] = useState<TaskForm>(EMPTY)
  const [deleting, setDeleting] = useState<Task | null>(null)

  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: async () =>
      (await api.get<Page<Employee>>('/employees', { params: { page_size: 500 } })).data.items,
  })
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api.get<Department[]>('/org/departments')).data,
  })

  const list = useQuery({
    queryKey: ['tasks', status, employeeId, departmentId, page],
    queryFn: async () =>
      (
        await api.get<Page<Task>>('/tasks', {
          params: {
            status: status || undefined,
            employee_id: employeeId || undefined,
            department_id: departmentId || undefined,
            page,
            page_size: PAGE_SIZE,
          },
        })
      ).data,
    enabled: tab === 'all',
  })

  const todayList = useQuery({
    queryKey: ['tasks-today', employeeId],
    queryFn: async () =>
      (await api.get<Task[]>('/tasks/today', { params: { employee_id: employeeId || undefined } }))
        .data,
    enabled: tab === 'today',
  })

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editing) return (await api.patch(`/tasks/${editing.id}`, payload)).data
      return (await api.post('/tasks', payload)).data
    },
    onSuccess: () => {
      toast.success(editing ? 'وظیفه به‌روزرسانی شد' : 'وظیفه ثبت شد')
      setFormOpen(false)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['tasks-today'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/tasks/${id}`)).data,
    onSuccess: () => {
      toast.success('وظیفه حذف شد')
      setDeleting(null)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['tasks-today'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const logDone = useMutation({
    mutationFn: async (taskId: number) =>
      (await api.post('/tasks/logs', { task_id: taskId, status: 'done' })).data,
    onSuccess: () => {
      toast.success('انجام وظیفه ثبت شد')
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['tasks-today'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY, start_jalali_date: toJalaliString() })
    setFormOpen(true)
  }

  function openEdit(task: Task) {
    setEditing(task)
    setForm({
      title: task.title,
      description: task.description ?? '',
      employee_id: task.employee_id ? String(task.employee_id) : '',
      priority: task.priority,
      recurrence: task.recurrence,
      due_jalali_date: task.due_jalali_date ?? '',
      start_jalali_date: '',
      end_jalali_date: '',
      estimated_minutes: task.estimated_minutes ? String(task.estimated_minutes) : '',
      status: task.status,
      progress: task.progress,
    })
    setFormOpen(true)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      employee_id: form.employee_id ? Number(form.employee_id) : null,
      priority: form.priority,
      recurrence: form.recurrence,
      due_jalali_date: form.due_jalali_date || null,
      start_jalali_date: form.start_jalali_date || null,
      end_jalali_date: form.end_jalali_date || null,
      estimated_minutes: form.estimated_minutes ? Number(form.estimated_minutes) : null,
    }
    if (editing) {
      payload.status = form.status
      payload.progress = form.progress
    }
    save.mutate(payload)
  }

  const rows = tab === 'today' ? (todayList.data ?? []) : (list.data?.items ?? [])
  const loading = tab === 'today' ? todayList.isLoading : list.isLoading
  const error = tab === 'today' ? todayList.error : list.error

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="شرح وظایف و تکالیف پرسنل"
          subtitle="وظایف یک‌باره و وظایف تکرارشونده روزانه/هفتگی/ماهانه"
          action={
            <div className="flex gap-2">
              <button
                className="btn-ghost"
                onClick={async () => {
                  try {
                    await downloadFile('/reports/export/tasks.xlsx', {
                      employee_id: employeeId || undefined,
                      department_id: departmentId || undefined,
                      status: status || undefined,
                    })
                    toast.success('فایل اکسل آماده شد')
                  } catch (err) {
                    toast.error(errorMessage(err))
                  }
                }}
              >
                <Download size={16} />
                خروجی اکسل
              </button>
              {editable && (
                <button className="btn-primary" onClick={openCreate}>
                  <Plus size={16} />
                  تعریف وظیفه
                </button>
              )}
            </div>
          }
        />

        <div className="mb-3 flex gap-1 rounded-xl bg-ink-100 p-1">
          {[
            { key: 'all' as const, label: 'همه وظایف' },
            { key: 'today' as const, label: 'وظایف امروز' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'flex-1 rounded-lg py-2 text-sm font-medium transition',
                tab === t.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <select className="input" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setPage(1) }}>
            <option value="">همه پرسنل</option>
            {employees.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
          {tab === 'all' && (
            <>
              <select className="input" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1) }}>
                <option value="">همه واحدها</option>
                {departments.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
                <option value="">همه وضعیت‌ها</option>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </Card>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={errorMessage(error)} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title={tab === 'today' ? 'برای امروز وظیفه‌ای تعریف نشده' : 'وظیفه‌ای یافت نشد'}
            description="می‌توانید شرح وظایف روزانه پرسنل را به‌صورت تکرارشونده تعریف کنید."
            icon={<ClipboardList size={40} />}
            action={
              editable && (
                <button className="btn-primary" onClick={openCreate}>
                  <Plus size={16} />
                  تعریف وظیفه
                </button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((task) => (
              <div
                key={task.id}
                className={clsx(
                  'card flex flex-col gap-3 p-4',
                  task.is_overdue && 'border-rose-200 bg-rose-50/40',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold leading-6 text-ink-900">{task.title}</h3>
                  <div className="flex shrink-0 gap-1">
                    <StatusBadge status={task.priority} label={task.priority_fa} />
                  </div>
                </div>

                {task.description && (
                  <p className="line-clamp-2 text-sm leading-6 text-ink-500">{task.description}</p>
                )}

                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge status={task.status} label={task.status_fa} />
                  {task.recurrence !== 'none' && (
                    <span className="badge bg-sky-50 text-sky-700">
                      <Repeat size={12} />
                      {task.recurrence_fa}
                    </span>
                  )}
                  {task.is_overdue && (
                    <span className="badge bg-rose-100 text-rose-700">
                      <TriangleAlert size={12} />
                      از موعد گذشته
                    </span>
                  )}
                  {task.done_today && (
                    <span className="badge bg-emerald-50 text-emerald-700">
                      <CheckCircle2 size={12} />
                      امروز انجام شد
                    </span>
                  )}
                </div>

                <div className="space-y-1 text-xs text-ink-500">
                  <p>مسئول: {task.employee_name ?? 'تعیین نشده'}</p>
                  {task.due_jalali_date && <p>سررسید: {toPersianDigits(task.due_jalali_date)}</p>}
                  {task.estimated_minutes != null && (
                    <p>زمان برآوردی: {toPersianDigits(task.estimated_minutes)} دقیقه</p>
                  )}
                </div>

                {task.progress > 0 && task.status !== 'done' && (
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-ink-500">
                      <span>پیشرفت</span>
                      <span>{toPersianDigits(task.progress)}٪</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {editable && (
                  <div className="mt-auto flex gap-1.5 border-t border-ink-100 pt-3">
                    <button
                      className="btn-subtle flex-1 py-2 text-xs"
                      onClick={() => logDone.mutate(task.id)}
                      disabled={task.done_today || logDone.isPending}
                    >
                      <CalendarCheck size={14} />
                      {task.done_today ? 'ثبت شده' : 'ثبت انجام امروز'}
                    </button>
                    <button
                      onClick={() => openEdit(task)}
                      className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100"
                      title="ویرایش"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => setDeleting(task)}
                      className="rounded-lg p-2 text-rose-500 transition hover:bg-rose-50"
                      title="حذف"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {tab === 'all' && list.data && (
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onChange={setPage} />
          )}
        </>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'ویرایش وظیفه' : 'تعریف وظیفه جدید'}
        size="lg"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setFormOpen(false)}>
              انصراف
            </button>
            <button className="btn-primary" form="task-form" type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner className="size-4" />}
              ذخیره
            </button>
          </>
        }
      >
        <form id="task-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="عنوان وظیفه" required className="sm:col-span-2">
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="بازرسی روزانه خط بسته‌بندی"
              required
            />
          </Field>
          <Field label="شرح وظیفه" className="sm:col-span-2">
            <textarea
              className="input min-h-24"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="جزئیات کاری که باید انجام شود…"
            />
          </Field>
          <Field label="مسئول انجام">
            <select
              className="input"
              value={form.employee_id}
              onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
            >
              <option value="">انتخاب کنید</option>
              {employees.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="اولویت">
            <select
              className="input"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="نوع تکرار" className="sm:col-span-2">
            <select
              className="input"
              value={form.recurrence}
              onChange={(e) => setForm({ ...form, recurrence: e.target.value })}
            >
              {RECURRENCES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>

          {form.recurrence === 'none' ? (
            <Field label="تاریخ سررسید">
              <JalaliDatePicker
                value={form.due_jalali_date}
                onChange={(v) => setForm({ ...form, due_jalali_date: v })}
              />
            </Field>
          ) : (
            <>
              <Field label="از تاریخ">
                <JalaliDatePicker
                  value={form.start_jalali_date}
                  onChange={(v) => setForm({ ...form, start_jalali_date: v })}
                />
              </Field>
              <Field label="تا تاریخ" hint="خالی = بدون پایان">
                <JalaliDatePicker
                  value={form.end_jalali_date}
                  onChange={(v) => setForm({ ...form, end_jalali_date: v })}
                />
              </Field>
            </>
          )}

          <Field label="زمان برآوردی (دقیقه)">
            <input
              className="input"
              type="number"
              min={0}
              value={form.estimated_minutes}
              onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value })}
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
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`پیشرفت: ${toPersianDigits(form.progress)}٪`} className="sm:col-span-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  className="w-full accent-brand-600"
                  value={form.progress}
                  onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })}
                />
              </Field>
            </>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        message={`وظیفه «${deleting?.title}» و همه سوابق انجام آن حذف شود؟`}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
