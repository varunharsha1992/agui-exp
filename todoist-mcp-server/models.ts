import { z } from "zod";

// Todoist API data types

export const TodoistProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  view_style: z.string().default("list"),
});
export type TodoistProject = z.infer<typeof TodoistProjectSchema>;

export const TodoistSectionSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  order: z.number().default(0),
});
export type TodoistSection = z.infer<typeof TodoistSectionSchema>;

export const TodoistTaskSchema = z.object({
  id: z.string(),
  content: z.string(),
  project_id: z.string(),
  section_id: z.string(),
  description: z.string().default(""),
  order: z.number().default(0),
});
export type TodoistTask = z.infer<typeof TodoistTaskSchema>;

// Snapshot types (planner → Todoist)

export const SnapshotTaskSchema = z.object({
  planner_id: z.string(),
  title: z.string(),
  type: z.enum(["fixed", "flexible"]),
  source: z.enum(["calendar", "email", "user"]).optional(),
  duration: z.string().optional(),
  order: z.number(),
});
export type SnapshotTask = z.infer<typeof SnapshotTaskSchema>;

export const DaySnapshotSchema = z.object({
  day: z.enum(["today", "tomorrow", "next"]),
  label: z.string(),
  tasks: z.array(SnapshotTaskSchema),
});
export type DaySnapshot = z.infer<typeof DaySnapshotSchema>;

export const PlanSnapshotSchema = z.object({
  days: z.object({
    today: DaySnapshotSchema,
    tomorrow: DaySnapshotSchema,
    next: DaySnapshotSchema,
  }),
});
export type PlanSnapshot = z.infer<typeof PlanSnapshotSchema>;

// Change types (editor → Todoist)

export const ChangeActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_title"),
    task_id: z.string(),
    new_content: z.string(),
  }),
  z.object({
    action: z.literal("move_section"),
    task_id: z.string(),
    new_section_id: z.string(),
  }),
  z.object({
    action: z.literal("reorder"),
    task_id: z.string(),
    new_order: z.array(z.string()),
  }),
]);
export type ChangeAction = z.infer<typeof ChangeActionSchema>;
