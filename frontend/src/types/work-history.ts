// RFC-002 Phase 2: unified work-history / audit feed types.

export type WorkHistoryType = "message" | "manager_prompt" | "dispatch" | "result" | "archive";

export interface WorkHistoryItem {
  type: WorkHistoryType;
  id: string;
  session_id: string | null;
  task_id: string | null;
  command_id: string | null;
  role?: string;
  content?: string | null;
  payload_json?: unknown;
  result_json?: unknown;
  summary?: string | null;
  status?: string | null;
  created_at: string;
}

export interface WorkHistoryResponse {
  total: number;
  limit: number;
  offset: number;
  items: WorkHistoryItem[];
}
