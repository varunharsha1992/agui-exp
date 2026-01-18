"""State modification tools (Actuators) for the planner agent.

These tools do NOT modify state directly. They return a "signal" 
that the server interprets to generate STATE_DELTA events.
"""

import uuid
from typing import List, Dict, Any
from langchain.tools import tool


@tool
def set_full_plan(
    today_tasks: List[Dict[str, Any]],
    tomorrow_tasks: List[Dict[str, Any]],
    next_tasks: List[Dict[str, Any]],
    global_tone: str = "neutral"
) -> dict:
    """
    Set the entire plan at once. Use this when the plan is empty or needs complete replacement.
    
    Each task should have: title, type ('fixed' or 'flexible'), source ('calendar', 'email', 'user')
    Task IDs and status will be auto-generated.
    
    Args:
        today_tasks: List of tasks for Today column
        tomorrow_tasks: List of tasks for Tomorrow column  
        next_tasks: List of tasks for Next Day column
        global_tone: 'calm', 'neutral', or 'tight'
    
    Returns:
        Result dict with the complete plan structure
    
    Example:
        set_full_plan(
            today_tasks=[
                {"title": "Team Standup", "type": "fixed", "source": "calendar"},
                {"title": "Review PR", "type": "flexible", "source": "user"}
            ],
            tomorrow_tasks=[...],
            next_tasks=[...],
            global_tone="neutral"
        )
    """
    # VALIDATION
    if global_tone not in ["calm", "neutral", "tight"]:
        return {
            "status": "error",
            "message": f"Invalid global_tone: {global_tone}. Must be 'calm', 'neutral', or 'tight'."
        }
    
    def process_tasks(tasks: List[Dict], day: str) -> List[Dict]:
        processed = []
        for t in tasks:
            task = {
                "id": f"task-{uuid.uuid4().hex[:8]}",
                "title": t.get("title", "Untitled"),
                "type": t.get("type", "flexible"),
                "status": "pending",
                "source": t.get("source", "user")
            }
            processed.append(task)
        return processed
    
    plan = {
        "global_tone": global_tone,
        "columns": {
            "today": {
                "id": "today",
                "label": "Today",
                "load_level": "medium" if len(today_tasks) >= 3 else "light",
                "tasks": process_tasks(today_tasks, "today")
            },
            "tomorrow": {
                "id": "tomorrow",
                "label": "Tomorrow",
                "load_level": "medium" if len(tomorrow_tasks) >= 3 else "light",
                "tasks": process_tasks(tomorrow_tasks, "tomorrow")
            },
            "next": {
                "id": "next",
                "label": "Next Day",
                "load_level": "medium" if len(next_tasks) >= 3 else "light",
                "tasks": process_tasks(next_tasks, "next")
            }
        }
    }
    
    return {
        "status": "success",
        "message": "Full plan created",
        "plan": plan
    }


@tool
def move_task_in_plan(
    task_id: str,
    target_day: str,
    target_index: int = -1
) -> dict:
    """
    Move a task to a different day.
    
    Args:
        task_id: The ID of the task to move
        target_day: 'today', 'tomorrow', or 'next'
        target_index: Position in target column (-1 = append)
    
    Returns:
        Result dict with status and details
    """
    # VALIDATION
    if target_day not in ["today", "tomorrow", "next"]:
        return {
            "status": "error",
            "message": f"Invalid target_day: {target_day}. Must be 'today', 'tomorrow', or 'next'."
        }
    
    # Signal success - server generates STATE_DELTA
    return {
        "status": "success",
        "message": f"Moved task {task_id} to {target_day}",
        "task_id": task_id,
        "target_day": target_day,
        "target_index": target_index
    }


@tool
def add_task_to_plan(
    title: str,
    day: str,
    source: str = "user",
    urgency: str = "low"
) -> dict:
    """
    Create a new task from email or user request.
    
    Args:
        title: Task name
        day: 'today', 'tomorrow', or 'next'
        source: 'email' or 'user'
        urgency: 'high' or 'low'
    
    Returns:
        Result dict with status and the new task object
    """
    # VALIDATION
    if day not in ["today", "tomorrow", "next"]:
        return {
            "status": "error",
            "message": f"Invalid day: {day}. Must be 'today', 'tomorrow', or 'next'."
        }
    
    if source not in ["email", "user"]:
        return {
            "status": "error",
            "message": f"Invalid source: {source}. Must be 'email' or 'user'."
        }
    
    # Generate new task with unique ID
    new_task = {
        "id": f"task-{uuid.uuid4().hex[:8]}",
        "title": title,
        "type": "flexible",
        "status": "pending",
        "source": source
    }
    
    return {
        "status": "success",
        "message": f"Created task '{title}' in {day}",
        "task": new_task,
        "day": day
    }


@tool
def set_visual_tone(tone: str) -> dict:
    """
    Change the UI visual tone based on workload density.
    
    Args:
        tone: 'calm', 'neutral', or 'tight'
    
    Returns:
        Result dict with status
    """
    # VALIDATION
    if tone not in ["calm", "neutral", "tight"]:
        return {
            "status": "error",
            "message": f"Invalid tone: {tone}. Must be 'calm', 'neutral', or 'tight'."
        }
    
    return {
        "status": "success",
        "message": f"Set visual tone to {tone}",
        "tone": tone
    }


@tool
def mark_task_status(task_id: str, status: str) -> dict:
    """
    Mark a task as done or skipped.
    
    Args:
        task_id: The ID of the task
        status: 'done' or 'skipped'
    
    Returns:
        Result dict with status
    """
    # VALIDATION
    if status not in ["done", "skipped"]:
        return {
            "status": "error",
            "message": f"Invalid status: {status}. Must be 'done' or 'skipped'."
        }
    
    return {
        "status": "success",
        "message": f"Marked task {task_id} as {status}",
        "task_id": task_id,
        "new_status": status
    }
