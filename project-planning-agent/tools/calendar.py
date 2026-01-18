"""Calendar fetching tool for the planner agent."""

import json
from pathlib import Path
from langchain.tools import tool


@tool
def fetch_calendar(day_filter: str):
    """
    Fetch fixed calendar events.
    Args:
        day_filter: 'today', 'tomorrow', or 'next'
    """
    data_dir = Path(__file__).parent.parent / "data"
    calendar_file = data_dir / "mock_calendar.json"
    
    with open(calendar_file, "r") as f:
        events = json.load(f)
    
    return [e for e in events if e.get('day') == day_filter]
