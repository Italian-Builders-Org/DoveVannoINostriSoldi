import { ATTACHMENT_MAX_FILES } from "@/lib/assistant/attachment-contracts";

export type AiActivity = { id: "attachments" | "planning" | "query-0" | "query-1" | "answer"; label: string; status: "running" | "done"; resources?: string[] };
export function isAiActivity(value: unknown): value is AiActivity {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["attachments", "planning", "query-0", "query-1", "answer"].includes(String(item.id)) && typeof item.label === "string" && item.label.length <= 200 && ["running", "done"].includes(String(item.status)) && (item.resources === undefined || Array.isArray(item.resources) && item.resources.length <= ATTACHMENT_MAX_FILES && item.resources.every((entry) => typeof entry === "string" && entry.length <= 200));
}
