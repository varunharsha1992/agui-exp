# Incremental Requirements: Todoist MCP App Integration

## Context

This document defines **incremental product requirements** to extend the existing Rolling 3‑Day AI Planner (as defined in `spec.md`) with the ability to **export a finalized plan to Todoist**, while preserving user control and transparency through an **MCP App rendered directly inside chat**.

This is an additive scope: no existing planner behavior is removed or fundamentally changed.

---

## Goal

Enable users to:

1. Finalize a 3‑day plan inside the planner
2. Push that plan into a Todoist project
3. Review and edit exactly what will be saved to Todoist via an embedded MCP App UI
4. Persist changes bidirectionally between the planner agent, the MCP server, and Todoist

---

## Non‑Goals

* Replacing the planner UI with Todoist views
* Full Todoist feature parity (labels, filters, reminders, comments, etc.)
* Multi‑project syncing or long‑term task lifecycle management

---

## High‑Level Architecture Additions

### New Components

1. **Todoist MCP Server (Custom)**
2. **Todoist MCP App (HTML/CSS editor surface)**
3. **Planner Agent – Todoist Tool Extension**
4. **Planner UI – MCP App Renderer (iframe)**

---

## User Flow (Incremental)

1. User completes or confirms a 3‑day plan in the planner UI
2. User instructs agent: *“Save this plan to Todoist”*
3. Agent:

   * Creates or selects a Todoist project
   * Serializes the finalized tasks
   * Calls the Todoist MCP Server
4. MCP Server:

   * Writes tasks to Todoist via Todoist API
   * Fetches current Todoist project content
   * Returns an MCP App definition
5. Chat renders the MCP App inline
6. User:

   * Reviews tasks in the embedded editor
   * Edits titles / ordering / day groupings
   * Clicks **Save**
7. MCP Server updates Todoist and confirms success

---

## Functional Requirements

### FR‑TDI‑001: Finalize Plan for Export

* The system MUST allow the agent to compute a **finalized snapshot** of the current 3‑day planner state.
* Finalized plans MUST exclude:

  * Completed tasks
  * Skipped tasks (unless explicitly requested)

---

### FR‑TDI‑002: Todoist Project Management

* The system MUST support:

  * Creating a new Todoist project
  * Writing into an existing Todoist project
* The agent MUST confirm the target project with the user before writing (explicit or inferred).

---

### FR‑TDI‑003: Todoist MCP Server

* A custom MCP server MUST be implemented to:

  * Authenticate with Todoist API
  * Create / update Todoist tasks
  * Fetch current project task content
* The server MUST expose MCP tools for:

  * `write_plan_to_todoist`
  * `fetch_todoist_project`
  * `update_todoist_project`

---

### FR‑TDI‑004: MCP App Rendering

* The MCP server MUST return an **MCP App** definition compliant with the MCP Apps spec.
* The app MUST render as an embedded iframe inside chat.
* The app MUST display Todoist project content in a simple HTML/CSS editor.

---

### FR‑TDI‑005: Editable Todoist Preview

* The MCP App editor MUST allow:

  * Editing task titles
  * Reordering tasks
  * Grouping tasks by day (Today / Tomorrow / Next)
* The editor MUST reflect the **actual Todoist project state** at load time.

---

### FR‑TDI‑006: Save Action

* The MCP App MUST include a clear **Save** action.
* On save:

  * The MCP server MUST diff changes
  * Apply updates via Todoist API
  * Return a success or error state

---

### FR‑TDI‑007: Error Handling

* If Todoist API calls fail:

  * The MCP App MUST show a recoverable error state
  * No planner state MUST be mutated
* Authentication errors MUST be surfaced clearly to the user.

---

### FR‑TDI‑008: Agent Tooling Extension

* The planner agent MUST be extended with a new tool:

  * `todoist_mcp`
* The agent MUST:

  * Know when to suggest exporting
  * Explain what will be written
  * Defer final control to the MCP App UI

---

### FR‑TDI‑009: UI Integration

* The planner UI MUST:

  * Render MCP App components returned by the server
  * Support iframe‑based apps in chat
  * Maintain conversation context while the app is open

---

## State & Data Mapping

### Task Mapping Rules

| Planner Task      | Todoist Task                |
| ----------------- | --------------------------- |
| Title             | Content                     |
| Day Column        | Section / Naming Convention |
| Order             | Task Order                  |
| Fixed vs Flexible | Metadata (not enforced)     |

---

## Acceptance Criteria

1. A user can export a finalized 3‑day plan to Todoist in under 10 seconds.
2. Users can visually inspect and edit Todoist content before saving.
3. No Todoist data is written without explicit user confirmation.
4. Changes made in the MCP App persist correctly in Todoist.
5. Planner state remains unchanged unless the user explicitly re‑imports or syncs.

---

## Open Questions (Deferred)

* Round‑trip syncing from Todoist → Planner
* Handling Todoist due dates vs planner days
* Multi‑project exports
* Recurring tasks

---

## Success Metric

* ≥80% of users who finalize a plan successfully export it to Todoist on first attempt.
