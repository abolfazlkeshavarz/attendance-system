"""شرح وظایف و تکالیف پرسنل."""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import AnyUser, DbSession, ManagerUser
from app.core.jalali import iran_weekday, now_utc, parse_jalali, today_tehran
from app.models.employee import Employee
from app.models.enums import TaskPriority, TaskRecurrence, TaskStatus
from app.models.organization import Department
from app.models.task import Task, TaskLog
from app.schemas.common import Message, Page
from app.schemas.task import (
    TaskCreate,
    TaskLogCreate,
    TaskLogOut,
    TaskOut,
    TaskUpdate,
)

router = APIRouter()


def _base_query():
    return select(Task).options(
        selectinload(Task.employee).selectinload(Employee.department),
        selectinload(Task.logs),
    )


def to_out(task: Task, dept_names: dict[int, str], today: date | None = None) -> TaskOut:
    today = today or today_tehran()
    dept_name = None
    if task.employee is not None and task.employee.department is not None:
        dept_name = task.employee.department.name
    elif task.department_id is not None:
        dept_name = dept_names.get(task.department_id)
    return TaskOut(
        id=task.id,
        title=task.title,
        description=task.description,
        employee_id=task.employee_id,
        department_id=task.department_id,
        status=task.status,
        priority=task.priority,
        recurrence=task.recurrence,
        due_date=task.due_date,
        start_date=task.start_date,
        end_date=task.end_date,
        estimated_minutes=task.estimated_minutes,
        progress=task.progress,
        completed_at=task.completed_at,
        is_active=task.is_active,
        employee_name=task.employee.full_name if task.employee else None,
        department_name=dept_name,
        done_today=any(
            log.log_date == today and log.status == TaskStatus.DONE.value for log in task.logs
        ),
    )


def _dept_names(db) -> dict[int, str]:
    return {d.id: d.name for d in db.execute(select(Department)).scalars()}


def _validate_enums(status: str | None, priority: str | None, recurrence: str | None) -> None:
    if status and status not in {s.value for s in TaskStatus}:
        raise HTTPException(status_code=400, detail="وضعیت وظیفه معتبر نیست")
    if priority and priority not in {p.value for p in TaskPriority}:
        raise HTTPException(status_code=400, detail="اولویت وظیفه معتبر نیست")
    if recurrence and recurrence not in {r.value for r in TaskRecurrence}:
        raise HTTPException(status_code=400, detail="نوع تکرار معتبر نیست")


@router.get("", response_model=Page[TaskOut], summary="فهرست وظایف")
def list_tasks(
    db: DbSession,
    _: AnyUser,
    employee_id: int | None = None,
    department_id: int | None = None,
    status: str | None = None,
    priority: str | None = None,
    recurrence: str | None = None,
    search: str | None = None,
    only_overdue: bool = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 25,
) -> Page[TaskOut]:
    stmt = _base_query()
    count_stmt = select(func.count()).select_from(Task)
    filters = [Task.is_active.is_(True)]

    if employee_id:
        filters.append(Task.employee_id == employee_id)
    if department_id:
        sub = select(Employee.id).where(Employee.department_id == department_id)
        filters.append(or_(Task.department_id == department_id, Task.employee_id.in_(sub)))
    if status:
        filters.append(Task.status == status)
    if priority:
        filters.append(Task.priority == priority)
    if recurrence:
        filters.append(Task.recurrence == recurrence)
    if search:
        like = f"%{search.strip()}%"
        filters.append(or_(Task.title.ilike(like), Task.description.ilike(like)))
    if only_overdue:
        filters.append(Task.due_date < today_tehran())
        filters.append(Task.status.in_([TaskStatus.TODO.value, TaskStatus.IN_PROGRESS.value]))

    stmt = stmt.where(*filters)
    count_stmt = count_stmt.where(*filters)

    total = db.execute(count_stmt).scalar_one()
    rows = (
        db.execute(
            stmt.order_by(Task.due_date.is_(None), Task.due_date, Task.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    names = _dept_names(db)
    return Page[TaskOut](
        items=[to_out(t, names) for t in rows], total=total, page=page, page_size=page_size
    )


@router.get("/today", response_model=list[TaskOut], summary="وظایف امروز یک پرسنل")
def tasks_for_today(
    db: DbSession,
    _: AnyUser,
    employee_id: int | None = None,
    jalali_date: str | None = None,
) -> list[TaskOut]:
    """وظایف یک‌باره سررسیدشده به‌علاوه وظایف تکرارشونده‌ای که امروز فعال‌اند."""
    day = parse_jalali(jalali_date) if jalali_date else today_tehran()
    stmt = _base_query().where(Task.is_active.is_(True))
    if employee_id:
        stmt = stmt.where(Task.employee_id == employee_id)
    tasks = db.execute(stmt).scalars().all()
    names = _dept_names(db)

    selected: list[Task] = []
    for t in tasks:
        if t.recurrence == TaskRecurrence.NONE.value:
            if t.due_date == day and t.status != TaskStatus.CANCELLED.value:
                selected.append(t)
            continue
        if t.start_date and day < t.start_date:
            continue
        if t.end_date and day > t.end_date:
            continue
        if t.recurrence == TaskRecurrence.DAILY.value:
            selected.append(t)
        elif t.recurrence == TaskRecurrence.WEEKLY.value:
            anchor = t.start_date or t.due_date or day
            if iran_weekday(day) == iran_weekday(anchor):
                selected.append(t)
        elif t.recurrence == TaskRecurrence.MONTHLY.value:
            anchor = t.start_date or t.due_date or day
            if day.day == anchor.day:
                selected.append(t)

    return [to_out(t, names, today=day) for t in selected]


@router.get("/{task_id}", response_model=TaskOut, summary="جزئیات وظیفه")
def get_task(task_id: int, db: DbSession, _: AnyUser) -> TaskOut:
    task = db.execute(_base_query().where(Task.id == task_id)).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="وظیفه یافت نشد")
    return to_out(task, _dept_names(db))


@router.post("", response_model=TaskOut, status_code=201, summary="تعریف وظیفه")
def create_task(payload: TaskCreate, db: DbSession, user: ManagerUser) -> TaskOut:
    _validate_enums(None, payload.priority, payload.recurrence)
    if payload.employee_id and db.get(Employee, payload.employee_id) is None:
        raise HTTPException(status_code=404, detail="پرسنل یافت نشد")

    task = Task(
        title=payload.title.strip(),
        description=payload.description,
        employee_id=payload.employee_id,
        department_id=payload.department_id,
        priority=payload.priority,
        recurrence=payload.recurrence,
        estimated_minutes=payload.estimated_minutes,
        due_date=payload.gregorian("due_jalali_date"),
        start_date=payload.gregorian("start_jalali_date"),
        end_date=payload.gregorian("end_jalali_date"),
        assigned_by_user_id=user.id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return to_out(
        db.execute(_base_query().where(Task.id == task.id)).scalar_one(), _dept_names(db)
    )


@router.patch("/{task_id}", response_model=TaskOut, summary="ویرایش وظیفه")
def update_task(task_id: int, payload: TaskUpdate, db: DbSession, _: ManagerUser) -> TaskOut:
    task = db.execute(_base_query().where(Task.id == task_id)).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="وظیفه یافت نشد")

    data = payload.model_dump(exclude_unset=True)
    _validate_enums(data.get("status"), data.get("priority"), data.get("recurrence"))

    for field, attr in (
        ("due_jalali_date", "due_date"),
        ("start_jalali_date", "start_date"),
        ("end_jalali_date", "end_date"),
    ):
        if field in data:
            raw = data.pop(field)
            setattr(task, attr, parse_jalali(raw) if raw else None)

    if data.get("status") == TaskStatus.DONE.value and task.status != TaskStatus.DONE.value:
        task.completed_at = now_utc()
        data.setdefault("progress", 100)
    elif "status" in data and data["status"] != TaskStatus.DONE.value:
        task.completed_at = None

    for key, value in data.items():
        setattr(task, key, value)
    db.commit()
    return to_out(
        db.execute(_base_query().where(Task.id == task_id)).scalar_one(), _dept_names(db)
    )


@router.delete("/{task_id}", response_model=Message, summary="حذف وظیفه")
def delete_task(task_id: int, db: DbSession, _: ManagerUser) -> Message:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="وظیفه یافت نشد")
    db.delete(task)
    db.commit()
    return Message(detail="وظیفه حذف شد")


# ------------------------------------------------------------------ ثبت انجام کار


@router.post("/logs", response_model=TaskLogOut, status_code=201, summary="ثبت انجام وظیفه")
def create_log(payload: TaskLogCreate, db: DbSession, user: ManagerUser) -> TaskLogOut:
    task = db.get(Task, payload.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="وظیفه یافت نشد")
    _validate_enums(payload.status, None, None)

    day = parse_jalali(payload.jalali_date) if payload.jalali_date else today_tehran()
    log = db.execute(
        select(TaskLog).where(TaskLog.task_id == task.id, TaskLog.log_date == day)
    ).scalar_one_or_none()
    if log is None:
        log = TaskLog(task_id=task.id, log_date=day)
        db.add(log)
    log.status = payload.status
    log.spent_minutes = payload.spent_minutes
    log.note = payload.note
    log.recorded_by_user_id = user.id

    # وظیفه یک‌باره با ثبت انجام، بسته می‌شود
    if task.recurrence == TaskRecurrence.NONE.value and payload.status == TaskStatus.DONE.value:
        task.status = TaskStatus.DONE.value
        task.progress = 100
        task.completed_at = now_utc()

    db.commit()
    db.refresh(log)
    out = TaskLogOut.model_validate(log)
    out.task_title = task.title
    return out


@router.get("/logs/list", response_model=list[TaskLogOut], summary="سوابق انجام وظایف")
def list_logs(
    db: DbSession,
    _: AnyUser,
    task_id: int | None = None,
    employee_id: int | None = None,
    from_jalali: str | None = None,
    to_jalali: str | None = None,
) -> list[TaskLogOut]:
    stmt = select(TaskLog).options(selectinload(TaskLog.task))
    if task_id:
        stmt = stmt.where(TaskLog.task_id == task_id)
    if employee_id:
        stmt = stmt.where(TaskLog.task_id.in_(select(Task.id).where(Task.employee_id == employee_id)))
    if from_jalali:
        stmt = stmt.where(TaskLog.log_date >= parse_jalali(from_jalali))
    if to_jalali:
        stmt = stmt.where(TaskLog.log_date <= parse_jalali(to_jalali))

    rows = db.execute(stmt.order_by(TaskLog.log_date.desc(), TaskLog.id.desc())).scalars().all()
    out: list[TaskLogOut] = []
    for log in rows:
        item = TaskLogOut.model_validate(log)
        item.task_title = log.task.title if log.task else None
        out.append(item)
    return out


@router.delete("/logs/{log_id}", response_model=Message, summary="حذف سابقه انجام")
def delete_log(log_id: int, db: DbSession, _: ManagerUser) -> Message:
    log = db.get(TaskLog, log_id)
    if log is None:
        raise HTTPException(status_code=404, detail="سابقه یافت نشد")
    db.delete(log)
    db.commit()
    return Message(detail="سابقه حذف شد")
