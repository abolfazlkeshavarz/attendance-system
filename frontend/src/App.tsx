import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { LoadingBlock } from './components/ui'
import { AppLayout } from './components/AppLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import Attendance from './pages/Attendance'
import Tasks from './pages/Tasks'
import Leaves from './pages/Leaves'
import Reports from './pages/Reports'
import Settings from './pages/Settings'

const Kiosk = lazy(() => import('./kiosk/Kiosk'))

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingBlock label="در حال بررسی دسترسی…" />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const restore = useAuth((s) => s.restore)

  useEffect(() => {
    void restore()
  }, [restore])

  return (
    <Routes>
      {/* برنامه تبلت ورودی کارخانه — بدون ورود مدیر، با کلید دستگاه */}
      <Route
        path="/kiosk"
        element={
          <Suspense fallback={<LoadingBlock label="در حال آماده‌سازی تبلت…" />}>
            <Kiosk />
          </Suspense>
        }
      />

      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="employees" element={<Employees />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="leaves" element={<Leaves />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
