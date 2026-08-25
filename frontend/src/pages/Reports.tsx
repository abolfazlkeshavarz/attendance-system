import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarRange, Download, FileBarChart, FileSpreadsheet, Printer } from 'lucide-react'
import clsx from 'clsx'
import { api, downloadFile, errorMessage } from '../lib/api'
import type { Department, DayRow, Employee, Page, SummaryReport } from '../lib/types'
import { MONTHS_FA, toJalali, toJalaliString, toPersianDigits } from '../lib/jalali'
import {
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  LoadingBlock,
  SectionTitle,
  StatCard,
  StatusBadge,
  useToast,
} from '../components/ui'
import { JalaliDatePicker } from '../components/JalaliDatePicker'

type Period = 'daily' | 'weekly' | 'monthly' | 'custom'

const PERIODS: { key: Period; label: string; hint: string }[] = [
  { key: 'daily', label: 'روزانه', hint: 'وضعیت یک روز مشخص' },
  { key: 'weekly', label: 'هفتگی', hint: 'شنبه تا جمعه' },
  { key: 'monthly', label: 'ماهانه', hint: 'یک ماه شمسی کامل' },
  { key: 'custom', label: 'بازه دلخواه', hint: 'از تاریخ … تا تاریخ' },
]

export default function Reports() {
  const toast = useToast()
  const jToday = toJalali()

  const [period, setPeriod] = useState<Period>('monthly')
  const [jalaliDate, setJalaliDate] = useState(toJalaliString())
  const [year, setYear] = useState(jToday.year)
  const [month, setMonth] = useState(jToday.month)
  const [from, setFrom] = useState(toJalaliString())
  const [to, setTo] = useState(toJalaliString())
  const [departmentId, setDepartmentId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [downloading, setDownloading] = useState(false)

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await api.get<Department[]>('/org/departments')).data,
  })
  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: async () =>
      (await api.get<Page<Employee>>('/employees', { params: { page_size: 500 } })).data.items,
  })

  const params = {
    period,
    jalali_date: period === 'daily' || period === 'weekly' ? jalaliDate : undefined,
    jalali_year: period === 'monthly' ? year : undefined,
    jalali_month: period === 'monthly' ? month : undefined,
    from_jalali: period === 'custom' ? from : undefined,
    to_jalali: period === 'custom' ? to : undefined,
    department_id: departmentId || undefined,
    employee_id: employeeId || undefined,
  }

  const report = useQuery({
    queryKey: ['report', params],
    queryFn: async () =>
      (await api.get<SummaryReport>('/reports/summary', { params: { ...params, include_days: true } }))
        .data,
  })

  async function exportExcel(withDetails: boolean) {
    setDownloading(true)
    try {
      await downloadFile('/reports/export/summary.xlsx', {
        ...params,
        include_details: withDetails,
      })
      toast.success('فایل اکسل دانلود شد')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setDownloading(false)
    }
  }

  const totals = report.data?.totals
  const chartData = (report.data?.items ?? [])
    .slice(0, 15)
    .map((r) => ({
      name: r.full_name,
      حاضر: r.present_days,
      غایب: r.absent_days,
      مرخصی: r.leave_days,
    }))

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="گزارش‌های حضور و غیاب"
          subtitle="گزارش روزانه، هفتگی، ماهانه و بازه دلخواه با خروجی اکسل"
          action={
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => window.print()}>
                <Printer size={16} />
                چاپ
              </button>
              <button
                className="btn-ghost"
                onClick={() => void exportExcel(false)}
                disabled={downloading}
              >
                <FileSpreadsheet size={16} />
                اکسل خلاصه
              </button>
              <button
                className="btn-primary"
                onClick={() => void exportExcel(true)}
                disabled={downloading}
              >
                <Download size={16} />
                اکسل کامل
              </button>
            </div>
          }
        />

        <div className="mb-4 grid gap-2 sm:grid-cols-4">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={clsx(
                'rounded-xl border px-4 py-3 text-right transition',
                period === p.key
                  ? 'border-brand-500 bg-brand-50 text-brand-800'
                  : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50',
              )}
            >
              <p className="text-sm font-bold">{p.label}</p>
              <p className="mt-0.5 text-xs opacity-70">{p.hint}</p>
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(period === 'daily' || period === 'weekly') && (
            <Field label={period === 'daily' ? 'تاریخ گزارش' : 'یک روز از هفته موردنظر'}>
              <JalaliDatePicker value={jalaliDate} onChange={setJalaliDate} />
            </Field>
          )}

          {period === 'monthly' && (
            <>
              <Field label="سال">
                <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {Array.from({ length: 6 }, (_, i) => jToday.year - 3 + i).map((y) => (
                    <option key={y} value={y}>
                      {toPersianDigits(y)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ماه">
                <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {MONTHS_FA.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {period === 'custom' && (
            <>
              <Field label="از تاریخ">
                <JalaliDatePicker value={from} onChange={setFrom} />
              </Field>
              <Field label="تا تاریخ">
                <JalaliDatePicker value={to} onChange={setTo} />
              </Field>
            </>
          )}

          <Field label="واحد سازمانی">
            <select
              className="input"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">همه واحدها</option>
              {departments.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="پرسنل">
            <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">همه پرسنل</option>
              {employees.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      {report.isLoading ? (
        <LoadingBlock label="در حال محاسبه گزارش…" />
      ) : report.error ? (
        <ErrorBlock message={errorMessage(report.error)} />
      ) : !report.data || report.data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="داده‌ای برای این بازه نیست"
            description="بازه یا فیلترها را تغییر دهید."
            icon={<FileBarChart size={40} />}
          />
        </Card>
      ) : (
        <>
          <Card>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              <CalendarRange size={16} className="text-brand-600" />
              <b className="text-ink-900">{report.data.title}</b>
              <span className="text-ink-400">
                ({report.data.from.long} تا {report.data.to.long})
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="مجموع روزهای حضور"
                value={toPersianDigits(totals?.present_days ?? 0)}
                tone="success"
                icon={<FileBarChart size={18} />}
              />
              <StatCard
                label="مجموع روزهای غیبت"
                value={toPersianDigits(totals?.absent_days ?? 0)}
                tone="danger"
                icon={<FileBarChart size={18} />}
              />
              <StatCard
                label="روزهای مرخصی"
                value={toPersianDigits((totals?.leave_days ?? 0) + (totals?.mission_days ?? 0))}
                tone="warning"
                icon={<FileBarChart size={18} />}
              />
              <StatCard
                label="مجموع تأخیر"
                value={`${toPersianDigits(totals?.late_minutes ?? 0)} دقیقه`}
                hint={`${toPersianDigits(totals?.late_count ?? 0)} مورد`}
                tone="warning"
                icon={<FileBarChart size={18} />}
              />
              <StatCard
                label="مجموع اضافه‌کاری"
                value={`${toPersianDigits(Math.round((totals?.overtime_minutes ?? 0) / 60))} ساعت`}
                tone="info"
                icon={<FileBarChart size={18} />}
              />
            </div>
          </Card>

          {chartData.length > 1 && (
            <Card>
              <SectionTitle title="مقایسه پرسنل" subtitle="۱۵ نفر اول فهرست" />
              <div className="h-80" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fontFamily: 'Vazirmatn' }}
                      stroke="#94a3b8"
                      angle={-35}
                      textAnchor="end"
                      height={70}
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
                        direction: 'rtl',
                      }}
                      formatter={(v) => toPersianDigits(v as number)}
                    />
                    <Bar dataKey="حاضر" stackId="a" fill="#059669" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="غایب" stackId="a" fill="#e11d48" />
                    <Bar dataKey="مرخصی" stackId="a" fill="#d97706" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ردیف</th>
                  <th>پرسنل</th>
                  <th>واحد</th>
                  <th>حاضر</th>
                  <th>غایب</th>
                  <th>مرخصی</th>
                  <th>مأموریت</th>
                  <th>ناقص</th>
                  <th>کارکرد</th>
                  <th>تأخیر</th>
                  <th>اضافه‌کاری</th>
                  <th>درصد حضور</th>
                </tr>
              </thead>
              <tbody>
                {report.data.items.map((row, index) => (
                  <Fragment key={row.employee_id}>
                    <tr
                      className="cursor-pointer"
                      onClick={() =>
                        setExpanded(expanded === row.employee_id ? null : row.employee_id)
                      }
                    >
                      <td className="text-ink-400">{toPersianDigits(index + 1)}</td>
                      <td>
                        <p className="font-medium text-ink-800">{row.full_name}</p>
                        <p className="text-xs text-ink-400">
                          {toPersianDigits(row.personnel_code)}
                        </p>
                      </td>
                      <td className="text-ink-600">{row.department_name || '—'}</td>
                      <td className="font-medium text-emerald-700">
                        {toPersianDigits(row.present_days)}
                      </td>
                      <td className={row.absent_days ? 'font-medium text-rose-700' : 'text-ink-400'}>
                        {toPersianDigits(row.absent_days)}
                      </td>
                      <td className="text-ink-600">{toPersianDigits(row.leave_days)}</td>
                      <td className="text-ink-600">{toPersianDigits(row.mission_days)}</td>
                      <td className={row.incomplete_days ? 'text-orange-700' : 'text-ink-400'}>
                        {toPersianDigits(row.incomplete_days)}
                      </td>
                      <td className="text-ink-700">{toPersianDigits(row.worked_hhmm)}</td>
                      <td className={row.late_minutes ? 'text-amber-700' : 'text-ink-400'}>
                        {toPersianDigits(row.late_minutes)} د
                      </td>
                      <td className="text-ink-700">{toPersianDigits(row.overtime_hhmm)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-100">
                            <div
                              className={clsx(
                                'h-full rounded-full',
                                row.attendance_rate >= 90
                                  ? 'bg-emerald-500'
                                  : row.attendance_rate >= 70
                                    ? 'bg-amber-500'
                                    : 'bg-rose-500',
                              )}
                              style={{ width: `${row.attendance_rate}%` }}
                            />
                          </div>
                          <span className="text-xs text-ink-600">
                            {toPersianDigits(row.attendance_rate)}٪
                          </span>
                        </div>
                      </td>
                    </tr>
                    {expanded === row.employee_id && row.days && (
                      <tr>
                        <td colSpan={12} className="bg-ink-50 p-0">
                          <DayDetails days={row.days} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-1 text-xs text-ink-400">
            برای دیدن ریز روزهای هر پرسنل، روی سطر او کلیک کنید.
          </p>
        </>
      )}
    </div>
  )
}

function DayDetails({ days }: { days: DayRow[] }) {
  return (
    <div className="max-h-96 overflow-y-auto p-4">
      <table className="table bg-white">
        <thead>
          <tr>
            <th>تاریخ</th>
            <th>روز</th>
            <th>وضعیت</th>
            <th>ورود</th>
            <th>خروج</th>
            <th>کارکرد</th>
            <th>موظفی</th>
            <th>تأخیر</th>
            <th>تعجیل</th>
            <th>اضافه‌کاری</th>
            <th>توضیح</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td className="text-ink-600">{toPersianDigits(d.jalali_date)}</td>
              <td className="text-ink-500">{d.weekday}</td>
              <td>
                <StatusBadge status={d.status} label={d.status_fa} />
              </td>
              <td>{toPersianDigits(d.first_in) || '—'}</td>
              <td>{toPersianDigits(d.last_out) || '—'}</td>
              <td>{toPersianDigits(d.worked_hhmm)}</td>
              <td className="text-ink-400">{toPersianDigits(d.expected_hhmm)}</td>
              <td className={d.late_minutes ? 'text-amber-700' : 'text-ink-400'}>
                {toPersianDigits(d.late_minutes)}
              </td>
              <td className={d.early_leave_minutes ? 'text-amber-700' : 'text-ink-400'}>
                {toPersianDigits(d.early_leave_minutes)}
              </td>
              <td>{toPersianDigits(d.overtime_hhmm)}</td>
              <td className="max-w-40 truncate text-ink-500">{d.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
