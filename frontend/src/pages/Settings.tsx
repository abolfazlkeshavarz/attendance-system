import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  CalendarOff,
  Clock,
  CloudOff,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Tablet,
  Trash2,
  UserCog,
} from 'lucide-react'
import clsx from 'clsx'
import { api, errorMessage } from '../lib/api'
import { isAdmin, ROLE_LABELS, useAuth } from '../lib/auth'
import type { Department, Device, Holiday, Shift, User } from '../lib/types'
import { toJalaliString, toPersianDigits, WEEKDAYS_FA } from '../lib/jalali'
import {
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  LoadingBlock,
  Modal,
  SectionTitle,
  Spinner,
  useToast,
} from '../components/ui'
import { JalaliDatePicker } from '../components/JalaliDatePicker'

type Tab = 'departments' | 'shifts' | 'holidays' | 'devices' | 'users' | 'account'

const TABS: { key: Tab; label: string; icon: typeof Building2; adminOnly?: boolean }[] = [
  { key: 'departments', label: 'واحدها', icon: Building2 },
  { key: 'shifts', label: 'شیفت‌ها', icon: Clock },
  { key: 'holidays', label: 'تعطیلات رسمی', icon: CalendarOff },
  { key: 'devices', label: 'دستگاه‌ها', icon: Tablet, adminOnly: true },
  { key: 'users', label: 'کاربران پنل', icon: UserCog, adminOnly: true },
  { key: 'account', label: 'حساب من', icon: KeyRound },
]

export default function Settings() {
  const { user } = useAuth()
  const admin = isAdmin(user)
  const [tab, setTab] = useState<Tab>('departments')
  const visible = TABS.filter((t) => !t.adminOnly || admin)

  return (
    <div className="space-y-4">
      <Card className="p-2">
        <div className="flex flex-wrap gap-1">
          {visible.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={clsx(
                'flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition',
                tab === key ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100',
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </Card>

      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'shifts' && <ShiftsTab />}
      {tab === 'holidays' && <HolidaysTab />}
      {tab === 'devices' && admin && <DevicesTab />}
      {tab === 'users' && admin && <UsersTab />}
      {tab === 'account' && <AccountTab />}
    </div>
  )
}

// ------------------------------------------------------------------- واحدها

function DepartmentsTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [deleting, setDeleting] = useState<Department | null>(null)

  const list = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api.get<Department[]>('/org/departments')).data,
  })

  const save = useMutation({
    mutationFn: async () => (await api.post('/org/departments', { name, description })).data,
    onSuccess: () => {
      toast.success('واحد ثبت شد')
      setOpen(false)
      setName('')
      setDescription('')
      void qc.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/org/departments/${id}`)).data,
    onSuccess: () => {
      toast.success('واحد حذف شد')
      setDeleting(null)
      void qc.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (list.isLoading) return <LoadingBlock />

  return (
    <Card>
      <SectionTitle
        title="واحدهای سازمانی"
        subtitle="برای گروه‌بندی پرسنل و فیلتر گزارش‌ها"
        action={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} />
            افزودن واحد
          </button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.data!.map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-xl border border-ink-200 p-4">
            <div className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
              <Building2 size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink-800">{d.name}</p>
              <p className="truncate text-xs text-ink-400">
                {toPersianDigits(d.employee_count)} پرسنل
                {d.description ? ` — ${d.description}` : ''}
              </p>
            </div>
            <button
              onClick={() => setDeleting(d)}
              className="rounded-lg p-2 text-rose-500 transition hover:bg-rose-50"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="افزودن واحد سازمانی"
        size="sm"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              انصراف
            </button>
            <button className="btn-primary" onClick={() => save.mutate()} disabled={!name || save.isPending}>
              {save.isPending && <Spinner className="size-4" />}
              ذخیره
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="نام واحد" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="توضیح">
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        message={`واحد «${deleting?.name}» حذف شود؟ پرسنل آن حذف نمی‌شوند ولی بدون واحد می‌مانند.`}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  )
}

// -------------------------------------------------------------------- شیفت‌ها

function ShiftsTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState<Shift | null>(null)
  const [form, setForm] = useState({
    name: '',
    start_time: '08:00',
    end_time: '16:00',
    crosses_midnight: false,
    grace_in_minutes: 10,
    grace_out_minutes: 10,
    break_minutes: 30,
    work_days: [0, 1, 2, 3, 4] as number[],
  })

  const list = useQuery({
    queryKey: ['shifts'],
    queryFn: async () => (await api.get<Shift[]>('/org/shifts')).data,
  })

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/org/shifts', {
          ...form,
          start_time: `${form.start_time}:00`,
          end_time: `${form.end_time}:00`,
          work_days: form.work_days.sort((a, b) => a - b).join(','),
        })
      ).data,
    onSuccess: () => {
      toast.success('شیفت ثبت شد')
      setOpen(false)
      void qc.invalidateQueries({ queryKey: ['shifts'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/org/shifts/${id}`)).data,
    onSuccess: () => {
      toast.success('شیفت حذف شد')
      setDeleting(null)
      void qc.invalidateQueries({ queryKey: ['shifts'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      work_days: f.work_days.includes(day)
        ? f.work_days.filter((d) => d !== day)
        : [...f.work_days, day],
    }))
  }

  if (list.isLoading) return <LoadingBlock />

  return (
    <Card>
      <SectionTitle
        title="شیفت‌های کاری"
        subtitle="مبنای محاسبه تأخیر، تعجیل و اضافه‌کاری در گزارش‌ها"
        action={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} />
            افزودن شیفت
          </button>
        }
      />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>نام شیفت</th>
              <th>ساعت شروع</th>
              <th>ساعت پایان</th>
              <th>روزهای کاری</th>
              <th>تأخیر مجاز</th>
              <th>استراحت</th>
              <th>موظفی روزانه</th>
              <th className="text-center">حذف</th>
            </tr>
          </thead>
          <tbody>
            {list.data!.map((s) => (
              <tr key={s.id}>
                <td className="font-medium text-ink-800">
                  {s.name}
                  {s.crosses_midnight && (
                    <span className="badge mr-2 bg-indigo-50 text-indigo-700">شیفت شب</span>
                  )}
                </td>
                <td>{toPersianDigits(s.start_time.slice(0, 5))}</td>
                <td>{toPersianDigits(s.end_time.slice(0, 5))}</td>
                <td className="text-ink-600">
                  {s.work_days
                    .split(',')
                    .map((d) => WEEKDAYS_FA[Number(d)])
                    .join('، ')}
                </td>
                <td>{toPersianDigits(s.grace_in_minutes)} دقیقه</td>
                <td>{toPersianDigits(s.break_minutes)} دقیقه</td>
                <td className="font-medium">
                  {toPersianDigits(Math.floor(s.expected_minutes / 60))}:
                  {toPersianDigits(String(s.expected_minutes % 60).padStart(2, '0'))}
                </td>
                <td className="text-center">
                  <button
                    onClick={() => setDeleting(s)}
                    className="rounded-lg p-2 text-rose-500 transition hover:bg-rose-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="افزودن شیفت کاری"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              انصراف
            </button>
            <button
              className="btn-primary"
              onClick={() => save.mutate()}
              disabled={!form.name || form.work_days.length === 0 || save.isPending}
            >
              {save.isPending && <Spinner className="size-4" />}
              ذخیره
            </button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام شیفت" required className="sm:col-span-2">
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="شیفت تولید — صبح"
            />
          </Field>
          <Field label="ساعت شروع" required>
            <input
              type="time"
              className="input"
              dir="ltr"
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            />
          </Field>
          <Field label="ساعت پایان" required>
            <input
              type="time"
              className="input"
              dir="ltr"
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            />
          </Field>
          <Field label="روزهای کاری" required className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS_FA.map((day, index) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(index)}
                  className={clsx(
                    'rounded-xl border px-3.5 py-2 text-sm transition',
                    form.work_days.includes(index)
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-ink-200 text-ink-500 hover:bg-ink-50',
                  )}
                >
                  {day}
                </button>
              ))}
            </div>
          </Field>
          <Field label="تأخیر مجاز (دقیقه)">
            <input
              type="number"
              className="input"
              min={0}
              value={form.grace_in_minutes}
              onChange={(e) => setForm({ ...form, grace_in_minutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="تعجیل مجاز (دقیقه)">
            <input
              type="number"
              className="input"
              min={0}
              value={form.grace_out_minutes}
              onChange={(e) => setForm({ ...form, grace_out_minutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="استراحت بدون احتساب (دقیقه)">
            <input
              type="number"
              className="input"
              min={0}
              value={form.break_minutes}
              onChange={(e) => setForm({ ...form, break_minutes: Number(e.target.value) })}
            />
          </Field>
          <label className="flex items-center gap-2.5 self-end pb-2.5 text-sm text-ink-700">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              checked={form.crosses_midnight}
              onChange={(e) => setForm({ ...form, crosses_midnight: e.target.checked })}
            />
            شیفت از نیمه‌شب عبور می‌کند (شیفت شب)
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        message={`شیفت «${deleting?.name}» حذف شود؟ پرسنل این شیفت بدون شیفت می‌مانند و محاسبه تأخیر برایشان انجام نمی‌شود.`}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  )
}

// -------------------------------------------------------------- تعطیلات رسمی

function HolidaysTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(toJalaliString())
  const [title, setTitle] = useState('')
  const [deleting, setDeleting] = useState<Holiday | null>(null)

  const list = useQuery({
    queryKey: ['holidays'],
    queryFn: async () => (await api.get<Holiday[]>('/org/holidays')).data,
  })

  const save = useMutation({
    mutationFn: async () =>
      (await api.post('/org/holidays', { jalali_date: date, title, is_official: true })).data,
    onSuccess: () => {
      toast.success('تعطیلی ثبت شد')
      setOpen(false)
      setTitle('')
      void qc.invalidateQueries({ queryKey: ['holidays'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/org/holidays/${id}`)).data,
    onSuccess: () => {
      toast.success('تعطیلی حذف شد')
      setDeleting(null)
      void qc.invalidateQueries({ queryKey: ['holidays'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (list.isLoading) return <LoadingBlock />

  return (
    <Card>
      <SectionTitle
        title="تعطیلات رسمی"
        subtitle="در این روزها غیبت محاسبه نمی‌شود و کارکرد، اضافه‌کاری به حساب می‌آید"
        action={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} />
            افزودن تعطیلی
          </button>
        }
      />

      <p className="mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs leading-6 text-amber-800">
        تعطیلات ثابت شمسی (نوروز، ۱۳ فروردین، ۲۲ بهمن و…) به‌صورت خودکار ثبت شده‌اند. تعطیلات مذهبی
        قمری هر سال جابه‌جا می‌شوند و باید دستی اضافه شوند.
      </p>

      {list.data!.length === 0 ? (
        <EmptyState title="تعطیلی ثبت نشده" icon={<CalendarOff size={36} />} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.data!.map((h) => (
            <div key={h.id} className="flex items-center gap-3 rounded-xl border border-ink-200 p-3.5">
              <div className="grid size-10 place-items-center rounded-xl bg-rose-50 text-rose-600">
                <CalendarOff size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-800">{h.title}</p>
                <p className="text-xs text-ink-400">{toPersianDigits(h.jalali_date)}</p>
              </div>
              <button
                onClick={() => setDeleting(h)}
                className="rounded-lg p-2 text-rose-500 transition hover:bg-rose-50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="افزودن روز تعطیل"
        size="sm"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              انصراف
            </button>
            <button className="btn-primary" onClick={() => save.mutate()} disabled={!title || save.isPending}>
              {save.isPending && <Spinner className="size-4" />}
              ذخیره
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="تاریخ" required>
            <JalaliDatePicker value={date} onChange={setDate} />
          </Field>
          <Field label="مناسبت" required>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="عید سعید فطر"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        message={`تعطیلی «${deleting?.title}» حذف شود؟`}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  )
}

// ------------------------------------------------------------------ دستگاه‌ها

function DevicesTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null)
  const [deleting, setDeleting] = useState<Device | null>(null)

  const list = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await api.get<Device[]>('/devices')).data,
  })

  const save = useMutation({
    mutationFn: async () => (await api.post<Device>('/devices', { name, location })).data,
    onSuccess: (data) => {
      setOpen(false)
      setName('')
      setLocation('')
      setNewKey({ name: data.name, key: data.api_key! })
      void qc.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const rotate = useMutation({
    mutationFn: async (id: number) => (await api.post<Device>(`/devices/${id}/rotate-key`)).data,
    onSuccess: (data) => {
      setNewKey({ name: data.name, key: data.api_key! })
      void qc.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/devices/${id}`)).data,
    onSuccess: () => {
      toast.success('دستگاه حذف شد')
      setDeleting(null)
      void qc.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (list.isLoading) return <LoadingBlock />

  return (
    <Card>
      <SectionTitle
        title="تبلت‌های ورودی"
        subtitle="هر تبلت با یک کلید اختصاصی به سرور وصل می‌شود"
        action={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} />
            ثبت دستگاه
          </button>
        }
      />

      {list.data!.length === 0 ? (
        <EmptyState
          title="دستگاهی ثبت نشده"
          description="برای راه‌اندازی تبلت ورودی، ابتدا یک دستگاه بسازید و کلید آن را در تبلت وارد کنید."
          icon={<Tablet size={40} />}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data!.map((d) => (
            <div key={d.id} className="rounded-xl border border-ink-200 p-4">
              <div className="flex items-start gap-3">
                <div
                  className={clsx(
                    'grid size-10 place-items-center rounded-xl',
                    d.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-ink-100 text-ink-400',
                  )}
                >
                  <Tablet size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-800">{d.name}</p>
                  <p className="text-xs text-ink-400">{d.location ?? 'بدون محل'}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => rotate.mutate(d.id)}
                    className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100"
                    title="تولید کلید جدید"
                  >
                    <RefreshCw size={16} />
                  </button>
                  <button
                    onClick={() => setDeleting(d)}
                    className="rounded-lg p-2 text-rose-500 transition hover:bg-rose-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-ink-100 pt-3 text-xs">
                <div>
                  <dt className="text-ink-400">آخرین اتصال</dt>
                  <dd className="text-ink-700">
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString('fa-IR') : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-400">آخرین همگام‌سازی</dt>
                  <dd className="text-ink-700">
                    {d.last_sync_at ? new Date(d.last_sync_at).toLocaleString('fa-IR') : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-400">تردد ارسال‌نشده</dt>
                  <dd>
                    {d.pending_count > 0 ? (
                      <span className="badge bg-amber-50 text-amber-700">
                        <CloudOff size={12} />
                        {toPersianDigits(d.pending_count)} مورد در صف
                      </span>
                    ) : (
                      <span className="text-emerald-700">همه ارسال شده</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-400">نسخه برنامه</dt>
                  <dd className="text-ink-700">{toPersianDigits(d.app_version ?? '—')}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="ثبت دستگاه جدید"
        size="sm"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              انصراف
            </button>
            <button className="btn-primary" onClick={() => save.mutate()} disabled={!name || save.isPending}>
              {save.isPending && <Spinner className="size-4" />}
              ساخت دستگاه
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="نام دستگاه" required>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="درب اصلی"
            />
          </Field>
          <Field label="محل نصب">
            <input
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="ورودی شمالی — کنار نگهبانی"
            />
          </Field>
        </div>
      </Modal>

      {/* نمایش یک‌باره کلید */}
      <Modal
        open={!!newKey}
        onClose={() => setNewKey(null)}
        title={`کلید دستگاه «${newKey?.name ?? ''}»`}
        size="sm"
        footer={
          <button className="btn-primary" onClick={() => setNewKey(null)}>
            کلید را ذخیره کردم
          </button>
        }
      >
        <p className="mb-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs leading-6 text-amber-800">
          این کلید فقط همین یک‌بار نمایش داده می‌شود. آن را در صفحه راه‌اندازی تبلت
          (<span dir="ltr">/kiosk</span>) وارد کنید.
        </p>
        <div className="flex items-center gap-2 rounded-xl bg-ink-900 p-3">
          <code dir="ltr" className="flex-1 break-all font-mono text-xs text-emerald-300">
            {newKey?.key}
          </code>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(newKey?.key ?? '')
              toast.success('کلید کپی شد')
            }}
            className="rounded-lg bg-white/10 p-2 text-white transition hover:bg-white/20"
          >
            <Copy size={16} />
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        message={`دستگاه «${deleting?.name}» حذف شود؟ تبلت دیگر نمی‌تواند تردد ثبت کند.`}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  )
}

// ------------------------------------------------------------------- کاربران

function UsersTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ username: '', full_name: '', password: '', role: 'viewer' })
  const [deleting, setDeleting] = useState<User | null>(null)

  const list = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<User[]>('/auth/users')).data,
  })

  const save = useMutation({
    mutationFn: async () => (await api.post('/auth/users', form)).data,
    onSuccess: () => {
      toast.success('کاربر ساخته شد')
      setOpen(false)
      setForm({ username: '', full_name: '', password: '', role: 'viewer' })
      void qc.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/auth/users/${id}`)).data,
    onSuccess: () => {
      toast.success('کاربر حذف شد')
      setDeleting(null)
      void qc.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (list.isLoading) return <LoadingBlock />

  return (
    <Card>
      <SectionTitle
        title="کاربران پنل مدیریت"
        subtitle="مدیر ارشد: دسترسی کامل • سرپرست: مدیریت پرسنل و وظایف • ناظر: فقط مشاهده"
        action={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} />
            افزودن کاربر
          </button>
        }
      />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>نام</th>
              <th>نام کاربری</th>
              <th>نقش</th>
              <th>وضعیت</th>
              <th className="text-center">حذف</th>
            </tr>
          </thead>
          <tbody>
            {list.data!.map((u) => (
              <tr key={u.id}>
                <td className="font-medium text-ink-800">
                  {u.full_name}
                  {u.id === me?.id && (
                    <span className="badge mr-2 bg-brand-50 text-brand-700">شما</span>
                  )}
                </td>
                <td dir="ltr" className="text-right text-ink-600">
                  {u.username}
                </td>
                <td>
                  <span className="badge bg-ink-100 text-ink-600">{ROLE_LABELS[u.role]}</span>
                </td>
                <td>
                  <span
                    className={clsx(
                      'badge',
                      u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500',
                    )}
                  >
                    {u.is_active ? 'فعال' : 'غیرفعال'}
                  </span>
                </td>
                <td className="text-center">
                  {u.id !== me?.id && (
                    <button
                      onClick={() => setDeleting(u)}
                      className="rounded-lg p-2 text-rose-500 transition hover:bg-rose-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="افزودن کاربر پنل"
        size="sm"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOpen(false)}>
              انصراف
            </button>
            <button
              className="btn-primary"
              onClick={() => save.mutate()}
              disabled={!form.username || !form.password || save.isPending}
            >
              {save.isPending && <Spinner className="size-4" />}
              ذخیره
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="نام و نام خانوادگی" required>
            <input
              className="input"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </Field>
          <Field label="نام کاربری" required>
            <input
              className="input"
              dir="ltr"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>
          <Field label="رمز عبور" required hint="حداقل ۶ کاراکتر">
            <input
              className="input"
              type="password"
              dir="ltr"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="نقش" required>
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="viewer">ناظر — فقط مشاهده گزارش‌ها</option>
              <option value="manager">سرپرست — مدیریت پرسنل و وظایف</option>
              <option value="admin">مدیر ارشد — دسترسی کامل</option>
            </select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        message={`کاربر «${deleting?.full_name}» حذف شود؟`}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  )
}

// ------------------------------------------------------------------- حساب من

function AccountTab() {
  const toast = useToast()
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const change = useMutation({
    mutationFn: async () =>
      (await api.post('/auth/change-password', { current_password: current, new_password: next }))
        .data,
    onSuccess: () => {
      toast.success('رمز عبور تغییر کرد')
      setCurrent('')
      setNext('')
      setConfirm('')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm

  return (
    <Card className="max-w-lg">
      <SectionTitle title="حساب کاربری من" subtitle={`${user?.full_name} — ${ROLE_LABELS[user?.role ?? '']}`} />
      <div className="grid gap-4">
        <Field label="رمز عبور فعلی" required>
          <input
            className="input"
            type="password"
            dir="ltr"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="رمز عبور جدید" required hint="حداقل ۶ کاراکتر">
          <input
            className="input"
            type="password"
            dir="ltr"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="تکرار رمز جدید" required error={mismatch ? 'رمزها یکسان نیستند' : undefined}>
          <input
            className="input"
            type="password"
            dir="ltr"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <button
          className="btn-primary"
          onClick={() => change.mutate()}
          disabled={!current || next.length < 6 || mismatch || change.isPending}
        >
          {change.isPending && <Spinner className="size-4" />}
          تغییر رمز عبور
        </button>
      </div>
    </Card>
  )
}
