// MWT-4A — Task Evidence Projection types (frontend-only, read-only).
import type { GatewayEvent } from "@/lib/api";

export interface TaskEvidenceSummary {
  event_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost: number | null;
  control: {
    allow: number;
    deny: number;
    unknown: number;
  };
}

export interface TaskEvidenceState {
  loading: boolean;
  error: string | null;
  events: GatewayEvent[];
  summary: TaskEvidenceSummary;
}
