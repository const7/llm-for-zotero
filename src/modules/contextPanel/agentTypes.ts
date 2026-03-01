import type { AgentToolCall } from "./agentTools/types";

export type AgentPlannerAction =
  | "skip"
  | "active-paper"
  | "existing-paper-contexts"
  | "library-overview"
  | "library-search";

export type AgentQueryPlan = {
  action: AgentPlannerAction;
  searchQuery?: string;
  maxPapersToRead: number;
  traceLines: string[];
  toolCalls: AgentToolCall[];
};

export type AgentContinuationDecision = "stop" | "tool";

export type AgentContinuationPlan = {
  decision: AgentContinuationDecision;
  traceLines: string[];
  toolCalls: AgentToolCall[];
};
