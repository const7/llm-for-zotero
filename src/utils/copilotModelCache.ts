/**
 * In-memory cache of Copilot model endpoint support.
 * Maps model ID → supported endpoint paths (e.g. ["/chat/completions", "/responses"]).
 * Populated by fetchCopilotModelList() in llmClient.ts.
 */

const copilotModelEndpoints = new Map<string, string[]>();

export function setCopilotModelEndpoints(
  modelId: string,
  endpoints: string[],
): void {
  copilotModelEndpoints.set(modelId.trim(), endpoints);
}

/**
 * Resolve the best Copilot protocol for a given model.
 * Returns "responses_api" or "openai_chat_compat" based on what the model supports.
 * Falls back to the provided default if the model is not in the cache.
 */
export function resolveCopilotProtocolForModel(
  model: string,
  fallback: "responses_api" | "openai_chat_compat" = "responses_api",
): "responses_api" | "openai_chat_compat" {
  const endpoints = copilotModelEndpoints.get(model.trim());
  if (!endpoints) return fallback;
  const hasChat = endpoints.includes("/chat/completions");
  const hasResponses = endpoints.includes("/responses");
  if (hasResponses && hasChat) return fallback;
  if (hasResponses) return "responses_api";
  if (hasChat) return "openai_chat_compat";
  return fallback;
}
