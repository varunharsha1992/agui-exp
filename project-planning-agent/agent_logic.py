"""LangChain v1 agent definition for the Rolling 3-Day Planner.

Uses create_agent from LangChain v1 with tools and system prompt.
"""

import os
from typing import Optional
from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_groq import ChatGroq
from pathlib import Path

# Load environment variables
load_dotenv()

# Groq model id for GPT-OSS 120B (BaseChatModel via ChatGroq)
GROQ_MODEL_120B = "openai/gpt-oss-120b"

from tools.calendar import fetch_calendar
from tools.email import fetch_emails
from tools.context import fetch_planning_context
from tools.actions import (
    set_full_plan,
    move_task_in_plan,
    add_task_to_plan,
    set_visual_tone,
    mark_task_status,
)
from tools.todoist import todoist_mcp


def _load_scheduling_rules() -> str:
    """Load scheduling rules from config file, return empty string on failure."""
    rules_path = Path(__file__).parent / "config" / "scheduling_rules.md"
    try:
        return "\n\n" + rules_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


SYSTEM_PROMPT = """You are a Rolling 3-Day Planner assistant.

Your job is to help the user manage their schedule across three days: Today, Tomorrow, and Next Day. And help them manage their mood and energy level. For example, If the user is stressed, you help them relax and de-stress by looking and rebalancing their plan, or by changing the tone of the UI or a combination of both.

## Tools that you can use to help the user manage their plan, task load, mood and energy level:

### Sensors (Read-Only)
- `fetch_planning_context(email_urgency)`: Get calendar events for all three days plus relevant emails in one call

### Actuators (State Modifiers)
- `set_full_plan(today_tasks, tomorrow_tasks, next_tasks, global_tone)`: **USE THIS FIRST** if the plan is empty, or to bulk-set the entire 3-day plan. Each task MUST include `start_time` (HH:MM) and `duration_minutes` (int, multiple of 30).
- `move_task_in_plan(task_id, target_day)`: Move a flexible task to another day
- `add_task_to_plan(title, day, source, urgency)`: Add a single new task
- `set_visual_tone(tone)`: Change the UI vibe ('calm', 'neutral', 'tight')
- `mark_task_status(task_id, status)`: Mark a task as 'done' or 'skipped'

## Rules:
1. **FIRST CHECK**: If the current plan state is empty (no tasks), use `fetch_planning_context` to gather calendar + email data in one step, then call `set_full_plan` once to initialize the plan.
2. NEVER move a task with type='fixed' - these are immovable calendar events.
3. When rebalancing, prefer moving flexible tasks to less busy days.
4. After any state change, explain what you did in plain English.
5. You can decide the initial tone based on the user's message or basically the task count. For example:
5a. If a day has 4+ tasks, set global_tone to 'tight'.
5b. If all days have 1-2 tasks, you can maybe set global_tone to 'calm' or 'neutral'.
7. Depending on the mood of the user, set the global_tone accordingly. For example, if the user is happy, set the global_tone to 'calm'. If the user is stressed, set the global_tone to 'tight'. If the user is neutral, set the global_tone to 'neutral'. You can decide the mood of the user based on the user's message or the context of the conversation.

### Todoist Export
- `todoist_mcp(project_name, project_id)`: Export the current plan to Todoist
  - When user says "save to todoist", "export plan", "send to todoist", etc.
  - ALWAYS confirm the project name with the user before calling this tool
  - Tell the user what will be exported (active tasks, excluding done/skipped)
  - If a previous export exists, ask whether to update the existing project or create a new one

## Rules:
1. **FIRST CHECK**: If the current plan state is empty (no tasks), use `fetch_planning_context` to gather calendar + email data in one step, then call `set_full_plan` once to initialize the plan.
2. NEVER move a task with type='fixed' - these are immovable calendar events.
3. When rebalancing, prefer moving flexible tasks to less busy days.
4. After any state change, explain what you did in plain English.
5. If a day has 4+ tasks, set global_tone to 'tight'.
6. If all days have 1-2 tasks, set global_tone to 'calm'.
7. For Todoist exports: explain what will be written before calling the tool, and confirm with the user.
8. Decide load level based on the number of tasks in the plan. If there are 4+ tasks, set load_level to 'heavy'. If there are 1-3 tasks, set load_level to 'medium'. If there are 0 tasks, set load_level to 'light'. Similarly, decide the global_tone based on the mood of the user. For additional context for you, there will be music that will play based on the global_tone. For example, if the mood is stressed, then a relaxing music will play. If the mood is happy, then a upbeat music will play. It could be a mood reinforcement to help the user feel better or a calming effect to help them relax. Use this to fine-tune your messaging to the user (ex: you can say "I've noticed you're feeling stressed. Let's take a moment to relax and de-stress by rebalancing your plan.")
9. Always when you replan, keep in mind that the load_level and global_tone is consistent to the new plan and mood.

## Response Style:
- Be concise and helpful
- Explain your reasoning when moving tasks
- Acknowledge user requests before acting
"""


def create_planner_agent(model_name: Optional[str] = None):
    """
    Create the Rolling 3-Day Planner agent using LangChain v1 create_agent.

    Uses Groq GPT-OSS 120B as the BaseChatModel (ChatGroq). Set GROQ_API_KEY in env.

    Args:
        model_name: Ignored; kept for API compatibility. Model is fixed to Groq 120B.

    Returns:
        Agent instance with .stream() method that yields Content Blocks
    """
    # BaseChatModel: Groq GPT-OSS 120B via ChatGroq
    groq_api_key = os.getenv("GROQ_API_KEY")
    if not groq_api_key:
        raise ValueError(
            "GROQ_API_KEY is required. Set it in .env or environment. "
            "Get a key at https://console.groq.com/keys"
        )
    model = ChatGroq(
        model=GROQ_MODEL_120B,
        api_key=groq_api_key,
        temperature=0,
    )

    # Collect all tools - Sensors + Actuators
    tools = [
        # Sensors (read-only)
        fetch_planning_context,
        # Actuators (state modifiers)
        set_full_plan,      # Bulk initialization
        move_task_in_plan,
        add_task_to_plan,
        set_visual_tone,
        mark_task_status,
        # Todoist export
        todoist_mcp,
    ]

    # Create the agent using LangChain v1 create_agent
    agent = create_agent(
        model=model,
        tools=tools,
        system_prompt=SYSTEM_PROMPT + _load_scheduling_rules(),
    )

    return agent
