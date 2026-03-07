"""Pydantic models for the Rolling 3-Day Planner shared state."""

from enum import Enum
from typing import List, Optional, Dict
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class VisualTone(str, Enum):
    """Visual tone for the UI theme."""
    CALM = "calm"
    NEUTRAL = "neutral"
    TIGHT = "tight"
    HAPPY = "happy"
    SAD = "sad"
    STRESSED = "stressed"


class LoadLevel(str, Enum):
    """Load level indicator for columns."""
    LIGHT = "light"
    MEDIUM = "medium"
    HEAVY = "heavy"


class TaskType(str, Enum):
    """Type of task - fixed (cannot be moved) or flexible (can be moved)."""
    FIXED = "fixed"
    FLEXIBLE = "flexible"


class TaskStatus(str, Enum):
    """Status of a task."""
    PENDING = "pending"
    DONE = "done"
    SKIPPED = "skipped"


class Task(BaseModel):
    """Represents a single task or calendar event."""
    model_config = ConfigDict(use_enum_values=True)
    
    id: str
    title: str
    type: TaskType
    status: TaskStatus = TaskStatus.PENDING
    source: Optional[str] = None          # 'calendar', 'email', 'user'
    duration_minutes: Optional[int] = None # e.g., 60
    start_time: Optional[str] = None       # e.g., "09:00" (24h HH:MM)


class Column(BaseModel):
    """Represents a day column (today, tomorrow, next)."""
    model_config = ConfigDict(use_enum_values=True)
    
    id: str  # 'today', 'tomorrow', 'next'
    label: str  # e.g., "Today", "Thu 12"
    load_level: LoadLevel
    tasks: List[Task] = []


class PlannerState(BaseModel):
    """Root state model for the planner."""
    model_config = ConfigDict(use_enum_values=True)

    global_tone: VisualTone
    # Using a Dict ensures strict pathing for JSON Patches
    # e.g., /columns/today/tasks/0
    columns: Dict[str, Column]


# =============================================================================
# Todoist Export Models
# =============================================================================

class ExportStatus(str, Enum):
    """Status of a Todoist export session."""
    PENDING = "pending"
    WRITING = "writing"
    WRITTEN = "written"
    EDITING = "editing"
    SAVED = "saved"
    ERROR = "error"


class SnapshotTask(BaseModel):
    """A task within a finalized snapshot, ready for mapping to Todoist."""
    model_config = ConfigDict(use_enum_values=True)

    planner_id: str
    title: str
    type: TaskType
    source: Optional[str] = None
    duration: Optional[str] = None
    order: int


class DaySnapshot(BaseModel):
    """Tasks for a single day in the finalized snapshot."""
    model_config = ConfigDict(use_enum_values=True)

    day: str  # 'today', 'tomorrow', 'next'
    label: str
    tasks: List[SnapshotTask] = []


class FinalizedSnapshot(BaseModel):
    """A point-in-time capture of active planner tasks for Todoist export."""
    model_config = ConfigDict(use_enum_values=True)

    snapshot_id: str
    thread_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    global_tone: VisualTone
    days: Dict[str, DaySnapshot]
    include_skipped: bool = False


class ExportSession(BaseModel):
    """Tracks the lifecycle of a plan-to-Todoist export."""
    model_config = ConfigDict(use_enum_values=True)

    session_id: str
    thread_id: str
    snapshot_id: str
    todoist_project_id: Optional[str] = None
    todoist_project_name: str
    section_mapping: Dict[str, str] = {}  # day → section_id
    task_mapping: Dict[str, str] = {}  # planner_id → todoist_id
    status: ExportStatus = ExportStatus.PENDING
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
