"""Email fetching tool (Sensor) for the planner agent."""

import json
from pathlib import Path
from langchain.tools import tool


@tool
def fetch_emails(urgency: str = "any") -> list:
    """
    Fetch unread emails that may need action.
    
    Args:
        urgency: 'high' or 'any' (default: 'any')
    
    Returns:
        List of email items with id, subject, sender, urgency
    """
    data_dir = Path(__file__).parent.parent / "data"
    email_file = data_dir / "mock_email.json"
    
    with open(email_file, "r") as f:
        emails = json.load(f)
    
    # Filter by urgency if specified
    if urgency == "high":
        emails = [e for e in emails if e.get("urgency") == "high"]
    
    return emails
