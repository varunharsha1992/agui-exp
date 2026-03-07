# Feature Specification: Todoist Plan Export

**Feature Branch**: `002-todoist-mcp-integration`
**Created**: 2026-02-06
**Status**: Draft
**Input**: User description: "Todoist MCP App integration for exporting finalized 3-day plans to Todoist with embedded preview and editing"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Export Plan to Todoist (Priority: P1)

A user has finalized their 3-day plan in the planner and wants to save it to Todoist for execution tracking. They tell the AI agent "Save this plan to Todoist." The agent computes a finalized snapshot of the current plan (excluding completed and skipped tasks), confirms which Todoist project to use, and writes the tasks to Todoist. The user sees a confirmation that the export completed successfully.

**Why this priority**: This is the core value of the integration. Without the ability to push a plan into Todoist, no other Todoist-related features have purpose. It bridges the gap between planning (this app) and execution (Todoist), which is the fundamental user need.

**Independent Test**: Can be fully tested by creating a 3-day plan, telling the agent to save it to Todoist, and verifying that the tasks appear in the correct Todoist project organized by day.

**Acceptance Scenarios**:

1. **Given** a user with a finalized 3-day plan containing active tasks, **When** they tell the agent "Save this plan to Todoist", **Then** the agent creates or selects a Todoist project, writes all active (non-completed, non-skipped) tasks, and confirms success within 10 seconds.
2. **Given** a plan with completed and skipped tasks, **When** the agent exports to Todoist, **Then** completed and skipped tasks are excluded from the export by default.
3. **Given** a user who has never connected to Todoist, **When** they request an export, **Then** the system prompts for authentication and guides the user through connecting their Todoist account before proceeding.
4. **Given** a user with multiple Todoist projects, **When** the agent prepares to export, **Then** the agent confirms the target project with the user before writing any data.

---

### User Story 2 - Review and Edit Before Saving (Priority: P2)

After the agent prepares the Todoist export, an embedded editor appears directly inside the chat conversation. This editor shows exactly what will be saved to Todoist — organized by day with editable task titles and reorderable task lists. The user reviews the content, makes any desired changes (editing titles, reordering tasks, adjusting day groupings), and clicks Save to commit the changes to Todoist.

**Why this priority**: User control and transparency are critical for trust. Users need to see and approve exactly what will be written to their Todoist account. Without this review step, users may feel they've lost control over their task management data.

**Independent Test**: Can be fully tested by initiating a Todoist export and verifying that the embedded editor appears in chat showing all tasks organized by day, then editing a task title and saving to confirm the change persists in Todoist.

**Acceptance Scenarios**:

1. **Given** the agent has initiated a Todoist export, **When** the export process completes, **Then** an embedded editor appears inline in the chat showing all tasks grouped by day (Today, Tomorrow, Next).
2. **Given** the embedded editor is displayed, **When** the user edits a task title, **Then** the change is reflected in the editor immediately and will be applied when saved.
3. **Given** the embedded editor is displayed, **When** the user reorders tasks within or across day groups, **Then** the new order is reflected immediately and will be applied when saved.
4. **Given** the user has made edits in the embedded editor, **When** they click Save, **Then** only the changed items are updated in Todoist, the editor shows a success confirmation, and the user can continue chatting.
5. **Given** the embedded editor is open, **When** the user continues chatting with the agent, **Then** the conversation context is maintained and the editor remains accessible.

---

### User Story 3 - Error Recovery During Export (Priority: P3)

When something goes wrong during the Todoist export or save process — such as a network failure, authentication expiry, or Todoist service issue — the user sees a clear error message with guidance on how to recover. No planner data is lost or corrupted, and no partial writes are left in an inconsistent state in Todoist.

**Why this priority**: Users must trust that the integration won't corrupt their data. Graceful error handling prevents frustration and ensures the planner remains a reliable tool even when external services fail.

**Independent Test**: Can be fully tested by simulating a Todoist service failure during export and verifying the user sees a clear error, can retry, and the planner state remains unchanged.

**Acceptance Scenarios**:

1. **Given** the agent is exporting to Todoist, **When** the Todoist service is unreachable, **Then** the user sees a clear error message indicating the service is unavailable and can retry later.
2. **Given** an authentication error occurs during export, **When** the error is detected, **Then** the user is informed that their Todoist connection has expired and is guided to re-authenticate.
3. **Given** a save operation fails in the embedded editor, **When** the failure occurs, **Then** the editor shows a recoverable error state, preserves the user's edits, and allows retrying the save.
4. **Given** any Todoist operation fails, **When** the error occurs, **Then** the planner state remains completely unchanged — no tasks are modified, moved, or deleted in the planner.

---

### User Story 4 - Export to Existing Project (Priority: P4)

A user who has previously exported a plan to Todoist wants to update the same project with a revised plan. The agent recognizes the existing project and writes the updated plan into it, replacing or updating the previous content rather than creating duplicates.

**Why this priority**: Repeat usage is essential for daily planning workflows. Users who export daily need the system to intelligently update rather than duplicate, but this builds on the core export (P1) and review (P2) flows.

**Independent Test**: Can be fully tested by exporting a plan, modifying it, exporting again to the same project, and verifying tasks are updated rather than duplicated.

**Acceptance Scenarios**:

1. **Given** a user has previously exported to a Todoist project, **When** they export again, **Then** the agent offers to update the existing project or create a new one.
2. **Given** the user chooses to update an existing project, **When** the export completes, **Then** tasks are updated (not duplicated) and any tasks removed from the plan are handled appropriately in Todoist.

---

### Edge Cases

- What happens when the user's plan is empty (no active tasks)? The agent should inform the user there are no tasks to export and suggest adding tasks first.
- What happens when the user requests to include skipped tasks in the export? The agent should allow this when explicitly requested, overriding the default exclusion.
- What happens when Todoist has tasks that were manually added outside the planner? The export should not delete or modify tasks in Todoist that were not originally created by the planner.
- What happens when the embedded editor is open and the user navigates away or refreshes? Unsaved changes should be warned about before losing them.
- What happens when the user's Todoist account has reached its project or task limit? The system should detect this and inform the user clearly before attempting to write.
- What happens when network connectivity is lost while the embedded editor is open? The editor should preserve the user's local edits and allow saving once connectivity is restored.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow users to export a finalized 3-day plan to Todoist via a chat command to the AI agent.
- **FR-002**: The finalized plan snapshot MUST exclude completed tasks and skipped tasks by default.
- **FR-003**: The system MUST support both creating a new Todoist project and writing into an existing Todoist project for exports.
- **FR-004**: The agent MUST confirm the target Todoist project with the user before writing any data.
- **FR-005**: The system MUST authenticate with the user's Todoist account and manage authentication credentials securely.
- **FR-006**: After export, the system MUST display an embedded editor directly inside the chat conversation showing the Todoist project content.
- **FR-007**: The embedded editor MUST display tasks grouped by day (Today, Tomorrow, Next) reflecting the plan structure.
- **FR-008**: The embedded editor MUST allow users to edit task titles inline.
- **FR-009**: The embedded editor MUST allow users to reorder tasks within and across day groups.
- **FR-010**: The embedded editor MUST include a clearly labeled Save action that commits changes to Todoist.
- **FR-011**: On save, the system MUST compute the difference between the original and edited state and apply only the changed items to Todoist.
- **FR-012**: The system MUST NOT write any data to Todoist without explicit user confirmation (either via the agent confirmation or the Save action in the editor).
- **FR-013**: If any Todoist operation fails, the system MUST display a recoverable error message and MUST NOT mutate the planner state.
- **FR-014**: Authentication errors MUST be surfaced clearly to the user with guidance on how to re-authenticate.
- **FR-015**: The conversation context MUST be maintained while the embedded editor is open, allowing users to continue chatting.
- **FR-016**: The AI agent MUST be capable of suggesting a Todoist export when the user appears to have finalized a plan.
- **FR-017**: The agent MUST explain to the user what will be written to Todoist before initiating the export.
- **FR-018**: The embedded editor MUST reflect the actual current state of the Todoist project at the time it is opened.

### Task Mapping

- **Title** in the planner maps to **content** in Todoist.
- **Day column** (Today/Tomorrow/Next) maps to day-based grouping or sections in Todoist.
- **Task order** in the planner is preserved as task order in Todoist.
- **Task type** (fixed/flexible) is stored as metadata but not enforced in Todoist.

### Key Entities

- **Finalized Plan Snapshot**: A point-in-time capture of the planner's active tasks across all three days, excluding completed and skipped tasks. This is the data payload sent to Todoist.
- **Todoist Project**: The target container in Todoist where exported tasks are stored. Can be newly created or pre-existing. Identified by name and linked to the planner session.
- **Embedded Editor**: An interactive preview surface rendered inline within the chat conversation. Displays Todoist project content in an editable format with Save capability.
- **Export Session**: The lifecycle of a single plan-to-Todoist export, from the user's request through agent confirmation, Todoist write, editor display, user edits, and final save.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can export a finalized 3-day plan to Todoist in under 10 seconds from the moment they issue the command.
- **SC-002**: 80% or more of users who finalize a plan successfully export it to Todoist on their first attempt without requiring help.
- **SC-003**: Users can visually inspect and edit all exported tasks in the embedded editor before any data is permanently saved to Todoist.
- **SC-004**: 100% of Todoist writes are preceded by explicit user confirmation — no data is written without user approval.
- **SC-005**: Changes made in the embedded editor persist correctly in Todoist after saving, with zero data loss or duplication.
- **SC-006**: The planner state remains completely unchanged after any Todoist operation, whether successful or failed.
- **SC-007**: Users can recover from any Todoist-related error (network, authentication, service) without losing their planner data or unsaved edits.
- **SC-008**: The embedded editor loads and displays Todoist project content within 3 seconds of the export completing.

## Assumptions

- This feature is additive to the existing Rolling 3-Day AI Planner; no existing planner behavior is removed or changed.
- Users have or will create a Todoist account; the system does not provide Todoist account creation.
- Only basic Todoist task features are in scope: title, ordering, and day grouping. Advanced Todoist features (labels, filters, reminders, comments, priorities, recurring tasks) are out of scope.
- The integration targets a single Todoist project per export session; multi-project syncing is not supported.
- Round-trip syncing from Todoist back to the planner is out of scope; this is a one-directional export with a review step.
- Todoist due dates are not mapped from planner days in this version; day grouping is managed via sections or naming conventions only.
- The embedded editor is a lightweight editing surface, not a full Todoist client; complex task management should be done in Todoist directly.
- Long-term task lifecycle management (archiving, recurring tasks, task dependencies) is deferred to future iterations.
