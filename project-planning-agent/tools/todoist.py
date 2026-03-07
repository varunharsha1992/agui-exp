"""Todoist export tool for the planner agent."""

import os
import uuid
import json
from datetime import datetime
from typing import Optional

import httpx
from langchain_core.tools import tool

from schema import (
    PlannerState,
    TaskStatus,
    FinalizedSnapshot,
    DaySnapshot,
    SnapshotTask,
)

MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://localhost:3001/mcp")


def compute_snapshot(state: PlannerState, thread_id: str, include_skipped: bool = False) -> FinalizedSnapshot:
    """Compute a finalized snapshot from the current planner state."""
    days = {}
    day_labels = {"today": "Today", "tomorrow": "Tomorrow", "next": "Next Day"}

    for col_key in ["today", "tomorrow", "next"]:
        column = state.columns.get(col_key)
        if not column:
            continue

        tasks = []
        for idx, task in enumerate(column.tasks):
            # Exclude done tasks always; exclude skipped unless requested
            if task.status == TaskStatus.DONE:
                continue
            if task.status == TaskStatus.SKIPPED and not include_skipped:
                continue

            tasks.append(SnapshotTask(
                planner_id=task.id,
                title=task.title,
                type=task.type,
                source=task.source,
                duration=task.duration,
                order=idx,
            ))

        days[col_key] = DaySnapshot(
            day=col_key,
            label=day_labels.get(col_key, col_key),
            tasks=tasks,
        )

    return FinalizedSnapshot(
        snapshot_id=str(uuid.uuid4()),
        thread_id=thread_id,
        global_tone=state.global_tone,
        days=days,
    )


async def call_mcp_tool(tool_name: str, arguments: dict) -> dict:
    """Call an MCP server tool via JSON-RPC over HTTP."""
    payload = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments,
        },
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            MCP_SERVER_URL,
            json=payload,
            headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
        )
        response.raise_for_status()

        # The response may be JSON-RPC or SSE. Try JSON first.
        content_type = response.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            # Parse SSE: look for the last data line
            result_data = None
            for line in response.text.strip().split("\n"):
                if line.startswith("data: "):
                    try:
                        result_data = json.loads(line[6:])
                    except json.JSONDecodeError:
                        pass
            if result_data and "result" in result_data:
                return result_data["result"]
            raise Exception(f"No valid result in SSE response")
        else:
            data = response.json()
            if "error" in data:
                raise Exception(f"MCP error: {data['error'].get('message', 'Unknown error')}")
            return data.get("result", data)


@tool
def todoist_mcp(project_name: str, project_id: str = "") -> str:
    """Export the current plan to Todoist. Creates a new Todoist project with sections for each day and adds all active tasks.

    Args:
        project_name: Name for the Todoist project (e.g., '3-Day Plan - Feb 6')
        project_id: Optional existing Todoist project ID to update instead of creating new
    """
    import asyncio

    # We need access to current state — this is injected via server.py interceptor
    # The tool returns a signal; the server interceptor handles the actual MCP call
    result = {
        "status": "signal",
        "action": "export_to_todoist",
        "project_name": project_name,
    }
    if project_id:
        result["project_id"] = project_id

    return json.dumps(result)
