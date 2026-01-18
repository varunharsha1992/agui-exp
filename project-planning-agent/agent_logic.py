"""LangChain v1 agent definition for the Rolling 3-Day Planner.

Uses create_agent from LangChain v1 with tools and system prompt.
"""

import os
from typing import Optional
from dotenv import load_dotenv
from langchain.agents import create_agent

# Load environment variables
load_dotenv()

from tools.calendar import fetch_calendar
from tools.email import fetch_emails
from tools.actions import (
    set_full_plan,
    move_task_in_plan,
    add_task_to_plan,
    set_visual_tone,
    mark_task_status,
)


SYSTEM_PROMPT = """You are a Rolling 3-Day Planner assistant.

Your job is to help the user manage their schedule across three days: Today, Tomorrow, and Next Day.

## Your Capabilities:

### Sensors (Read-Only)
- `fetch_calendar(day_filter)`: Get fixed calendar events for a specific day ('today', 'tomorrow', 'next')
- `fetch_emails(urgency)`: Get unread emails that may need action ('high' or 'any')

### Actuators (State Modifiers)
- `set_full_plan(today_tasks, tomorrow_tasks, next_tasks, global_tone)`: **USE THIS FIRST** if the plan is empty. or to Bulk-set the entire 3-day plan in one call.
- `move_task_in_plan(task_id, target_day)`: Move a flexible task to another day
- `add_task_to_plan(title, day, source, urgency)`: Add a single new task
- `set_visual_tone(tone)`: Change the UI vibe ('calm', 'neutral', 'tight')
- `mark_task_status(task_id, status)`: Mark a task as 'done' or 'skipped'

## Rules:
1. **FIRST CHECK**: If the current plan state is empty (no tasks), use `set_full_plan` to initialize it by:
   - Fetching calendar events for all 3 days
   - Fetching emails
   - Creating the full plan in ONE call
2. NEVER move a task with type='fixed' - these are immovable calendar events.
3. When rebalancing, prefer moving flexible tasks to less busy days.
4. After any state change, explain what you did in plain English.
5. If a day has 4+ tasks, set global_tone to 'tight'.
6. If all days have 1-2 tasks, set global_tone to 'calm'.

## Response Style:
- Be concise and helpful
- Explain your reasoning when moving tasks
- Acknowledge user requests before acting
"""


def create_planner_agent(model_name: Optional[str] = None):
    """
    Create the Rolling 3-Day Planner agent using LangChain v1 create_agent.
    
    Args:
        model_name: The model identifier (e.g., "gpt-4o", "anthropic:claude-sonnet-4-5-20250929").
                   If None, reads from AGENT_MODEL environment variable.
    
    Returns:
        Agent instance with .stream() method that yields Content Blocks
    """
    # Get model name from env if not provided
    if model_name is None:
        model_name = os.getenv("AGENT_MODEL", "gpt-4o")
    
    # Collect all tools - Sensors + Actuators
    tools = [
        # Sensors (read-only)
        fetch_calendar,
        fetch_emails,
        # Actuators (state modifiers)
        set_full_plan,      # Bulk initialization
        move_task_in_plan,
        add_task_to_plan,
        set_visual_tone,
        mark_task_status,
    ]
    
    # Create the agent using LangChain v1 create_agent
    agent = create_agent(
        model=model_name,
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
    )
    
    return agent
