import {
  API_ENDPOINT,
  RESPONSES_ENDPOINT,
  buildHeaders,
  resolveEndpoint,
} from "./apiHelpers";
import type { ProviderProtocol } from "./providerProtocol";

const ANTHROPIC_VERSION = "2023-06-01";

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function normalizeAnthropicMessagesBase(apiBase: string): string {
  const cleaned = trimTrailingSlash(apiBase);
  if (!cleaned) return "";
  return cleaned.replace(/\/messages$/i, "");
}

export function resolveAnthropicMessagesEndpoint(apiBase: string): string {
  const cleaned = normalizeAnthropicMessagesBase(apiBase);
  if (!cleaned) return "";
  if (/\/v\d+(?:beta)?$/i.test(cleaned)) {
    return `${cleaned}/messages`;
  }
  return `${cleaned}/v1/messages`;
}

export function normalizeGeminiNativeBase(apiBase: string): string {
  const cleaned = trimTrailingSlash(apiBase);
  if (!cleaned) return "";
  let normalized = cleaned;
  normalized = normalized.replace(
    /\/v\d+(?:beta)?\/openai(?:\/(?:chat\/completions|responses|files))?$/i,
    "/v1beta",
  );
  normalized = normalized.replace(
    /\/models\/[^/]+:(?:generateContent|streamGenerateContent)(?:\?.*)?$/i,
    "",
  );
  if (!/\/v\d+(?:beta)?\b/i.test(normalized)) {
    normalized = `${normalized}/v1beta`;
  }
  return normalized;
}

export function resolveGeminiNativeEndpoint(params: {
  apiBase: string;
  model: string;
  stream?: boolean;
}): string {
  const base = normalizeGeminiNativeBase(params.apiBase);
  if (!base) return "";
  const modelName = encodeURIComponent((params.model || "").trim());
  const action = params.stream ? "streamGenerateContent?alt=sse" : "generateContent";
  return `${base}/models/${modelName}:${action}`;
}

export function resolveProviderTransportEndpoint(params: {
  protocol: ProviderProtocol;
  apiBase: string;
  model?: string;
  stream?: boolean;
}): string {
  if (params.protocol === "codex_responses" || params.protocol === "responses_api") {
    return resolveEndpoint(params.apiBase, RESPONSES_ENDPOINT);
  }
  if (params.protocol === "openai_chat_compat") {
    return resolveEndpoint(params.apiBase, API_ENDPOINT);
  }
  if (params.protocol === "anthropic_messages") {
    return resolveAnthropicMessagesEndpoint(params.apiBase);
  }
  return resolveGeminiNativeEndpoint({
    apiBase: params.apiBase,
    model: params.model || "",
    stream: params.stream,
  });
}

export function buildProviderTransportHeaders(params: {
  protocol: ProviderProtocol;
  apiKey: string;
}): Record<string, string> {
  if (
    params.protocol === "codex_responses" ||
    params.protocol === "responses_api" ||
    params.protocol === "openai_chat_compat"
  ) {
    return buildHeaders(params.apiKey);
  }
  if (params.protocol === "anthropic_messages") {
    return {
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    };
  }
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": params.apiKey,
  };
}
