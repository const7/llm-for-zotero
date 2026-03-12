import type {
  AgentToolCall,
  AgentToolContext,
  AgentToolResult,
  PreparedToolExecution,
} from "../types";
import type { ActionExecutionContext } from "./types";

let _callCounter = 0;
function nextCallId(): string {
  return `action-call-${Date.now()}-${++_callCounter}`;
}

/**
 * Creates a minimal AgentToolContext for invoking a tool directly from an action.
 * Actions don't have a real user request, so we synthesise one.
 */
function buildToolContext(
  ctx: ActionExecutionContext,
  stepDescription: string,
): AgentToolContext {
  return {
    // Actions run outside an agent turn, so we build a synthetic request.
    request: {
      conversationKey: 0,
      mode: "agent",
      userText: stepDescription,
      libraryID: ctx.libraryID,
    },
    item: null,
    currentAnswerText: "",
    modelName: "action",
  };
}

/**
 * Executes a single tool call from within an action step.
 *
 * - Calls `registry.prepareExecution()` to validate input and check confirmation.
 * - If the tool returns a direct result, returns it immediately.
 * - If the tool requires confirmation, routes based on `ctx.confirmationMode`:
 *   - `"auto_approve"` — calls `execute()` without asking the user.
 *   - `"native_ui"` — emits a `confirmation_required` progress event and awaits
 *     the caller's `requestConfirmation()` to get the user's resolution.
 *   - `"mcp_response"` — same as native_ui; the MCP server handles the pause.
 */
export async function callTool(
  toolName: string,
  args: unknown,
  ctx: ActionExecutionContext,
  stepDescription = "",
): Promise<AgentToolResult> {
  const call: AgentToolCall = {
    id: nextCallId(),
    name: toolName,
    arguments: args,
  };
  const toolContext = buildToolContext(ctx, stepDescription || toolName);
  const prepared: PreparedToolExecution = await ctx.registry.prepareExecution(
    call,
    toolContext,
  );

  if (prepared.kind === "result") {
    return prepared.execution.result;
  }

  // Confirmation required
  if (ctx.confirmationMode === "auto_approve") {
    const execution = await prepared.execute(undefined);
    return execution.result;
  }

  // native_ui or mcp_response: surface the confirmation card to the caller
  ctx.onProgress({
    type: "confirmation_required",
    requestId: prepared.requestId,
    action: prepared.action,
  });

  const resolution = await ctx.requestConfirmation(prepared.requestId, prepared.action);

  if (!resolution.approved) {
    return prepared.deny(resolution.data).result;
  }

  const execution = await prepared.execute(resolution.data);
  return execution.result;
}
