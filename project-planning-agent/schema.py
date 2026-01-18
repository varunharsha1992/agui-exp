"""Pydantic models for the Rolling 3-Day Planner shared state."""

from enum import Enum
from typing import List, Optional, Dict
from pydantic import BaseModel, ConfigDict


class VisualTone(str, Enum):
    """Visual tone for the UI theme."""
    CALM = "calm"
    NEUTRAL = "neutral"
    TIGHT = "tight"


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
    source: Optional[str] = None  # 'calendar', 'email', 'user'
    duration: Optional[str] = None  # e.g., "30m"


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
