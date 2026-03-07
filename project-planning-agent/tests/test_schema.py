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


from server import _normalize_duration, _assign_slot


# _normalize_duration tests
def test_normalize_duration_hours():
    assert _normalize_duration("1h") == 60

def test_normalize_duration_minutes_string():
    assert _normalize_duration("30m") == 30

def test_normalize_duration_mixed():
    assert _normalize_duration("45m") == 45

def test_normalize_duration_int_passthrough():
    assert _normalize_duration(60) == 60

def test_normalize_duration_none():
    assert _normalize_duration(None) == 30  # default to 30 min


# _assign_slot tests
def _make_simple_task(start: str, duration: int):
    """Helper: create a minimal object with start_time and duration_minutes."""
    class T:
        pass
    t = T()
    t.start_time = start
    t.duration_minutes = duration
    return t

def test_assign_slot_empty_day():
    result = _assign_slot([], 60)
    assert result == "09:00"

def test_assign_slot_after_fixed_task():
    existing = [_make_simple_task("09:00", 60)]   # ends 10:00
    result = _assign_slot(existing, 30)
    assert result == "10:15"  # 10:00 + 15 min buffer

def test_assign_slot_skips_overlap():
    existing = [
        _make_simple_task("09:00", 60),   # ends 10:00
        _make_simple_task("10:15", 45),   # ends 11:00
    ]
    result = _assign_slot(existing, 30)
    assert result == "11:15"  # 11:00 + 15 min buffer

def test_assign_slot_respects_working_hours():
    # Fill up to near end of day
    existing = [_make_simple_task("09:00", 540)]  # 9h, ends 18:00
    result = _assign_slot(existing, 60)
    assert result is None  # no room before 19:00
