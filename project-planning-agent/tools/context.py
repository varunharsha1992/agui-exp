"""Combined planning context tool for the planner agent.

This bundles calendar and email data into a single sensor call so the agent
can initialize an empty plan with fewer tool steps.
"""

import json
from pathlib import Path
from typing import Dict, Any

from langchain.tools import tool


@tool
def fetch_planning_context(email_urgency: str = "any") -> Dict[str, Any]:
    """
    Fetch calendar events for all three days and unread emails in one call.

    Args:
        email_urgency: 'high' or 'any' (default: 'any')

    Returns:
        Dict with:
          - calendar: { today: [...], tomorrow: [...], next: [...] }
          - emails: [...]
    """
    data_dir = Path(__file__).parent.parent / "data"

    # Calendar
    calendar_file = data_dir / "mock_calendar.json"
    with open(calendar_file, "r") as f:
        events = json.load(f)

    calendar = {
        "today": [e for e in events if e.get("day") == "today"],
        "tomorrow": [e for e in events if e.get("day") == "tomorrow"],
        "next": [e for e in events if e.get("day") == "next"],
    }

    # Emails
    email_file = data_dir / "mock_email.json"
    with open(email_file, "r") as f:
        emails = json.load(f)

    if email_urgency == "high":
        emails = [e for e in emails if e.get("urgency") == "high"]

    return {
        "calendar": calendar,
        "emails": emails,
    }

