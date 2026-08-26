"""آزمون سرتاسری: از ورود مدیر تا ثبت تردد آفلاین و خروجی اکسل."""
from __future__ import annotations

import os
import tempfile
import uuid
from datetime import datetime, timedelta

import pytest

DB_FILE = os.path.join(tempfile.gettempdir(), f"att_test_{uuid.uuid4().hex}.db")
os.environ["DATABASE_URL"] = f"sqlite:///{DB_FILE.replace(os.sep, '/')}"
os.environ["SECRET_KEY"] = "test-secret-key-for-attendance-system"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.jalali import (  # noqa: E402
    TEHRAN,
    iran_weekday,
    jalali_str,
    to_utc,
    today_tehran,
)
from app.main import app  # noqa: E402

API = "/api/v1"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c
    try:
        os.remove(DB_FILE)
    except OSError:
        pass


@pytest.fixture(scope="module")
def admin_headers(client):
    res = client.post(f"{API}/auth/login", json={"username": "admin", "password": "admin1234"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_login_rejects_bad_password(client):
    res = client.post(f"{API}/auth/login", json={"username": "admin", "password": "wrong-pass"})
    assert res.status_code == 401
    assert "اشتباه" in res.json()["detail"]


def test_seed_created_departments_and_shifts(client, admin_headers):
    depts = client.get(f"{API}/org/departments", headers=admin_headers).json()
    shifts = client.get(f"{API}/org/shifts", headers=admin_headers).json()
    assert len(depts) >= 6
    assert any(s["name"] == "شیفت اداری" for s in shifts)
    office = next(s for s in shifts if s["name"] == "شیفت اداری")
    # ۸ ساعت منهای ۳۰ دقیقه استراحت
    assert office["expected_minutes"] == 8 * 60 - 30


def test_national_code_validation(client, admin_headers):
    res = client.post(
        f"{API}/employees",
        headers=admin_headers,
        json={
            "personnel_code": "9001",
            "first_name": "تست",
            "last_name": "نامعتبر",
            "national_code": "1234567890",
        },
    )
    assert res.status_code == 422
    assert "کد ملی" in res.json()["detail"]


@pytest.fixture(scope="module")
def employee(client, admin_headers):
    shifts = client.get(f"{API}/org/shifts", headers=admin_headers).json()
    depts = client.get(f"{API}/org/departments", headers=admin_headers).json()
    office = next(s for s in shifts if s["name"] == "شیفت اداری")
    res = client.post(
        f"{API}/employees",
        headers=admin_headers,
        json={
            "personnel_code": "1001",
            "first_name": "رضا",
            "last_name": "محمدی",
            "national_code": "0079119212",
            "mobile": "09121234567",
            "position": "اپراتور خط",
            "department_id": depts[0]["id"],
            "shift_id": office["id"],
            "pin": "1234",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["full_name"] == "رضا محمدی"
    assert body["has_pin"] is True
    return body


def test_duplicate_personnel_code_rejected(client, admin_headers, employee):
    res = client.post(
        f"{API}/employees",
        headers=admin_headers,
        json={"personnel_code": "1001", "first_name": "علی", "last_name": "احمدی"},
    )
    assert res.status_code == 409


def test_face_enrollment_and_gallery(client, admin_headers, employee):
    vector = [0.10 + i * 0.001 for i in range(512)]
    res = client.post(
        f"{API}/employees/{employee['id']}/faces",
        headers=admin_headers,
        json={"vector": vector, "quality": 0.93},
    )
    assert res.status_code == 201, res.text
    assert res.json()["dim"] == 512

    gallery = client.get(f"{API}/employees/faces/gallery", headers=admin_headers).json()
    assert gallery["threshold"] > 0
    assert any(item["employee_id"] == employee["id"] for item in gallery["items"])
    item = next(i for i in gallery["items"] if i["employee_id"] == employee["id"])
    # بردار باید دست‌نخورده (خام) ذخیره شود — نه نرمال‌شده.
    # مرورگر هم بردار خام تولید می‌کند؛ اگر سرور مقیاس را عوض کند، فاصله‌ها
    # بی‌معنا می‌شوند و تشخیص چهره روی تبلت خراب می‌شود.
    stored = item["vectors"][0]
    assert len(stored) == 512
    for original, roundtripped in zip(vector, stored):
        assert abs(original - roundtripped) < 1e-5


@pytest.fixture(scope="module")
def device(client, admin_headers):
    res = client.post(
        f"{API}/devices", headers=admin_headers, json={"name": "درب اصلی", "location": "ورودی شمالی"}
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_device_key_required(client, device):
    assert client.get(f"{API}/kiosk/handshake").status_code == 401
    assert client.get(f"{API}/kiosk/handshake", headers={"X-Device-Key": "bogus"}).status_code == 401
    res = client.get(f"{API}/kiosk/handshake", headers={"X-Device-Key": device["api_key"]})
    assert res.status_code == 200
    assert res.json()["device"]["name"] == "درب اصلی"


def test_server_side_face_identify(client, device, employee):
    headers = {"X-Device-Key": device["api_key"]}
    # همان بردار با کمی نویز — باید همچنان تطبیق داده شود
    probe = [0.10 + i * 0.001 + 0.0005 for i in range(512)]
    res = client.post(f"{API}/kiosk/identify", headers=headers, json={"vector": probe})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["matched"] is True
    assert body["employee_id"] == employee["id"]
    assert body["suggested_kind"] == "in"

    # بردار کاملاً متفاوت — نباید تطبیق داده شود
    other = [(-1.0) ** i * 0.5 for i in range(512)]
    res2 = client.post(f"{API}/kiosk/identify", headers=headers, json={"vector": other})
    assert res2.json()["matched"] is False


@pytest.fixture(scope="module")
def work_day(client, admin_headers):
    """آخرین روز کاریِ گذشته (شنبه تا چهارشنبه و غیرتعطیل).

    از تاریخ گذشته استفاده می‌کنیم چون سرور ثبت تردد با زمان آینده را رد می‌کند.
    """
    holidays = {
        h["day"] for h in client.get(f"{API}/org/holidays", headers=admin_headers).json()
    }
    day = today_tehran() - timedelta(days=1)
    for _ in range(30):
        if iran_weekday(day) <= 4 and day.isoformat() not in holidays:
            return day
        day -= timedelta(days=1)
    raise AssertionError("روز کاری مناسبی برای آزمون پیدا نشد")


def test_offline_batch_sync_is_idempotent(client, device, employee, admin_headers, work_day):
    headers = {"X-Device-Key": device["api_key"]}
    today = work_day
    uid_in, uid_out = uuid.uuid4().hex, uuid.uuid4().hex

    def at(hour, minute):
        return to_utc(datetime(today.year, today.month, today.day, hour, minute, tzinfo=TEHRAN))

    batch = {
        "device_uid": device["device_uid"],
        "app_version": "1.0.0",
        "records": [
            {
                "employee_id": employee["id"],
                "kind": "in",
                "happened_at": at(8, 12).isoformat(),
                "method": "face",
                "confidence": 0.97,
                "client_uuid": uid_in,
                "created_offline": True,
            },
            {
                "employee_id": employee["id"],
                "kind": "out",
                "happened_at": at(17, 5).isoformat(),
                "method": "face",
                "confidence": 0.95,
                "client_uuid": uid_out,
                "created_offline": True,
            },
        ],
    }
    first = client.post(f"{API}/kiosk/sync", headers=headers, json=batch).json()
    assert first["created"] == 2 and first["duplicates"] == 0

    # ارسال دوباره همان بسته نباید رکورد جدید بسازد
    second = client.post(f"{API}/kiosk/sync", headers=headers, json=batch).json()
    assert second["created"] == 0 and second["duplicates"] == 2

    listing = client.get(
        f"{API}/attendance",
        headers=admin_headers,
        params={"employee_id": employee["id"], "from_jalali": jalali_str(today)},
    ).json()
    assert listing["total"] == 2


def test_daily_report_computes_late_and_worked(client, admin_headers, employee, work_day):
    res = client.get(
        f"{API}/reports/daily", headers=admin_headers, params={"jalali_date": jalali_str(work_day)}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    row = next(r for r in body["items"] if r["personnel_code"] == "1001")
    assert row["status"] == "present"
    assert row["status_fa"] == "حاضر"
    assert row["first_in"] == "08:12"
    assert row["last_out"] == "17:05"
    # ۸:۱۲ تا ۱۷:۰۵ = ۵۳۳ دقیقه
    assert row["worked_minutes"] == 533
    # شیفت ۸:۰۰ با ۱۰ دقیقه ارفاق ⇒ ۲ دقیقه تأخیر
    assert row["late_minutes"] == 2
    # موظفی ۴۵۰ دقیقه ⇒ اضافه‌کاری ۸۳ دقیقه
    assert row["overtime_minutes"] == 83


def test_cooldown_blocks_rapid_duplicate(client, device, employee):
    headers = {"X-Device-Key": device["api_key"]}
    first = client.post(
        f"{API}/kiosk/punch",
        headers=headers,
        json={"employee_id": employee["id"], "kind": "in", "method": "face"},
    ).json()
    assert first["status"] == "created"
    second = client.post(
        f"{API}/kiosk/punch",
        headers=headers,
        json={"employee_id": employee["id"], "kind": "in", "method": "face"},
    ).json()
    assert second["status"] == "duplicate"


def test_leave_marks_absence_as_leave(client, admin_headers):
    emp = client.post(
        f"{API}/employees",
        headers=admin_headers,
        json={"personnel_code": "1002", "first_name": "سارا", "last_name": "کریمی"},
    ).json()
    shifts = client.get(f"{API}/org/shifts", headers=admin_headers).json()
    office = next(s for s in shifts if s["name"] == "شیفت اداری")
    client.patch(
        f"{API}/employees/{emp['id']}", headers=admin_headers, json={"shift_id": office["id"]}
    )

    today = today_tehran()
    leave = client.post(
        f"{API}/leaves",
        headers=admin_headers,
        json={
            "employee_id": emp["id"],
            "leave_type": "daily",
            "start_jalali_date": jalali_str(today),
            "end_jalali_date": jalali_str(today),
            "reason": "مرخصی استحقاقی",
        },
    ).json()
    assert leave["status"] == "pending"

    # تا وقتی تأیید نشده، غیبت محسوب می‌شود
    daily = client.get(f"{API}/reports/daily", headers=admin_headers).json()
    row = next(r for r in daily["items"] if r["personnel_code"] == "1002")
    assert row["status"] in ("absent", "weekend", "holiday")

    client.patch(f"{API}/leaves/{leave['id']}", headers=admin_headers, json={"status": "approved"})
    daily2 = client.get(f"{API}/reports/daily", headers=admin_headers).json()
    row2 = next(r for r in daily2["items"] if r["personnel_code"] == "1002")
    assert row2["status"] in ("leave", "weekend", "holiday")


def test_tasks_lifecycle(client, admin_headers, employee):
    today = today_tehran()
    task = client.post(
        f"{API}/tasks",
        headers=admin_headers,
        json={
            "title": "بازرسی روزانه خط بسته‌بندی",
            "description": "کنترل دما و ثبت در فرم",
            "employee_id": employee["id"],
            "priority": "high",
            "recurrence": "daily",
            "start_jalali_date": jalali_str(today),
            "estimated_minutes": 45,
        },
    )
    assert task.status_code == 201, task.text
    tid = task.json()["id"]
    assert task.json()["priority_fa"] == "زیاد"
    assert task.json()["recurrence_fa"] == "روزانه"

    todays = client.get(
        f"{API}/tasks/today", headers=admin_headers, params={"employee_id": employee["id"]}
    ).json()
    assert any(t["id"] == tid for t in todays)

    log = client.post(
        f"{API}/tasks/logs",
        headers=admin_headers,
        json={"task_id": tid, "status": "done", "spent_minutes": 40},
    )
    assert log.status_code == 201, log.text

    todays2 = client.get(
        f"{API}/tasks/today", headers=admin_headers, params={"employee_id": employee["id"]}
    ).json()
    assert next(t for t in todays2 if t["id"] == tid)["done_today"] is True


def test_manual_punch_and_edit(client, admin_headers, employee):
    yesterday = today_tehran() - timedelta(days=1)
    res = client.post(
        f"{API}/attendance/manual",
        headers=admin_headers,
        json={
            "employee_id": employee["id"],
            "kind": "in",
            "jalali_date": jalali_str(yesterday),
            "clock": "07:55",
            "note": "فراموشی ثبت",
        },
    )
    assert res.status_code == 201, res.text
    rec = res.json()
    assert rec["clock"] == "07:55"
    assert rec["method_fa"] == "ثبت دستی"

    edited = client.patch(
        f"{API}/attendance/{rec['id']}", headers=admin_headers, json={"clock": "08:05"}
    ).json()
    assert edited["clock"] == "08:05"

    assert client.delete(f"{API}/attendance/{rec['id']}", headers=admin_headers).status_code == 200


def test_monthly_report_and_excel_export(client, admin_headers):
    res = client.get(
        f"{API}/reports/summary", headers=admin_headers, params={"period": "monthly"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["totals"]["employees"] >= 2
    assert "گزارش ماهانه" in body["title"]

    xlsx = client.get(
        f"{API}/reports/export/summary.xlsx", headers=admin_headers, params={"period": "monthly"}
    )
    assert xlsx.status_code == 200
    assert xlsx.headers["content-type"].startswith("application/vnd.openxml")
    assert xlsx.content[:2] == b"PK"          # فایل zip معتبر (xlsx)
    assert len(xlsx.content) > 4000

    daily_xlsx = client.get(f"{API}/reports/export/daily.xlsx", headers=admin_headers)
    assert daily_xlsx.status_code == 200 and daily_xlsx.content[:2] == b"PK"

    tasks_xlsx = client.get(f"{API}/reports/export/tasks.xlsx", headers=admin_headers)
    assert tasks_xlsx.status_code == 200 and tasks_xlsx.content[:2] == b"PK"

    punches_xlsx = client.get(f"{API}/reports/export/punches.xlsx", headers=admin_headers)
    assert punches_xlsx.status_code == 200 and punches_xlsx.content[:2] == b"PK"


def test_weekly_report(client, admin_headers):
    res = client.get(f"{API}/reports/summary", headers=admin_headers, params={"period": "weekly"})
    assert res.status_code == 200
    assert "گزارش هفتگی" in res.json()["title"]


def test_dashboard(client, admin_headers):
    body = client.get(f"{API}/reports/dashboard", headers=admin_headers).json()
    assert body["total_employees"] >= 2
    assert len(body["trend"]) == 7
    assert "counters" in body


def test_viewer_cannot_modify(client, admin_headers):
    client.post(
        f"{API}/auth/users",
        headers=admin_headers,
        json={"username": "nazer", "full_name": "ناظر تست", "password": "viewer123", "role": "viewer"},
    )
    token = client.post(
        f"{API}/auth/login", json={"username": "nazer", "password": "viewer123"}
    ).json()["access_token"]
    viewer = {"Authorization": f"Bearer {token}"}

    assert client.get(f"{API}/employees", headers=viewer).status_code == 200
    res = client.post(
        f"{API}/employees",
        headers=viewer,
        json={"personnel_code": "9999", "first_name": "الف", "last_name": "ب"},
    )
    assert res.status_code == 403
    assert "دسترسی" in res.json()["detail"]


def test_future_days_are_not_counted_as_absence(client, admin_headers):
    """گزارش ماهانهٔ ماه جاری نباید روزهای نیامدهٔ ماه را غیبت حساب کند."""
    body = client.get(
        f"{API}/reports/summary", headers=admin_headers, params={"period": "monthly"}
    ).json()

    today_j = jalali_str(today_tehran())
    day_of_month = int(today_j.split("/")[2])

    for row in body["items"]:
        counted = (
            row["present_days"]
            + row["absent_days"]
            + row["leave_days"]
            + row["mission_days"]
            + row["incomplete_days"]
            + row["holiday_days"]
            + row["weekend_days"]
        )
        # حداکثر به تعداد روزهای سپری‌شدهٔ ماه
        assert counted <= day_of_month, f"{row['full_name']}: {counted} > {day_of_month}"


def test_report_for_future_date_is_empty(client, admin_headers):
    future = jalali_str(today_tehran() + timedelta(days=30))
    body = client.get(
        f"{API}/reports/daily", headers=admin_headers, params={"jalali_date": future}
    ).json()
    assert body["total"] == 0


def test_hourly_leave_reduces_expected_and_suppresses_late(client, admin_headers, work_day):
    """مرخصی ساعتی تأییدشده نباید تأخیر بسازد و باید موظفی آن روز را کم کند."""
    emp = client.post(
        f"{API}/employees",
        headers=admin_headers,
        json={"personnel_code": "1500", "first_name": "نازنین", "last_name": "شفیعی"},
    ).json()
    shifts = client.get(f"{API}/org/shifts", headers=admin_headers).json()
    office = next(s for s in shifts if s["name"] == "شیفت اداری")
    client.patch(
        f"{API}/employees/{emp['id']}", headers=admin_headers, json={"shift_id": office["id"]}
    )

    day = jalali_str(work_day)
    # شیفت اداری ۸ تا ۱۶ است؛ این شخص ۸ تا ۱۰ مرخصی ساعتی دارد و ۱۰ می‌آید
    for kind, clock in (("in", "10:00"), ("out", "16:00")):
        res = client.post(
            f"{API}/attendance/manual",
            headers=admin_headers,
            json={"employee_id": emp["id"], "kind": kind, "jalali_date": day, "clock": clock},
        )
        assert res.status_code == 201, res.text

    def day_row():
        body = client.get(
            f"{API}/reports/daily", headers=admin_headers, params={"jalali_date": day}
        ).json()
        return next(r for r in body["items"] if r["personnel_code"] == "1500")

    # بدون مرخصی: ۲ ساعت تأخیر و موظفی کامل (۴۵۰ دقیقه)
    before = day_row()
    assert before["late_minutes"] == 110  # ۱۲۰ منهای ۱۰ دقیقه ارفاق
    assert before["expected_minutes"] == 450

    leave = client.post(
        f"{API}/leaves",
        headers=admin_headers,
        json={
            "employee_id": emp["id"],
            "leave_type": "hourly",
            "start_jalali_date": day,
            "end_jalali_date": day,
            "start_clock": "08:00",
            "end_clock": "10:00",
            "reason": "مراجعه به پزشک",
        },
    ).json()
    client.patch(f"{API}/leaves/{leave['id']}", headers=admin_headers, json={"status": "approved"})

    after = day_row()
    assert after["status"] == "present"
    assert after["late_minutes"] == 0, "مرخصی ساعتی ابتدای روز نباید تأخیر حساب شود"
    # موظفی ۴۵۰ منهای ۱۲۰ دقیقه مرخصی
    assert after["expected_minutes"] == 330
    assert after["leave_minutes"] == 120

    # و در خلاصه دوره‌ای هم دیده شود
    summary = client.get(
        f"{API}/reports/summary",
        headers=admin_headers,
        params={"period": "custom", "from_jalali": day, "to_jalali": day},
    ).json()
    row = next(r for r in summary["items"] if r["personnel_code"] == "1500")
    assert row["hourly_leave_minutes"] == 120


def test_face_images_are_not_publicly_readable(client, admin_headers):
    """تصاویر چهره و عکس ترددها داده شخصی‌اند و نباید بدون احراز هویت خوانده شوند."""
    # یک تصویر واقعی از طریق ثبت چهره بساز
    tiny_jpeg = (
        "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL"
        "DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB"
        "AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
    )
    emp = client.post(
        f"{API}/employees",
        headers=admin_headers,
        json={"personnel_code": "1600", "first_name": "آزمون", "last_name": "تصویر"},
    ).json()
    face = client.post(
        f"{API}/employees/{emp['id']}/faces",
        headers=admin_headers,
        json={"vector": [0.2] * 128, "image_base64": tiny_jpeg},
    ).json()
    assert face["image_path"], "تصویر نمونه ذخیره نشد"

    url = f"/static/{face['image_path']}"

    # بدون هیچ اعتبارنامه‌ای → باید رد شود
    anonymous = client.get(url, headers={"Cookie": ""})
    assert anonymous.status_code == 401, "تصویر چهره عمومی است!"

    # با توکن معتبر → باید بدهد
    allowed = client.get(url, headers=admin_headers)
    assert allowed.status_code == 200
    assert allowed.content[:2] == b"\xff\xd8"  # سرآیند JPEG


def test_kiosk_heartbeat_reports_queue_depth(client, device, admin_headers):
    headers = {"X-Device-Key": device["api_key"]}
    res = client.post(
        f"{API}/kiosk/heartbeat",
        headers=headers,
        json={"pending_count": 7, "app_version": "1.0.0"},
    )
    assert res.status_code == 200, res.text

    devices = client.get(f"{API}/devices", headers=admin_headers).json()
    row = next(d for d in devices if d["device_uid"] == device["device_uid"])
    assert row["pending_count"] == 7
    assert row["app_version"] == "1.0.0"
