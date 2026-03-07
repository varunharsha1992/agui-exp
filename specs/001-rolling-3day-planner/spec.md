# Feature Specification: Rolling 3-Day AI Planner

**Feature Branch**: `001-rolling-3day-planner`
**Created**: 2026-02-06
**Status**: Draft
**Input**: User description: "Rolling 3-Day AI Planner - collaborative productivity tool with AG-UI protocol for real-time bidirectional state synchronization between an AI agent and the UI"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chat-Based Schedule Planning (Priority: P1)

A user opens the planner and types a message such as "Plan my day" or "What's on my calendar today?" into the chat panel. The AI agent fetches the user's calendar events and emails, analyzes workload, and generates a balanced 3-day plan displayed as task cards across three columns (Today, Tomorrow, Next). The user sees the board update in real time as the agent streams its response and state changes.

**Why this priority**: This is the core value proposition. Without the ability to interact with the AI agent via chat and see a dynamically generated plan, the product has no differentiating function. It delivers immediate value by turning unstructured input into an organized visual schedule.

**Independent Test**: Can be fully tested by opening the app, typing a planning request in the chat, and verifying that task cards appear in the correct day columns with appropriate details.

**Acceptance Scenarios**:

1. **Given** a user with no existing plan, **When** they type "Plan my day", **Then** the AI agent fetches calendar events and emails, generates a 3-day plan, and the board displays task cards in the correct day columns within 10 seconds.
2. **Given** a user with an existing plan, **When** they type "Add buying groceries to tomorrow", **Then** a new flexible task card appears in the Tomorrow column without disrupting existing tasks.
3. **Given** a user in an active session, **When** the agent is processing a request, **Then** the user sees a thinking indicator and streamed text responses appear progressively in the chat panel.
4. **Given** a user session, **When** the agent calls tools like fetching calendar or emails, **Then** the user sees tool activity indicators (e.g., "Checking Calendar...") in the chat panel.

---

### User Story 2 - Drag-and-Drop Task Rescheduling (Priority: P2)

A user manually drags a flexible task card from one day column to another (e.g., from Today to Tomorrow). The UI updates instantly to reflect the move, and the AI agent is notified of the change so it can validate or adjust the plan accordingly. Fixed tasks (calendar events) cannot be dragged.

**Why this priority**: Direct manipulation of the schedule is essential for user agency. Users need to feel in control of their plan beyond just chatting with the AI. This enables a hybrid workflow where the AI suggests and the user refines.

**Independent Test**: Can be fully tested by dragging a flexible task from one column to another and verifying it stays in the new position, while attempting to drag a fixed task and verifying it cannot be moved.

**Acceptance Scenarios**:

1. **Given** a board with flexible tasks, **When** the user drags a flexible task from Today to Tomorrow, **Then** the task card moves instantly to the Tomorrow column at the drop position.
2. **Given** a board with fixed calendar events, **When** the user attempts to drag a fixed task, **Then** the task does not move and remains in its original position.
3. **Given** a user who just dragged a task, **When** the AI agent determines the move creates an overloaded day, **Then** the agent may suggest adjustments via chat or revert the move by sending a state update.
4. **Given** a dragged task, **When** the move is completed, **Then** the AI agent is notified of the change and the conversation history reflects the manual adjustment.

---

### User Story 3 - Voice-Based Interaction (Priority: P3)

A user activates voice mode from the chat panel and speaks commands to manage their schedule hands-free. The system converts speech to text, processes the request through the same AI agent, and updates the board in real time. The user hears the agent's spoken response while seeing the visual plan update simultaneously. Conversation history is shared between voice and text chat modes.

**Why this priority**: Voice interaction enables hands-free planning (e.g., while commuting or cooking). It expands accessibility and convenience but depends on the core planning functionality (P1) being complete first.

**Independent Test**: Can be fully tested by clicking the voice button, speaking a command like "Move my grocery task to tomorrow", and verifying the board updates while the agent responds audibly.

**Acceptance Scenarios**:

1. **Given** a user viewing the planner, **When** they click the voice mode button, **Then** a voice connection is established and the user can speak commands.
2. **Given** an active voice session, **When** the user says "What's on my calendar tomorrow?", **Then** the agent responds with audio and the board highlights or displays tomorrow's events.
3. **Given** a user who previously chatted via text, **When** they switch to voice mode, **Then** the agent has full context of the prior conversation and can reference earlier requests.
4. **Given** an active voice session, **When** the user says "disconnect" or clicks the voice button again, **Then** the voice session ends cleanly and the user returns to text chat mode.

---

### User Story 4 - Visual Workload Feedback (Priority: P4)

The AI agent assesses the workload density for each day and adjusts the visual presentation accordingly. The overall UI tone shifts (e.g., calm blue gradient for light days, warm orange for overloaded days) and each column header shows a load level indicator. This gives users an at-a-glance sense of schedule pressure.

**Why this priority**: Visual feedback enhances the user's awareness of schedule balance without requiring them to count tasks. It adds polish and improves the planning experience but is not essential for basic functionality.

**Independent Test**: Can be fully tested by loading a plan with varying task counts per day and verifying that the UI tone and column indicators change to reflect workload differences.

**Acceptance Scenarios**:

1. **Given** a plan with few tasks on a day, **When** the board renders, **Then** the overall tone displays a calm visual style and the column header shows a "light" indicator.
2. **Given** a plan with many tasks packed into one day, **When** the board renders, **Then** the overall tone shifts to a busier visual style and the column header shows a "heavy" indicator.
3. **Given** the user asks the agent to "balance my week", **When** the agent redistributes tasks, **Then** the visual tone and load indicators update to reflect the new distribution.

---

### User Story 5 - Task Status Management (Priority: P5)

A user can mark tasks as done or skipped, either through the UI or by telling the AI agent. Completed or skipped tasks are visually distinguished from active tasks. The agent can also mark tasks on the user's behalf when instructed.

**Why this priority**: Task completion tracking closes the productivity loop. Users need to see progress, but the core planning and rescheduling workflows are more foundational.

**Independent Test**: Can be fully tested by marking a task as done and verifying its visual state changes, then asking the agent to skip another task and verifying the same.

**Acceptance Scenarios**:

1. **Given** an active task on the board, **When** the user marks it as done, **Then** the task card visually indicates completion (e.g., strikethrough, muted color).
2. **Given** a task the user wants to skip, **When** they tell the agent "skip my dentist appointment", **Then** the task is marked as skipped and visually distinguished.
3. **Given** multiple completed tasks, **When** the user views the board, **Then** completed and skipped tasks are clearly distinguishable from pending tasks.

---

### Edge Cases

- What happens when the user drags a task but the network connection to the agent is lost mid-operation? The optimistic UI update should remain, and a reconnection attempt should sync state.
- What happens when the AI agent and the user make conflicting changes simultaneously (e.g., user drags task A to Tomorrow while agent moves task A to Next)? The agent's state update takes precedence as the source of truth, and the UI reconciles.
- What happens when the user opens the app in multiple browser tabs with the same thread ID? Both tabs should reflect the same state; updates in one tab should be visible in the other.
- What happens when the user's calendar has no events and no emails exist? The agent should gracefully handle empty data and offer to help the user create tasks manually.
- What happens when a voice session is interrupted (e.g., browser tab loses focus, network drops)? The system should attempt reconnection and, if unsuccessful, fall back to text chat mode gracefully.
- What happens when the user sends a message while the agent is still processing a previous request? The system should queue the message or inform the user that the agent is busy.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a three-column board representing Today, Tomorrow, and Next day, with task cards in each column.
- **FR-002**: System MUST support two task types: fixed tasks (calendar events that cannot be moved) and flexible tasks (user or email-originated tasks that can be repositioned).
- **FR-003**: Users MUST be able to send text messages to the AI agent via a chat panel and receive streamed responses in real time.
- **FR-004**: The AI agent MUST be able to fetch calendar events and email tasks to inform schedule planning.
- **FR-005**: The AI agent MUST be able to create, move, and organize tasks across the three day columns based on user requests.
- **FR-006**: Users MUST be able to drag and drop flexible tasks between day columns; the UI must update immediately upon drop.
- **FR-007**: Fixed tasks MUST NOT be movable by either the user (drag-and-drop) or the AI agent.
- **FR-008**: The system MUST maintain conversation history within a session, allowing the agent to reference prior context.
- **FR-009**: The system MUST synchronize state bidirectionally: agent changes update the UI, and user changes (drag-and-drop) notify the agent.
- **FR-010**: Users MUST be able to activate voice mode to interact with the AI agent using speech instead of text.
- **FR-011**: Voice and text chat modes MUST share the same conversation history and session context so switching between them is seamless.
- **FR-012**: The AI agent MUST be able to set a visual tone (calm, neutral, tight) based on overall workload assessment.
- **FR-013**: Each day column MUST display a load level indicator (light, medium, heavy) reflecting task density.
- **FR-014**: Users MUST be able to mark tasks as done or skipped, either through the UI or by instructing the agent.
- **FR-015**: The system MUST display tool activity indicators in the chat when the agent is performing actions (e.g., fetching calendar, moving tasks).
- **FR-016**: Task cards MUST visually distinguish between task sources (calendar, email, user-created).
- **FR-017**: The system MUST handle connection interruptions gracefully, preserving user state and attempting reconnection.

### Key Entities

- **Task**: Represents a single activity or event. Key attributes: title, day assignment (today/tomorrow/next), type (fixed or flexible), source (calendar, email, or user), urgency level, completion status (pending, done, skipped), and optional time slot.
- **Day Column**: Represents one of the three planning days (Today, Tomorrow, Next). Contains an ordered list of tasks and has a computed load level (light, medium, heavy).
- **Planner State**: The complete state of a user's 3-day plan. Contains three day columns, a global visual tone, and metadata. This is the authoritative state object synchronized between agent and UI.
- **Conversation Thread**: A session-scoped conversation between the user and the AI agent. Contains message history, is identified by a unique thread ID, and persists across voice/text mode switches.
- **State Delta**: An incremental change to the planner state expressed as a set of operations (add, remove, replace, move). Used for efficient real-time synchronization rather than full state replacement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can generate a complete 3-day plan from a single chat message within 10 seconds of sending the request.
- **SC-002**: Drag-and-drop task moves reflect in the UI within 200 milliseconds, providing a responsive feel indistinguishable from a native application.
- **SC-003**: 90% of users can successfully plan their day using the chat interface on their first attempt without external guidance.
- **SC-004**: Voice commands produce the same planning outcomes as equivalent text commands with at least 95% accuracy.
- **SC-005**: Switching between voice and text modes preserves full conversation context with zero loss of information.
- **SC-006**: The visual tone and load indicators accurately reflect workload distribution, matching the agent's assessment in 100% of cases.
- **SC-007**: Users can identify task type (fixed vs. flexible) and source (calendar, email, user) at a glance without reading task details.
- **SC-008**: The system recovers from network interruptions within 5 seconds and resynchronizes state without user intervention.

## Assumptions

- Users are individuals planning their own schedule; multi-user collaboration or shared calendars are out of scope for this version.
- Calendar and email data is provided via mock data sources for the initial version; live integrations with external calendar and email services will be addressed in future iterations.
- The application targets modern desktop web browsers; mobile-optimized layouts are not in scope.
- A single user session maps to a single thread ID; there is no multi-session or multi-device synchronization beyond what the thread ID provides.
- Voice mode requires a stable internet connection and browser microphone permissions; offline voice processing is not supported.
- The "Next" day column always refers to the day after tomorrow, creating a fixed 3-day rolling window.
- Task urgency levels follow a simple scale (low, medium, high) and are assigned by the AI agent based on email metadata or user input.
- No authentication or user accounts are required for this version; the session is identified solely by the thread ID stored in the browser.
