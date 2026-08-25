from fastapi import APIRouter

from app.api.v1.endpoints import (
    attendance,
    auth,
    devices,
    employees,
    kiosk,
    leaves,
    organization,
    reports,
    tasks,
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["احراز هویت"])
api_router.include_router(employees.router, prefix="/employees", tags=["پرسنل"])
api_router.include_router(organization.router, prefix="/org", tags=["سازمان"])
api_router.include_router(attendance.router, prefix="/attendance", tags=["تردد"])
api_router.include_router(devices.router, prefix="/devices", tags=["دستگاه‌ها"])
api_router.include_router(kiosk.router, prefix="/kiosk", tags=["تبلت ورودی"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["وظایف"])
api_router.include_router(leaves.router, prefix="/leaves", tags=["مرخصی"])
api_router.include_router(reports.router, prefix="/reports", tags=["گزارش‌ها"])
