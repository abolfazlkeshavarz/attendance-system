import { useQuery } from '@tanstack/react-query'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertCircle,
  CalendarClock,
  ClipboardList,
  DoorOpen,
  ScanFace,
  Timer,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, errorMessage } from '../lib/api'
import type { DashboardData, TodayStatus } from '../lib/types'
import { minutesToHhmm, toPersianDigits } from '../lib/jalali'
import {
  Avatar,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  SectionTitle,
  StatCard,
  StatusBadge,
} from '../components/ui'

const STATUS_COLORS: Record<string, string> = {
  present: '#059669',
  absent: '#e11d48',
  leave: '#d97706',
  mission: '#0284c7',
  holiday: '#94a3b8',
  weekend: '#cbd5e1',
  incomplete: '#ea580c',
}

const STATUS_LABELS: Record<string, string> = {
  present: 'حاضر',
  absent: 'غایب',
  leave: 'مرخصی',
  mission: 'مأموریت',
  holiday: 'تعطیل رسمی',
  weekend: 'تعطیل هفتگی',
  incomplete: 'ناقص',
}

export default function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<DashboardData>('/reports/dashboard')).data,
    refetchInterval: 60_000,
  })

  const { data: today } = useQuery({
    queryKey: ['today-status'],
    queryFn: async () => (await api.get<TodayStatus[]>('/attendance/status/today')).data,
    refetchInterval: 60_000,
  })

  if (isLoading) return <LoadingBlock />
  if (error) return <ErrorBlock message={errorMessage(error)} />
  if (!data) return null

  const c = data.counters
  const pieData = Object.entries(c)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: STATUS_LABELS[k] ?? k, value: v, key: k }))

  const inside = (today ?? []).filter((t) => t.is_inside)
  const lateList = (today ?? []).filter((t) => t.late_minutes > 0)

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="کل پرسنل فعال"
          value={toPersianDigits(data.total_employees)}
          icon={<Users size={20} />}
          tone="info"
        />
        <StatCard
          label="حاضران امروز"
          value={toPersianDigits((c.present ?? 0) + (c.incomplete ?? 0))}
          hint={`${toPersianDigits(data.currently_inside)} نفر هم‌اکنون داخل کارخانه`}
          icon={<UserCheck size={20} />}
          tone="success"
        />
        <StatCard
          label="غایبان امروز"
          value={toPersianDigits(c.absent ?? 0)}
          hint={`${toPersianDigits(c.leave ?? 0)} نفر در مرخصی`}
          icon={<UserX size={20} />}
          tone="danger"
        />
        <StatCard
          label="تأخیر امروز"
          value={toPersianDigits(data.late_today)}
          hint="نفر با ورود دیرتر از شیفت"
          icon={<Timer size={20} />}
          tone="warning"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle title="روند حضور و غیاب هفت روز گذشته" />
          <div className="h-72" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gPresent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gAbsent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#e11d48" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="jalali"
                  tick={{ fontSize: 11, fontFamily: 'Vazirmatn' }}
                  tickFormatter={(v: string) => toPersianDigits(v.slice(5))}
                  stroke="#94a3b8"
                />
                <YAxis
                  tick={{ fontSize: 11, fontFamily: 'Vazirmatn' }}
                  tickFormatter={(v: number) => toPersianDigits(v)}
                  stroke="#94a3b8"
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    fontFamily: 'Vazirmatn',
                    fontSize: 12,
                    borderRadius: 12,
                    border: '1px solid #e2e8f0',
                    direction: 'rtl',
                  }}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.long ?? ''}
                  formatter={(value, name) =>
                    [toPersianDigits(value as number), name === 'present' ? 'حاضر' : 'غایب'] as [
                      string,
                      string,
                    ]
                  }
                />
                <Area
                  type="monotone"
                  dataKey="present"
                  stroke="#059669"
                  strokeWidth={2}
                  fill="url(#gPresent)"
                />
                <Area
                  type="monotone"
                  dataKey="absent"
                  stroke="#e11d48"
                  strokeWidth={2}
                  fill="url(#gAbsent)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <SectionTitle title="ترکیب وضعیت امروز" subtitle={data.date.long} />
          {pieData.length === 0 ? (
            <EmptyState title="هنوز ترددی ثبت نشده" icon={<ScanFace size={36} />} />
          ) : (
            <>
              <div className="h-52" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={82}
                      paddingAngle={2}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.key} fill={STATUS_COLORS[entry.key] ?? '#94a3b8'} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        fontFamily: 'Vazirmatn',
                        fontSize: 12,
                        borderRadius: 12,
                        direction: 'rtl',
                      }}
                      formatter={(value) => toPersianDigits(value as number)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1.5">
                {pieData.map((entry) => (
                  <li key={entry.key} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-ink-600">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: STATUS_COLORS[entry.key] }}
                      />
                      {entry.name}
                    </span>
                    <b className="text-ink-800">{toPersianDigits(entry.value)}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link to="/tasks">
          <StatCard
            label="وظایف باز"
            value={toPersianDigits(data.open_tasks)}
            hint={`${toPersianDigits(data.overdue_tasks)} مورد از موعد گذشته`}
            icon={<ClipboardList size={20} />}
            tone={data.overdue_tasks > 0 ? 'warning' : 'default'}
          />
        </Link>
        <Link to="/leaves">
          <StatCard
            label="مرخصی در انتظار تأیید"
            value={toPersianDigits(data.pending_leaves)}
            icon={<CalendarClock size={20} />}
            tone={data.pending_leaves > 0 ? 'warning' : 'default'}
          />
        </Link>
        <Link to="/employees">
          <StatCard
            label="بدون ثبت چهره"
            value={toPersianDigits(data.face_not_enrolled)}
            hint="روی تبلت شناسایی نمی‌شوند"
            icon={<ScanFace size={20} />}
            tone={data.face_not_enrolled > 0 ? 'danger' : 'success'}
          />
        </Link>
        <StatCard
          label="هم‌اکنون داخل کارخانه"
          value={toPersianDigits(data.currently_inside)}
          icon={<DoorOpen size={20} />}
          tone="info"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle
            title="حاضران داخل کارخانه"
            subtitle="پرسنلی که ورود زده‌اند و هنوز خروج نزده‌اند"
          />
          {inside.length === 0 ? (
            <EmptyState title="کسی داخل کارخانه نیست" icon={<DoorOpen size={36} />} />
          ) : (
            <ul className="divide-y divide-ink-100">
              {inside.slice(0, 8).map((t) => (
                <li key={t.employee_id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={t.full_name} src={t.photo_path} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-800">{t.full_name}</p>
                    <p className="text-xs text-ink-400">{t.department_name ?? 'بدون واحد'}</p>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-emerald-700">
                      {toPersianDigits(t.first_in)}
                    </p>
                    <p className="text-xs text-ink-400">{minutesToHhmm(t.worked_minutes)} کارکرد</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle title="تأخیرهای امروز" subtitle="ورود دیرتر از ساعت شیفت" />
          {lateList.length === 0 ? (
            <EmptyState title="امروز تأخیری ثبت نشده" icon={<Timer size={36} />} />
          ) : (
            <ul className="divide-y divide-ink-100">
              {lateList.slice(0, 8).map((t) => (
                <li key={t.employee_id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={t.full_name} src={t.photo_path} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-800">{t.full_name}</p>
                    <p className="text-xs text-ink-400">
                      ورود {toPersianDigits(t.first_in)}
                    </p>
                  </div>
                  <span className="badge bg-amber-50 text-amber-700">
                    <AlertCircle size={13} />
                    {toPersianDigits(t.late_minutes)} دقیقه
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle title="وضعیت امروز به تفکیک پرسنل" subtitle={data.date.long} />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>پرسنل</th>
                <th>واحد</th>
                <th>وضعیت</th>
                <th>ورود</th>
                <th>خروج</th>
                <th>کارکرد</th>
                <th>تأخیر</th>
              </tr>
            </thead>
            <tbody>
              {(today ?? []).map((t) => (
                <tr key={t.employee_id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={t.full_name} src={t.photo_path} size={30} />
                      <div>
                        <p className="font-medium text-ink-800">{t.full_name}</p>
                        <p className="text-xs text-ink-400">{toPersianDigits(t.personnel_code)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="text-ink-600">{t.department_name ?? '—'}</td>
                  <td>
                    <StatusBadge status={t.status} label={t.status_fa} />
                  </td>
                  <td className="text-ink-700">{toPersianDigits(t.first_in) || '—'}</td>
                  <td className="text-ink-700">{toPersianDigits(t.last_out) || '—'}</td>
                  <td className="text-ink-700">{minutesToHhmm(t.worked_minutes)}</td>
                  <td className={t.late_minutes ? 'font-medium text-amber-700' : 'text-ink-400'}>
                    {t.late_minutes ? `${toPersianDigits(t.late_minutes)} دقیقه` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
