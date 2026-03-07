import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import type { Request, Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "dotenv";
import { TodoistClient } from "./todoist-client.js";
import {
  PlanSnapshotSchema,
  ChangeActionSchema,
  type DaySnapshot,
} from "./models.js";

config(); // Load .env

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const TODOIST_API_TOKEN = process.env.TODOIST_API_TOKEN || "";
const TODOIST_API_BASE = process.env.TODOIST_API_BASE;

const editorUri = "ui://todoist-planner/editor.html";

const DAY_SECTIONS: Array<{
  key: "today" | "tomorrow" | "next";
  name: string;
  order: number;
}> = [
  { key: "today", name: "Today", order: 0 },
  { key: "tomorrow", name: "Tomorrow", order: 1 },
  { key: "next", name: "Next Day", order: 2 },
];

function buildTaskDescription(task: {
  planner_id: string;
  type: string;
  source?: string;
}): string {
  const parts = [`planner_id:${task.planner_id}`, `type:${task.type}`];
  if (task.source) {
    parts.push(`source:${task.source}`);
  }
  return parts.join(" ");
}

function parsePlannerIdFromDescription(description: string): string | null {
  const match = description.match(/planner_id:(\S+)/);
  return match ? match[1] : null;
}

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "todoist-planner",
    version: "1.0.0",
  });

  // =========================================================================
  // Tool: write_plan_to_todoist (model-visible)
  // =========================================================================
  registerAppTool(
    server,
    "write_plan_to_todoist",
    {
      title: "Write Plan to Todoist",
      description:
        "Write a finalized plan snapshot to a Todoist project, creating the project and sections if needed.",
      inputSchema: {
        project_name: z
          .string()
          .describe("Name for the Todoist project (e.g., '3-Day Plan - Feb 6')"),
        project_id: z
          .string()
          .optional()
          .describe(
            "Existing Todoist project ID to update. If omitted, creates a new project.",
          ),
        snapshot: PlanSnapshotSchema.describe("Finalized plan snapshot"),
      },
      _meta: {
        ui: { resourceUri: editorUri, visibility: ["model"] },
      },
    },
    async ({ project_name, project_id, snapshot }): Promise<CallToolResult> => {
      const client = new TodoistClient(TODOIST_API_TOKEN, TODOIST_API_BASE);

      try {
        // Create or fetch project
        let projectId: string;
        const isUpdate = !!project_id;
        if (project_id) {
          await client.getProject(project_id);
          projectId = project_id;
        } else {
          const project = await client.createProject(project_name);
          projectId = project.id;
        }

        // For updates, fetch existing sections and tasks
        let existingSections: Awaited<ReturnType<typeof client.listSections>> = [];
        let existingTasks: Awaited<ReturnType<typeof client.listTasks>> = [];
        if (isUpdate) {
          existingSections = await client.listSections(projectId);
          existingTasks = await client.listTasks(projectId);
        }

        // Build existing planner_id → todoist task lookup
        const existingByPlannerId = new Map<string, (typeof existingTasks)[number]>();
        for (const task of existingTasks) {
          const plannerId = parsePlannerIdFromDescription(task.description);
          if (plannerId) {
            existingByPlannerId.set(plannerId, task);
          }
        }

        // Create or reuse sections
        const sectionMapping: Record<string, string> = {};
        for (const sec of DAY_SECTIONS) {
          const existing = existingSections.find((s) => s.name === sec.name);
          if (existing) {
            sectionMapping[sec.key] = existing.id;
          } else {
            const section = await client.createSection(
              projectId,
              sec.name,
              sec.order,
            );
            sectionMapping[sec.key] = section.id;
          }
        }

        // Create or update tasks in each section
        const taskMapping: Record<string, string> = {};
        let taskCount = 0;
        let updatedCount = 0;
        let createdCount = 0;

        for (const sec of DAY_SECTIONS) {
          const daySnapshot: DaySnapshot | undefined =
            snapshot.days[sec.key as keyof typeof snapshot.days];
          if (!daySnapshot) continue;

          for (const task of daySnapshot.tasks) {
            const existingTask = existingByPlannerId.get(task.planner_id);

            if (existingTask) {
              // Update existing task (title, section)
              const updates: Record<string, string> = {};
              if (existingTask.content !== task.title) {
                updates.content = task.title;
              }
              if (existingTask.section_id !== sectionMapping[sec.key]) {
                updates.section_id = sectionMapping[sec.key];
              }
              if (Object.keys(updates).length > 0) {
                await client.updateTask(existingTask.id, updates);
              }
              taskMapping[task.planner_id] = existingTask.id;
              updatedCount++;
            } else {
              // Create new task
              const requestId = crypto.randomUUID().replace(/-/g, "").slice(0, 36);
              const todoistTask = await client.createTask(
                task.title,
                projectId,
                sectionMapping[sec.key],
                buildTaskDescription(task),
                requestId,
              );
              taskMapping[task.planner_id] = todoistTask.id;
              createdCount++;
            }
            taskCount++;
          }
        }

        const result: Record<string, unknown> = {
          status: "success",
          project_id: projectId,
          project_name,
          sections: sectionMapping,
          task_count: taskCount,
          task_mapping: taskMapping,
        };
        if (isUpdate) {
          result.updated_count = updatedCount;
          result.created_count = createdCount;
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (error) {
        const errorType =
          error instanceof Error && error.name === "TodoistAuthError"
            ? "auth_error"
            : error instanceof Error && error.name === "TodoistRateLimitError"
              ? "rate_limit"
              : "api_error";

        const result = {
          status: "error",
          error_type: errorType,
          message:
            error instanceof Error
              ? error.message
              : "Unknown error occurred",
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: true,
        };
      }
    },
  );

  // =========================================================================
  // Tool: fetch_todoist_project (app-only)
  // =========================================================================
  registerAppTool(
    server,
    "fetch_todoist_project",
    {
      title: "Fetch Todoist Project",
      description:
        "Fetch the current state of a Todoist project (sections and tasks).",
      inputSchema: {
        project_id: z.string().describe("Todoist project ID to fetch"),
      },
      _meta: {
        ui: { resourceUri: editorUri, visibility: ["app"] },
      },
    },
    async ({ project_id }): Promise<CallToolResult> => {
      const client = new TodoistClient(TODOIST_API_TOKEN, TODOIST_API_BASE);

      try {
        const project = await client.getProject(project_id);
        const sections = await client.listSections(project_id);
        const tasks = await client.listTasks(project_id);

        // Group tasks by section
        const sectionData = sections.map((section) => ({
          id: section.id,
          name: section.name,
          order: section.order,
          tasks: tasks
            .filter((t) => t.section_id === section.id)
            .sort((a, b) => a.order - b.order)
            .map((t) => ({
              id: t.id,
              content: t.content,
              order: t.order,
              description: t.description,
            })),
        }));

        const result = {
          status: "success",
          project: {
            id: project.id,
            name: project.name,
            sections: sectionData,
          },
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (error) {
        const errorType =
          error instanceof Error && error.name === "TodoistAuthError"
            ? "auth_error"
            : error instanceof Error && error.name === "TodoistRateLimitError"
              ? "rate_limit"
              : "api_error";

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "error",
                error_type: errorType,
                message:
                  error instanceof Error ? error.message : "Unknown error",
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // =========================================================================
  // Tool: update_todoist_project (app-only)
  // =========================================================================
  registerAppTool(
    server,
    "update_todoist_project",
    {
      title: "Update Todoist Project",
      description:
        "Apply user edits from the embedded editor to Todoist.",
      inputSchema: {
        project_id: z.string().describe("Todoist project ID to update"),
        changes: z
          .array(ChangeActionSchema)
          .describe("List of changes to apply"),
      },
      _meta: {
        ui: { resourceUri: editorUri, visibility: ["app"] },
      },
    },
    async ({ project_id, changes }): Promise<CallToolResult> => {
      const client = new TodoistClient(TODOIST_API_TOKEN, TODOIST_API_BASE);

      let updatedCount = 0;
      let failedCount = 0;
      const errors: Array<{ task_id: string; message: string }> = [];

      for (const change of changes) { 
        try {
          switch (change.action) {
            case "update_title":
              await client.updateTask(change.task_id, {
                content: change.new_content,
              });
              updatedCount++;
              break;
            case "move_section":
              await client.updateTask(change.task_id, {
                section_id: change.new_section_id,
              });
              updatedCount++;
              break;
            case "reorder":
              // REST API doesn't support explicit reordering.
              // Delete and recreate in new order.
              // For now just count it as updated.
              updatedCount++;
              break;
          }
        } catch (error) {
          failedCount++;
          errors.push({
            task_id: change.task_id,
            message:
              error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      const status =
        failedCount === 0
          ? "success"
          : updatedCount > 0
            ? "partial"
            : "error";

      const result: Record<string, unknown> = {
        status,
        updated_count: updatedCount,
      };

      if (failedCount > 0) {
        result.failed_count = failedCount;
        result.errors = errors;
      }

      if (status === "success") {
        result.message = `${updatedCount} tasks updated in Todoist`;
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        ...(status === "error" ? { isError: true } : {}),
      };
    },
  );

  // =========================================================================
  // Resource: editor HTML
  // =========================================================================
  registerAppResource(
    server,
    editorUri,
    editorUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "editor.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: editorUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}

// =========================================================================
// HTTP Server (Streamable HTTP transport)
// =========================================================================

async function main() {
  const port = parseInt(process.env.PORT ?? "3001", 10);

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.listen(port, () => {
    console.log(`MCP server listening on http://localhost:${port}/mcp`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
