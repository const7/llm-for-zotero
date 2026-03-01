import { getAgentToolDefinition } from "./registry";
import { resolveAgentToolTarget } from "./resolveTarget";
import type {
  AgentToolCall,
  AgentToolExecutionContext,
  AgentToolExecutionResult,
  AgentToolExecutorState,
} from "./types";

export const MAX_AGENT_TOOL_CALLS = 2;

export function createAgentToolExecutorState(): AgentToolExecutorState {
  return {
    executedCallKeys: new Set<string>(),
    totalEstimatedTokens: 0,
    executedCallCount: 0,
  };
}

function buildSkipResult(
  call: AgentToolCall,
  targetLabel: string,
  message: string,
): AgentToolExecutionResult {
  return {
    name: call.name,
    targetLabel,
    ok: false,
    traceLines: [message],
    groundingText: "",
    addedPaperContexts: [],
    estimatedTokens: 0,
    truncated: false,
  };
}

export async function executeAgentToolCall(params: {
  call?: AgentToolCall | null;
  ctx: AgentToolExecutionContext;
  state: AgentToolExecutorState;
}): Promise<AgentToolExecutionResult | null> {
  if (!params.call) return null;
  const definition = getAgentToolDefinition(params.call.name);
  if (!definition) {
    return buildSkipResult(
      params.call,
      params.call.name,
      `Unknown tool call was ignored: ${params.call.name}.`,
    );
  }

  const validatedCall = definition.validate(params.call);
  if (!validatedCall) {
    return buildSkipResult(
      params.call,
      params.call.name,
      `Malformed tool call was ignored: ${params.call.name}.`,
    );
  }

  if (params.state.executedCallCount >= MAX_AGENT_TOOL_CALLS) {
    return buildSkipResult(
      validatedCall,
      validatedCall.name,
      "Tool call limit reached; additional tool use was skipped.",
    );
  }

  const resolvedTarget = resolveAgentToolTarget(params.ctx, validatedCall.target);
  if (!resolvedTarget.paperContext) {
    return buildSkipResult(
      validatedCall,
      resolvedTarget.targetLabel,
      resolvedTarget.error || `Tool target was unavailable: ${resolvedTarget.targetLabel}.`,
    );
  }

  const callKey = `${validatedCall.name}:${resolvedTarget.resolvedKey || resolvedTarget.targetLabel}`;
  if (params.state.executedCallKeys.has(callKey)) {
    return buildSkipResult(
      validatedCall,
      resolvedTarget.targetLabel,
      `Duplicate tool call was ignored: ${validatedCall.name}(${resolvedTarget.targetLabel}).`,
    );
  }

  const result = await definition.execute(params.ctx, validatedCall, resolvedTarget);
  if (!result.ok) return result;

  params.state.executedCallKeys.add(callKey);
  params.state.totalEstimatedTokens += result.estimatedTokens;
  params.state.executedCallCount += 1;
  return result;
}
