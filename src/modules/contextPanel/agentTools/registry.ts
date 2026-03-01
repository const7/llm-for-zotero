import type {
  AgentToolCall,
  AgentToolExecutionContext,
  AgentToolExecutionResult,
  AgentToolName,
  ResolvedAgentToolTarget,
} from "./types";
import {
  executeReadPaperTextCall,
  validateReadPaperTextCall,
} from "./tools/readPaperText";

export type AgentToolDefinition = {
  name: AgentToolName;
  plannerDescription: string;
  validate(call: AgentToolCall): AgentToolCall | null;
  execute(
    ctx: AgentToolExecutionContext,
    call: AgentToolCall,
    target: ResolvedAgentToolTarget,
  ): Promise<AgentToolExecutionResult>;
};

const AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: "read_paper_text",
    plannerDescription:
      "read the full body text of one specific paper after the target paper has been identified; use sparingly because it is expensive",
    validate: validateReadPaperTextCall,
    execute: executeReadPaperTextCall,
  },
];

export function getAgentToolDefinitions(): readonly AgentToolDefinition[] {
  return AGENT_TOOL_DEFINITIONS;
}

export function getAgentToolDefinition(
  name: AgentToolName,
): AgentToolDefinition | null {
  return AGENT_TOOL_DEFINITIONS.find((definition) => definition.name === name) || null;
}
