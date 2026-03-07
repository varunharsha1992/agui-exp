import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from schema import Task, TaskType, TaskStatus


def test_task_has_start_time_field():
    task = Task(id="t1", title="Standup", type=TaskType.FIXED)
    assert task.start_time is None


def test_task_has_duration_minutes_field():
    task = Task(id="t1", title="Standup", type=TaskType.FIXED)
    assert task.duration_minutes is None


def test_task_accepts_start_time():
    task = Task(id="t1", title="Standup", type=TaskType.FIXED, start_time="09:00", duration_minutes=30)
    assert task.start_time == "09:00"
    assert task.duration_minutes == 30


def test_task_no_legacy_duration_field():
    task = Task(id="t1", title="Standup", type=TaskType.FIXED)
    assert "duration" not in task.model_fields or task.model_fields.get("duration") is None
