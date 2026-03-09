import { API_ENDPOINT, resolveEndpoint, usesMaxCompletionTokens } from "../../utils/apiHelpers";
import { normalizeMaxTokens, normalizeTemperature } from "../../utils/normalization";
import type {
  AgentModelCapabilities,
  AgentModelMessage,
  AgentModelStep,
  AgentRuntimeRequest,
  AgentToolCall,
  ToolSpec,
} from "../types";
import type { AgentModelAdapter, AgentStepParams } from "./adapter";

type ChatCompletionChoice = {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
  };
};

function getFetch(): typeof fetch {
  return ztoolkit.getGlobal("fetch") as typeof fetch;
}

function isToolCapableApiBase(request: AgentRuntimeRequest): boolean {
  const apiBase = (request.apiBase || "").trim();
  if (!apiBase) return false;
  if (request.authMode === "codex_auth") return false;
  const endpoint = resolveEndpoint(apiBase, API_ENDPOINT);
  if (!endpoint) return false;
  if (/chatgpt\.com\/backend-api\/codex\/responses/i.test(endpoint)) {
    return false;
  }
  return true;
}

function isMultimodalRequestSupported(request: AgentRuntimeRequest): boolean {
  const model = (request.model || "").trim().toLowerCase();
  if (!model) return true;
  return !(
    model.includes("reasoner") ||
    model.includes("text-only") ||
    model.includes("embedding")
  );
}

function buildUserMessage(request: AgentRuntimeRequest): AgentModelMessage {
  const contextLines: string[] = [
    "Current Zotero context summary:",
    `- Conversation key: ${request.conversationKey}`,
  ];
  if (Array.isArray(request.selectedTexts) && request.selectedTexts.length) {
    const selectedTextBlock = request.selectedTexts
      .map((entry, index) => `Selected text ${index + 1}:\n"""\n${entry}\n"""`)
      .join("\n\n");
    contextLines.push(selectedTextBlock);
  }
  if (Array.isArray(request.selectedPaperContexts) && request.selectedPaperContexts.length) {
    const paperLines = request.selectedPaperContexts.map(
      (entry, index) =>
        `- Selected paper ${index + 1}: ${entry.title} [itemId=${entry.itemId}, contextItemId=${entry.contextItemId}]`,
    );
    contextLines.push("Selected paper refs:", ...paperLines);
  }
  if (Array.isArray(request.pinnedPaperContexts) && request.pinnedPaperContexts.length) {
    const paperLines = request.pinnedPaperContexts.map(
      (entry, index) =>
        `- Pinned paper ${index + 1}: ${entry.title} [itemId=${entry.itemId}, contextItemId=${entry.contextItemId}]`,
    );
    contextLines.push("Pinned paper refs:", ...paperLines);
  }
  if (Array.isArray(request.attachments) && request.attachments.length) {
    contextLines.push(
      "Current uploaded attachments are available through the read_attachment_text tool.",
    );
  }

  const promptText = `${contextLines.join("\n")}\n\nUser request:\n${request.userText}`;
  const screenshots = Array.isArray(request.screenshots)
    ? request.screenshots.filter((entry) => Boolean(entry))
    : [];
  if (!screenshots.length || !isMultimodalRequestSupported(request)) {
    return {
      role: "user",
      content: promptText,
    };
  }
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: promptText,
      },
      ...screenshots.map((url) => ({
        type: "image_url" as const,
        image_url: {
          url,
        },
      })),
    ],
  };
}

function stringifyContent(content: AgentModelMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : "[image]"))
    .join("\n");
}

function normalizeHistoryMessages(
  request: AgentRuntimeRequest,
): AgentModelMessage[] {
  const history = Array.isArray(request.history) ? request.history.slice(-8) : [];
  return history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: stringifyContent(message.content as string),
    }));
}

function buildMessages(request: AgentRuntimeRequest): AgentModelMessage[] {
  const systemPrompt = [
    (request.systemPrompt || "").trim(),
    "You are the agent runtime inside a Zotero plugin.",
    "Use tools for paper/library/document operations instead of claiming hidden access.",
    "If a write action is needed, call the write tool and wait for confirmation.",
    "When enough evidence has been collected, answer clearly and concisely.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const messages: AgentModelMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    ...normalizeHistoryMessages(request),
    buildUserMessage(request),
  ];
  return messages;
}

function buildTools(tools: ToolSpec[]): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function buildMessagesPayload(messages: AgentModelMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
        tool_call_id: message.tool_call_id,
        name: message.name,
      };
    }
    return {
      role: message.role,
      content: message.content,
      ...(message.role === "assistant" &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.length
        ? {
            tool_calls: message.tool_calls.map((call: AgentToolCall) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments ?? {}),
              },
            })),
          }
        : {}),
    };
  });
}

function parseToolCallArguments(raw: string | undefined): unknown {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return { raw };
  }
}

function normalizeToolCalls(
  toolCalls:
    | Array<{
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>
    | undefined,
): AgentToolCall[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((call, index) => {
      const name = call?.function?.name?.trim();
      if (!name) return null;
      return {
        id: call?.id?.trim() || `tool-${Date.now()}-${index}`,
        name,
        arguments: parseToolCallArguments(call?.function?.arguments),
      };
    })
    .filter((call): call is AgentToolCall => Boolean(call));
}

export class OpenAICompatibleAgentAdapter implements AgentModelAdapter {
  getCapabilities(request: AgentRuntimeRequest): AgentModelCapabilities {
    return {
      streaming: false,
      toolCalls: isToolCapableApiBase(request),
      multimodal: isMultimodalRequestSupported(request),
    };
  }

  supportsTools(request: AgentRuntimeRequest): boolean {
    return this.getCapabilities(request).toolCalls;
  }

  async runStep(params: AgentStepParams): Promise<AgentModelStep> {
    const payload = {
      model: params.request.model,
      messages: buildMessagesPayload(params.messages),
      tools: buildTools(params.tools),
      tool_choice: "auto",
      ...(usesMaxCompletionTokens(params.request.model || "")
        ? {
            max_completion_tokens: normalizeMaxTokens(
              params.request.advanced?.maxTokens,
            ),
          }
        : {
            max_tokens: normalizeMaxTokens(params.request.advanced?.maxTokens),
          }),
      temperature: normalizeTemperature(params.request.advanced?.temperature),
    };
    const url = resolveEndpoint(params.request.apiBase || "", API_ENDPOINT);
    const response = await getFetch()(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.request.apiKey
          ? { Authorization: `Bearer ${params.request.apiKey}` }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: params.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${response.status} ${response.statusText} - ${errorText}`,
      );
    }
    const data = (await response.json()) as { choices?: ChatCompletionChoice[] };
    const message = data.choices?.[0]?.message;
    const toolCalls = normalizeToolCalls(message?.tool_calls);
    if (toolCalls.length) {
      return {
        kind: "tool_calls",
        calls: toolCalls,
        assistantMessage: {
          role: "assistant",
          content: typeof message?.content === "string" ? message.content : "",
          tool_calls: toolCalls,
        },
      };
    }
    return {
      kind: "final",
      text: typeof message?.content === "string" ? message.content : "",
      assistantMessage: {
        role: "assistant",
        content: typeof message?.content === "string" ? message.content : "",
      },
    };
  }

  buildInitialMessages(request: AgentRuntimeRequest): AgentModelMessage[] {
    return buildMessages(request);
  }
}
