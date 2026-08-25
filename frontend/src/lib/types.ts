export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface User {
  id: number
  username: string
  full_name: string
  role: 'admin' | 'manager' | 'viewer'
  is_active: boolean
}

export interface Department {
  id: number
  name: string
  description?: string | null
  is_active: boolean
  employee_count: number
}

export interface Shift {
  id: number
  name: string
  start_time: string
  end_time: string
  crosses_midnight: boolean
  grace_in_minutes: number
  grace_out_minutes: number
  work_days: string
  break_minutes: number
  is_active: boolean
  expected_minutes: number
}

export interface Holiday {
  id: number
  day: string
  title: string
  is_official: boolean
  jalali_date: string
  jalali_long: string
}

export interface Employee {
  id: number
  personnel_code: string
  first_name: string
  last_name: string
  full_name: string
  national_code?: string | null
  mobile?: string | null
  position?: string | null
  department_id?: number | null
  shift_id?: number | null
  hire_date?: string | null
  hire_jalali_date: string
  photo_path?: string | null
  notes?: string | null
  is_active: boolean
  department_name?: string | null
  shift_name?: string | null
  face_count: number
  face_enrolled: boolean
  has_pin: boolean
}

export interface FaceSample {
  id: number
  employee_id: number
  dim: number
  model_name: string
  quality?: number | null
  image_path?: string | null
  is_active: boolean
}

export interface AttendanceRecord {
  id: number
  employee_id: number
  device_id?: number | null
  kind: 'in' | 'out'
  kind_fa: string
  method: string
  method_fa: string
  happened_at: string
  work_date: string
  jalali_date: string
  clock: string
  confidence?: number | null
  snapshot_path?: string | null
  created_offline: boolean
  note?: string | null
  employee_name?: string | null
  personnel_code?: string | null
  device_name?: string | null
}

export type DayStatus =
  | 'present' | 'absent' | 'leave' | 'mission' | 'holiday' | 'weekend' | 'incomplete'

export interface DayRow {
  employee_id: number
  date: string
  jalali_date: string
  jalali_long: string
  weekday: string
  status: DayStatus
  status_fa: string
  first_in: string
  last_out: string
  worked_minutes: number
  worked_hhmm: string
  expected_minutes: number
  expected_hhmm: string
  late_minutes: number
  early_leave_minutes: number
  overtime_minutes: number
  overtime_hhmm: string
  punch_count: number
  open_session: boolean
  leave_minutes: number
  note: string
  full_name?: string
  personnel_code?: string
  department_name?: string | null
  position?: string | null
  shift_name?: string | null
  photo_path?: string | null
}

export interface SummaryRow {
  employee_id: number
  full_name: string
  personnel_code: string
  department_name: string
  position: string
  present_days: number
  absent_days: number
  leave_days: number
  mission_days: number
  holiday_days: number
  weekend_days: number
  incomplete_days: number
  worked_minutes: number
  worked_hhmm: string
  expected_minutes: number
  expected_hhmm: string
  late_minutes: number
  late_count: number
  early_leave_minutes: number
  overtime_minutes: number
  overtime_hhmm: string
  attendance_rate: number
  days?: DayRow[]
}

export interface SummaryReport {
  title: string
  period: string
  from: { gregorian: string; jalali: string; long: string }
  to: { gregorian: string; jalali: string; long: string }
  totals: Record<string, number>
  items: SummaryRow[]
}

export interface DashboardData {
  date: { gregorian: string; jalali: string; long: string }
  total_employees: number
  counters: Record<string, number>
  currently_inside: number
  late_today: number
  trend: { date: string; jalali: string; long: string; present: number; absent: number }[]
  departments: { name: string; count: number }[]
  open_tasks: number
  overdue_tasks: number
  pending_leaves: number
  face_not_enrolled: number
}

export interface Task {
  id: number
  title: string
  description?: string | null
  employee_id?: number | null
  department_id?: number | null
  status: 'todo' | 'in_progress' | 'done' | 'cancelled'
  status_fa: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  priority_fa: string
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly'
  recurrence_fa: string
  due_date?: string | null
  due_jalali_date: string
  start_date?: string | null
  end_date?: string | null
  estimated_minutes?: number | null
  progress: number
  completed_at?: string | null
  is_active: boolean
  employee_name?: string | null
  department_name?: string | null
  done_today: boolean
  is_overdue: boolean
}

export interface TaskLog {
  id: number
  task_id: number
  log_date: string
  jalali_date: string
  status: string
  status_fa: string
  spent_minutes?: number | null
  note?: string | null
  task_title?: string | null
}

export interface Leave {
  id: number
  employee_id: number
  leave_type: string
  leave_type_fa: string
  start_at: string
  end_at: string
  start_jalali: string
  end_jalali: string
  status: 'pending' | 'approved' | 'rejected'
  status_fa: string
  reason?: string | null
  review_note?: string | null
  reviewed_at?: string | null
  employee_name?: string | null
  personnel_code?: string | null
}

export interface Device {
  id: number
  name: string
  device_uid: string
  location?: string | null
  last_seen_at?: string | null
  last_sync_at?: string | null
  app_version?: string | null
  pending_count: number
  is_active: boolean
  api_key?: string
}

export interface GalleryItem {
  employee_id: number
  personnel_code: string
  full_name: string
  department_name?: string | null
  photo_path?: string | null
  vectors: number[][]
}

export interface FaceGallery {
  model_name: string
  dim: number
  threshold: number
  version: string
  generated_at: string
  items: GalleryItem[]
}

export interface TodayStatus {
  employee_id: number
  full_name: string
  personnel_code: string
  photo_path?: string | null
  department_name?: string | null
  first_in: string
  last_out: string
  is_inside: boolean
  worked_minutes: number
  late_minutes: number
  status: DayStatus
  status_fa: string
}
