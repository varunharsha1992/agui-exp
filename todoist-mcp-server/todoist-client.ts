import type { TodoistProject, TodoistSection, TodoistTask } from "./models.js";
import {
  TodoistProjectSchema,
  TodoistSectionSchema,
  TodoistTaskSchema,
} from "./models.js";

// Error classes

export class TodoistAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodoistAuthError";
  }
}

export class TodoistNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodoistNotFoundError";
  }
}

export class TodoistRateLimitError extends Error {
  retryAfter: number;
  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = "TodoistRateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class TodoistApiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "TodoistApiError";
    this.statusCode = statusCode;
  }
}

export class TodoistValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodoistValidationError";
  }
}

// Sync API types

type SyncStatusValue =
  | "ok"
  | { error_code?: number; error?: string; http_code?: number };

interface SyncResponse {
  projects?: Array<Record<string, unknown>>;
  sections?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  sync_status?: Record<string, SyncStatusValue>;
  temp_id_mapping?: Record<string, string>;
}

interface SyncParams {
  sync_token?: string;
  resource_types?: string[];
  commands?: Array<{
    type: string;
    uuid: string;
    temp_id?: string;
    args: Record<string, unknown>;
  }>;
}

// Client

export class TodoistClient {
  private apiToken: string;
  private baseUrl: string;
  private timeout: number;

  constructor(apiToken: string, baseUrl?: string) {
    if (!apiToken) {
      throw new TodoistAuthError("Todoist API token is required");
    }
    this.apiToken = apiToken;
    this.baseUrl = (baseUrl || "https://api.todoist.com/api/v1").replace(
      /\/$/,
      "",
    );
    this.timeout = 30_000;
  }

  private async sync(params: SyncParams): Promise<SyncResponse> {
    const MAX_RETRIES = 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const body = new URLSearchParams();

      if (params.sync_token !== undefined) {
        body.set("sync_token", params.sync_token);
      }
      if (params.resource_types?.length) {
        body.set("resource_types", JSON.stringify(params.resource_types));
      }
      if (params.commands?.length) {
        body.set("commands", JSON.stringify(params.commands));
      }

      const url = `${this.baseUrl}/sync`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          await this.handleError(response);
        }

        const data = (await response.json()) as SyncResponse;

        // Sync API can return 200 with sync_status containing per-command errors
        if (params.commands?.length && data.sync_status) {
          for (const [, status] of Object.entries(data.sync_status)) {
            if (status !== "ok" && typeof status === "object" && status?.http_code) {
              this.throwFromSyncStatus(status);
            }
          }
        }

        return data;
      } catch (err) {
        clearTimeout(timer);
        if (
          err instanceof TodoistApiError &&
          err.statusCode >= 500 &&
          attempt < MAX_RETRIES
        ) {
          lastError = err;
          const delay = Math.min(1000 * 2 ** attempt, 8000);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }

    throw lastError ?? new TodoistApiError("Max retries exceeded", 500);
  }

  private throwFromSyncStatus(status: {
    error_code?: number;
    error?: string;
    http_code?: number;
  }): never {
    const code = status.http_code ?? status.error_code ?? 500;
    const msg = status.error ?? `Todoist API error: ${code}`;

    switch (code) {
      case 401:
      case 403:
        throw new TodoistAuthError(msg);
      case 404:
        throw new TodoistNotFoundError(msg);
      case 400:
        throw new TodoistValidationError(msg);
      case 429:
        throw new TodoistRateLimitError(msg, 60);
      default:
        throw new TodoistApiError(msg, code);
    }
  }

  private async handleError(response: Response): Promise<never> {
    let errorMessage = `Todoist API error: ${response.status}`;
    try {
      const errorBody = await response.json() as { error?: string; error_extra?: { explanation?: string } };
      if (errorBody.error) {
        errorMessage = errorBody.error;
        if (errorBody.error_extra?.explanation) {
          errorMessage += `: ${errorBody.error_extra.explanation}`;
        }
      }
    } catch {
      // Could not parse error body
    }

    switch (response.status) {
      case 401:
      case 403:
        throw new TodoistAuthError(errorMessage);
      case 404:
        throw new TodoistNotFoundError(errorMessage);
      case 400:
        throw new TodoistValidationError(errorMessage);
      case 429: {
        const retryAfter = parseInt(
          response.headers.get("Retry-After") || "60",
          10,
        );
        throw new TodoistRateLimitError(errorMessage, retryAfter);
      }
      default:
        throw new TodoistApiError(errorMessage, response.status);
    }
  }

  private async execCommands(
    commands: Array<{
      type: string;
      uuid: string;
      temp_id?: string;
      args: Record<string, unknown>;
    }>,
  ): Promise<{ sync_status: Record<string, SyncStatusValue>; temp_id_mapping: Record<string, string> }> {
    const withUuid = commands.map((c) => ({
      ...c,
      uuid: c.uuid || crypto.randomUUID(),
    }));
    const data = await this.sync({ commands: withUuid });
    const sync_status = data.sync_status ?? {};
    const temp_id_mapping = data.temp_id_mapping ?? {};

    for (const cmd of withUuid) {
      const status = sync_status[cmd.uuid];
      if (status !== "ok") {
        if (typeof status === "object" && status !== null) {
          this.throwFromSyncStatus(status);
        }
        throw new TodoistApiError(
          typeof status === "string" ? status : "Command failed",
          400,
        );
      }
    }

    return { sync_status, temp_id_mapping };
  }

  // Projects

  async createProject(
    name: string,
    viewStyle: string = "list",
  ): Promise<TodoistProject> {
    const tempId = crypto.randomUUID();
    const uuid = crypto.randomUUID();
    const { temp_id_mapping } = await this.execCommands([
      {
        type: "project_add",
        uuid,
        temp_id: tempId,
        args: { name, view_style: viewStyle },
      },
    ]);
    const id = temp_id_mapping[tempId];
    if (!id) {
      throw new TodoistApiError("project_add did not return id", 500);
    }
    return TodoistProjectSchema.parse({ id, name, view_style: viewStyle });
  }

  async getProject(projectId: string): Promise<TodoistProject> {
    const data = await this.sync({
      sync_token: "*",
      resource_types: ["projects"],
    });
    const projects = data.projects ?? [];
    const raw = projects.find((p) => String(p.id) === String(projectId));
    if (!raw) {
      throw new TodoistNotFoundError(`Project ${projectId} not found`);
    }
    return TodoistProjectSchema.parse(raw);
  }

  async listProjects(): Promise<TodoistProject[]> {
    const data = await this.sync({
      sync_token: "*",
      resource_types: ["projects"],
    });
    const projects = data.projects ?? [];
    return projects.map((p) => TodoistProjectSchema.parse(p));
  }

  // Sections

  async createSection(
    projectId: string,
    name: string,
    order: number = 0,
  ): Promise<TodoistSection> {
    const tempId = crypto.randomUUID();
    const uuid = crypto.randomUUID();
    const { temp_id_mapping } = await this.execCommands([
      {
        type: "section_add",
        uuid,
        temp_id: tempId,
        args: { project_id: projectId, name, order },
      },
    ]);
    const id = temp_id_mapping[tempId];
    if (!id) {
      throw new TodoistApiError("section_add did not return id", 500);
    }
    return TodoistSectionSchema.parse({
      id,
      project_id: projectId,
      name,
      order,
    });
  }

  async listSections(projectId: string): Promise<TodoistSection[]> {
    const data = await this.sync({
      sync_token: "*",
      resource_types: ["sections"],
    });
    const sections = data.sections ?? [];
    const filtered = sections.filter(
      (s) => String(s.project_id) === String(projectId),
    );
    return filtered.map((s) =>
      TodoistSectionSchema.parse(normalizeSyncSection(s)),
    );
  }

  // Tasks

  async createTask(
    content: string,
    projectId: string,
    sectionId: string,
    description: string = "",
    requestId?: string,
  ): Promise<TodoistTask> {
    const tempId = crypto.randomUUID();
    const uuid = requestId ?? crypto.randomUUID();
    const { temp_id_mapping } = await this.execCommands([
      {
        type: "item_add",
        uuid,
        temp_id: tempId,
        args: {
          content,
          project_id: projectId,
          section_id: sectionId,
          description,
        },
      },
    ]);
    const id = temp_id_mapping[tempId];
    if (!id) {
      throw new TodoistApiError("item_add did not return id", 500);
    }
    return TodoistTaskSchema.parse({
      id,
      content,
      project_id: projectId,
      section_id: sectionId,
      description,
      order: 0,
    });
  }

  async updateTask(
    taskId: string,
    updates: {
      content?: string;
      section_id?: string;
      description?: string;
    },
  ): Promise<TodoistTask> {
    const uuid = crypto.randomUUID();
    await this.execCommands([
      {
        type: "item_update",
        uuid,
        args: { id: taskId, ...updates },
      },
    ]);
    const data = await this.sync({
      sync_token: "*",
      resource_types: ["items"],
    });
    const items = data.items ?? [];
    const raw = items.find((i) => String(i.id) === String(taskId));
    if (!raw) {
      return TodoistTaskSchema.parse({
        id: taskId,
        content: updates.content ?? "",
        project_id: "",
        section_id: updates.section_id ?? "",
        description: updates.description ?? "",
        order: 0,
      });
    }
    return TodoistTaskSchema.parse(normalizeSyncItem(raw));
  }

  async deleteTask(taskId: string): Promise<void> {
    const uuid = crypto.randomUUID();
    await this.execCommands([
      { type: "item_delete", uuid, args: { id: taskId } },
    ]);
  }

  async listTasks(
    projectId: string,
    sectionId?: string,
  ): Promise<TodoistTask[]> {
    const data = await this.sync({
      sync_token: "*",
      resource_types: ["items"],
    });
    const items = data.items ?? [];
    let filtered = items.filter(
      (i) =>
        String(i.project_id) === String(projectId) && !(i as { is_deleted?: boolean }).is_deleted,
    );
    if (sectionId) {
      filtered = filtered.filter(
        (i) => String(i.section_id) === String(sectionId),
      );
    }
    return filtered.map((i) =>
      TodoistTaskSchema.parse(normalizeSyncItem(i)),
    );
  }
}

/** Map Sync API section fields to our TodoistSection shape (child_order → order). */
function normalizeSyncSection(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: raw.id,
    project_id: raw.project_id,
    name: raw.name,
    order: raw.order ?? raw.child_order ?? 0,
  };
}

/** Map Sync API item fields to our TodoistTask shape (child_order → order, section_id default). */
function normalizeSyncItem(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    id: raw.id,
    content: raw.content,
    project_id: raw.project_id,
    section_id: raw.section_id ?? "",
    description: raw.description ?? "",
    order: raw.order ?? raw.child_order ?? 0,
  };
}
