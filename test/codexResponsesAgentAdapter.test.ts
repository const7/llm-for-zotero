import { assert } from "chai";
import {
  CodexResponsesAgentAdapter,
  normalizeStepFromPayload,
} from "../src/agent/model/codexResponses";
import type { AgentRuntimeRequest } from "../src/agent/types";

describe("CodexResponsesAgentAdapter", function () {
  const adapter = new CodexResponsesAgentAdapter();

  function makeRequest(
    overrides: Partial<AgentRuntimeRequest> = {},
  ): AgentRuntimeRequest {
    return {
      conversationKey: 1,
      mode: "agent",
      userText: "Test tool use",
      model: "gpt-5.4",
      apiBase: "https://chatgpt.com/backend-api/codex/responses",
      authMode: "codex_auth",
      apiKey: "",
      ...overrides,
    };
  }

  it("supports tool calling for codex auth requests", function () {
    assert.isTrue(adapter.supportsTools(makeRequest()));
  });

  it("extracts tool calls from responses payload output items", function () {
    const step = normalizeStepFromPayload({
      id: "resp_123",
      output: [
        {
          id: "fc_123",
          type: "function_call",
          call_id: "call_123",
          name: "retrieve_paper_evidence",
          arguments: JSON.stringify({
            question: "What does the paper conclude?",
            topK: 3,
          }),
        },
      ],
    });

    assert.equal(step.responseId, "resp_123");
    assert.equal(step.toolCalls.length, 1);
    assert.equal(step.toolCalls[0].id, "call_123");
    assert.equal(step.toolCalls[0].name, "retrieve_paper_evidence");
    assert.deepEqual(step.toolCalls[0].arguments, {
      question: "What does the paper conclude?",
      topK: 3,
    });
  });

  it("extracts final text from message outputs", function () {
    const step = normalizeStepFromPayload({
      id: "resp_456",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Final answer.",
            },
          ],
        },
      ],
    });

    assert.equal(step.responseId, "resp_456");
    assert.equal(step.toolCalls.length, 0);
    assert.equal(step.text, "Final answer.");
  });
});
