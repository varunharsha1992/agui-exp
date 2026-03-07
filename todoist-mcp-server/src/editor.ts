/**
 * MCP App editor for reviewing and editing Todoist project tasks.
 * Uses vanilla JS + App class from @modelcontextprotocol/ext-apps.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Types
interface TaskData {
  id: string;
  content: string;
  order: number;
  description: string;
}

interface SectionData {
  id: string;
  name: string;
  order: number;
  tasks: TaskData[];
}

interface ProjectData {
  id: string;
  name: string;
  sections: SectionData[];
}

interface Change {
  action: "update_title" | "move_section" | "reorder";
  task_id: string;
  new_content?: string;
  new_section_id?: string;
  new_order?: string[];
}

// State
let projectId = "";
let projectData: ProjectData | null = null;
let pendingChanges: Change[] = [];
let hasUnsavedChanges = false;

// DOM
const mainEl = document.querySelector(".main") as HTMLElement;
const loadingEl = document.getElementById("loading")!;
const editorEl = document.getElementById("editor")!;
const errorEl = document.getElementById("error")!;
const errorMessageEl = document.getElementById("error-message")!;
const projectTitleEl = document.getElementById("project-title")!;
const sectionsEl = document.getElementById("sections")!;
const statusBarEl = document.getElementById("status-bar")!;
const saveBtnEl = document.getElementById("save-btn")!;
const refreshBtnEl = document.getElementById("refresh-btn")!;
const retryBtnEl = document.getElementById("retry-btn")!;

// Styles
const styleEl = document.createElement("style");
styleEl.textContent = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
    background: var(--color-background-primary, #fff);
    color: var(--color-text-primary, #1a1a1a);
    line-height: 1.5;
  }
  .main {
    max-width: 600px;
    margin: 0 auto;
    padding: 16px;
  }
  .loading {
    text-align: center;
    padding: 32px;
    color: var(--color-text-secondary, #666);
  }
  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    gap: 12px;
  }
  .editor-header h2 {
    font-size: var(--font-heading-md-size, 18px);
    font-weight: var(--font-weight-semibold, 600);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .editor-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .btn {
    padding: 6px 14px;
    border: none;
    border-radius: var(--border-radius-md, 6px);
    cursor: pointer;
    font-size: var(--font-text-sm-size, 13px);
    font-weight: 500;
    transition: opacity 0.15s;
  }
  .btn:hover { opacity: 0.85; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary {
    background: var(--color-accent-primary, #3b82f6);
    color: #fff;
  }
  .btn-secondary {
    background: var(--color-background-secondary, #f3f4f6);
    color: var(--color-text-primary, #1a1a1a);
    border: 1px solid var(--color-border-primary, #e5e7eb);
  }
  .sections { display: flex; flex-direction: column; gap: 16px; }
  .section {
    background: var(--color-background-secondary, #f9fafb);
    border: 1px solid var(--color-border-primary, #e5e7eb);
    border-radius: var(--border-radius-lg, 8px);
    overflow: hidden;
  }
  .section-header {
    padding: 10px 14px;
    font-weight: var(--font-weight-semibold, 600);
    font-size: var(--font-text-sm-size, 13px);
    color: var(--color-text-secondary, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--color-border-primary, #e5e7eb);
    background: var(--color-background-tertiary, #f3f4f6);
  }
  .task-list { list-style: none; }
  .task-item {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--color-border-secondary, #f3f4f6);
    gap: 10px;
    cursor: grab;
    transition: background 0.1s;
  }
  .task-item:last-child { border-bottom: none; }
  .task-item:hover { background: var(--color-background-hover, #f0f0f0); }
  .task-item.dragging { opacity: 0.5; }
  .task-item.drag-over { border-top: 2px solid var(--color-accent-primary, #3b82f6); }
  .drag-handle {
    color: var(--color-text-tertiary, #9ca3af);
    cursor: grab;
    flex-shrink: 0;
    font-size: 14px;
  }
  .task-title {
    flex: 1;
    border: none;
    background: transparent;
    font-size: var(--font-text-md-size, 14px);
    color: var(--color-text-primary, #1a1a1a);
    font-family: inherit;
    padding: 2px 4px;
    border-radius: 3px;
    min-width: 0;
  }
  .task-title:focus {
    outline: none;
    background: var(--color-background-primary, #fff);
    box-shadow: 0 0 0 2px var(--color-accent-primary, #3b82f6);
  }
  .status-bar {
    margin-top: 12px;
    font-size: var(--font-text-xs-size, 11px);
    color: var(--color-text-secondary, #6b7280);
    min-height: 20px;
  }
  .status-bar.success { color: #16a34a; }
  .status-bar.error { color: #dc2626; }
  .error-banner {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: var(--border-radius-md, 6px);
    padding: 16px;
    text-align: center;
  }
  .error-banner p {
    color: #dc2626;
    margin-bottom: 12px;
    font-size: var(--font-text-sm-size, 13px);
  }
  .empty-section {
    padding: 12px 14px;
    color: var(--color-text-tertiary, #9ca3af);
    font-size: var(--font-text-sm-size, 13px);
    font-style: italic;
  }
`;
document.head.appendChild(styleEl);

// Rendering
function renderProject(data: ProjectData) {
  console.log('[Editor] renderProject()', data?.name, 'sections:', data?.sections?.length);
  projectData = data;
  projectId = data.id;
  projectTitleEl.textContent = data.name;
  sectionsEl.innerHTML = "";

  const sortedSections = [...data.sections].sort((a, b) => a.order - b.order);

  for (const section of sortedSections) {
    const sectionEl = document.createElement("div");
    sectionEl.className = "section";
    sectionEl.dataset.sectionId = section.id;

    const headerEl = document.createElement("div");
    headerEl.className = "section-header";
    headerEl.textContent = section.name;
    sectionEl.appendChild(headerEl);

    const listEl = document.createElement("ul");
    listEl.className = "task-list";
    listEl.dataset.sectionId = section.id;

    if (section.tasks.length === 0) {
      const emptyEl = document.createElement("li");
      emptyEl.className = "empty-section";
      emptyEl.textContent = "No tasks";
      listEl.appendChild(emptyEl);
    } else {
      for (const task of section.tasks) {
        const itemEl = createTaskItem(task, section.id);
        listEl.appendChild(itemEl);
      }
    }

    sectionEl.appendChild(listEl);
    sectionsEl.appendChild(sectionEl);
  }

  loadingEl.style.display = "none";
  editorEl.style.display = "block";
  errorEl.style.display = "none";
}

function createTaskItem(task: TaskData, sectionId: string): HTMLLIElement {
  const itemEl = document.createElement("li");
  itemEl.className = "task-item";
  itemEl.dataset.taskId = task.id;
  itemEl.dataset.sectionId = sectionId;
  itemEl.draggable = true;

  const handleEl = document.createElement("span");
  handleEl.className = "drag-handle";
  handleEl.textContent = "⠿";
  itemEl.appendChild(handleEl);

  const titleEl = document.createElement("input");
  titleEl.className = "task-title";
  titleEl.type = "text";
  titleEl.value = task.content;
  titleEl.dataset.originalValue = task.content;
  titleEl.addEventListener("blur", () => {
    if (titleEl.value !== titleEl.dataset.originalValue) {
      recordChange({
        action: "update_title",
        task_id: task.id,
        new_content: titleEl.value,
      });
      titleEl.dataset.originalValue = titleEl.value;
    }
  });
  titleEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      titleEl.blur();
    }
  });
  itemEl.appendChild(titleEl);

  // Drag events
  itemEl.addEventListener("dragstart", (e) => {
    itemEl.classList.add("dragging");
    e.dataTransfer!.setData("text/plain", JSON.stringify({
      taskId: task.id,
      fromSectionId: sectionId,
    }));
    e.dataTransfer!.effectAllowed = "move";
  });

  itemEl.addEventListener("dragend", () => {
    itemEl.classList.remove("dragging");
    document.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
  });

  itemEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    itemEl.classList.add("drag-over");
  });

  itemEl.addEventListener("dragleave", () => {
    itemEl.classList.remove("drag-over");
  });

  itemEl.addEventListener("drop", (e) => {
    e.preventDefault();
    itemEl.classList.remove("drag-over");

    const data = JSON.parse(e.dataTransfer!.getData("text/plain"));
    const fromSectionId = data.fromSectionId;
    const taskId = data.taskId;
    const toSectionId = itemEl.dataset.sectionId!;

    if (fromSectionId !== toSectionId) {
      recordChange({
        action: "move_section",
        task_id: taskId,
        new_section_id: toSectionId,
      });
    }

    // Visual reorder
    const draggedEl = document.querySelector(`[data-task-id="${taskId}"]`);
    if (draggedEl && draggedEl !== itemEl) {
      itemEl.parentElement!.insertBefore(draggedEl, itemEl);
    }
  });

  return itemEl;
}

function recordChange(change: Change) {
  // Deduplicate: replace existing change for same task+action
  const existingIdx = pendingChanges.findIndex(
    c => c.task_id === change.task_id && c.action === change.action
  );
  if (existingIdx >= 0) {
    pendingChanges[existingIdx] = change;
  } else {
    pendingChanges.push(change);
  }
  hasUnsavedChanges = true;
  setStatus(`${pendingChanges.length} unsaved change${pendingChanges.length > 1 ? "s" : ""}`);
}

function setStatus(text: string, type: "" | "success" | "error" = "") {
  statusBarEl.textContent = text;
  statusBarEl.className = `status-bar ${type}`;
}

function showError(message: string) {
  errorMessageEl.textContent = message;
  loadingEl.style.display = "none";
  editorEl.style.display = "none";
  errorEl.style.display = "block";
}

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

// App lifecycle
const app = new App({ name: "Todoist Editor", version: "1.0.0" });

app.ontoolinput = (params) => {
  const args = params.arguments as Record<string, unknown> | undefined;
  const name = args?.project_name as string | undefined;
  if (name) {
    loadingEl.querySelector("p")!.textContent = `Loading "${name}"...`;
  }
};

app.ontoolresult = (result: CallToolResult) => {
  try {
    console.log('[Editor] received tool result:', result);
    const textContent = result.content?.find(
      (c: { type: string }) => c.type === "text"
    );
    if (!textContent || !("text" in textContent)) {
      console.log('[Editor] no text content in result, skipping');
      return;
    }

    const data = JSON.parse(textContent.text as string);
    console.log('[Editor] parsed data keys:', Object.keys(data), 'has project:', !!data.project, 'has project_id:', !!data.project_id);

    if (data.status === "error") {
      showError(data.message || "An error occurred");
      return;
    }

    // Handle write result (from write_plan_to_todoist) — only project_id is required to fetch
    if (data.project_id) {
      console.log('[Editor] write-plan result: project_id=', data.project_id, ', calling refreshProject()');
      projectId = data.project_id;
      refreshProject();
      return;
    }

    // Handle fetch result (from fetch_todoist_project): server returns { status, project: { id, name, sections } }
    // Some hosts may forward the project object directly as data
    const projectPayload = data.project ?? (data.id && Array.isArray(data.sections) ? data : null);
    if (projectPayload) {
      console.log('[Editor] fetch result: got project, calling renderProject()', projectPayload.name);
      renderProject(projectPayload);
      return;
    }

    // Handle save result (from update_todoist_project)
    if (data.updated_count !== undefined) {
      pendingChanges = [];
      hasUnsavedChanges = false;
      if (data.status === "partial") {
        setStatus(
          `${data.updated_count} saved, ${data.failed_count} failed`,
          "error"
        );
      } else {
        setStatus("Saved successfully!", "success");
        setTimeout(() => setStatus(""), 3000);
      }
      return;
    }
  } catch (e) {
    showError("Failed to parse result");
  }
};

app.onhostcontextchanged = handleHostContextChanged;

app.onteardown = async () => {
  if (hasUnsavedChanges) {
    return { unsavedChanges: pendingChanges };
  }
  return {};
};

app.onerror = (err) => {
  console.error("[Editor]", err);
};

// Actions
async function refreshProject() {
  if (!projectId) return;
  console.log('[Editor] refreshProject() started for project_id=', projectId);
  loadingEl.style.display = "block";
  editorEl.style.display = "none";
  errorEl.style.display = "none";

  try {
    const result = await app.callServerTool({
      name: "fetch_todoist_project",
      arguments: { project_id: projectId },
    });
    console.log('[Editor] refreshProject() callServerTool returned', result);

    // Parse result explicitly — callServerTool return value is not always pushed through ontoolresult
    const textContent = result?.content?.find((c: { type: string }) => c.type === "text");
    const rawText = textContent && "text" in textContent ? textContent.text : null;
    const str = typeof rawText === "string" ? rawText : rawText != null ? JSON.stringify(rawText) : "";
    if (str) {
      const data = JSON.parse(str);
      if (data.status === "error") {
        showError(data.message || "An error occurred");
        return;
      }
      const projectPayload = data.project ?? (data.id && Array.isArray(data.sections) ? data : null);
      if (projectPayload) {
        console.log('[Editor] refreshProject() parsed project, rendering', projectPayload.name);
        renderProject(projectPayload);
        return;
      }
    }
    // Fallback: let ontoolresult handle it if we didn't parse project
    app.ontoolresult?.(result);
  } catch (e) {
    console.error('[Editor] refreshProject() failed', e);
    showError(`Failed to refresh: ${e instanceof Error ? e.message : "Unknown error"}`);
  }
}

async function saveChanges() {
  if (pendingChanges.length === 0) {
    setStatus("No changes to save");
    return;
  }

  saveBtnEl.setAttribute("disabled", "true");
  setStatus("Saving...");

  try {
    const result = await app.callServerTool({
      name: "update_todoist_project",
      arguments: {
        project_id: projectId,
        changes: pendingChanges,
      },
    });

    app.ontoolresult?.(result);
  } catch (e) {
    setStatus(`Save failed: ${e instanceof Error ? e.message : "Unknown error"}`, "error");
  } finally {
    saveBtnEl.removeAttribute("disabled");
  }
}

// Event listeners
saveBtnEl.addEventListener("click", saveChanges);
refreshBtnEl.addEventListener("click", refreshProject);
retryBtnEl.addEventListener("click", refreshProject);

// Connect to host
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
