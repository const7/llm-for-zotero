import { assert } from "chai";
import {
  buildFallbackAgentContinuationPlan,
  buildFallbackAgentQueryPlan,
  findAgentPlanJsonObject,
  parseAgentContinuationPlan,
  parseAgentQueryPlan,
} from "../src/modules/contextPanel/agentPlanner";
import type {
  AgentContinuationPlan,
  AgentQueryPlan,
} from "../src/modules/contextPanel/agentTypes";

describe("agentPlanner", function () {
  const fallback: AgentQueryPlan = {
    action: "skip",
    maxPapersToRead: 1,
    traceLines: ["fallback"],
    toolCalls: [],
  };
  const continuationFallback: AgentContinuationPlan = {
    decision: "stop",
    traceLines: ["stop"],
    toolCalls: [],
  };

  it("extracts the first JSON object from model output", function () {
    const raw =
      'Here is the plan:\n{"action":"library-search","searchQuery":"graph memory","maxPapersToRead":4,"traceLines":["Search the library."]}\nDone.';
    const jsonText = findAgentPlanJsonObject(raw);
    assert.include(jsonText, '"action":"library-search"');
  });

  it("parses and normalizes a planner JSON response", function () {
    const plan = parseAgentQueryPlan(
      JSON.stringify({
        action: "library-search",
        searchQuery: "graph memory",
        maxPapersToRead: 99,
        traceLines: ["Search the library for relevant papers."],
        toolCalls: [
          {
            name: "read_paper_text",
            target: { scope: "retrieved-paper", index: 1 },
          },
          {
            name: "read_paper_text",
            target: { scope: "retrieved-paper", index: 2 },
          },
        ],
      }),
      fallback,
    );
    assert.equal(plan.action, "library-search");
    assert.equal(plan.searchQuery, "graph memory");
    assert.equal(plan.maxPapersToRead, 99);
    assert.deepEqual(plan.traceLines, [
      "Search the library for relevant papers.",
    ]);
    assert.deepEqual(plan.toolCalls, [
      {
        name: "read_paper_text",
        target: { scope: "retrieved-paper", index: 1 },
      },
    ]);
  });

  it("falls back on invalid planner JSON", function () {
    const plan = parseAgentQueryPlan("{not-json", fallback);
    assert.deepEqual(plan, fallback);
  });

  it("drops malformed tool calls from planner output", function () {
    const plan = parseAgentQueryPlan(
      JSON.stringify({
        action: "active-paper",
        maxPapersToRead: 1,
        traceLines: ["Use active paper."],
        toolCalls: [
          {
            name: "read_paper_text",
            target: { scope: "retrieved-paper", index: 0 },
          },
          {
            name: "unknown_tool",
            target: { scope: "active-paper" },
          },
        ],
      }),
      fallback,
    );
    assert.deepEqual(plan.toolCalls, []);
  });

  it("builds a whole-library fallback plan for overview queries", function () {
    const plan = buildFallbackAgentQueryPlan({
      question: "read the whole library to me",
      conversationMode: "open",
      libraryID: 5,
      model: "gpt-4o-mini",
      paperContexts: [],
      pinnedPaperContexts: [],
      recentPaperContexts: [],
    });
    assert.equal(plan.action, "library-overview");
    assert.deepEqual(plan.toolCalls, []);
  });

  it("builds an existing-paper fallback when papers are already present", function () {
    const plan = buildFallbackAgentQueryPlan({
      question: "compare these papers",
      conversationMode: "open",
      libraryID: 5,
      model: "gpt-4o-mini",
      paperContexts: [
        {
          itemId: 1,
          contextItemId: 2,
          title: "Paper A",
        },
      ],
      pinnedPaperContexts: [],
      recentPaperContexts: [],
    });
    assert.equal(plan.action, "existing-paper-contexts");
  });

  it("parses and normalizes a continuation JSON response", function () {
    const plan = parseAgentContinuationPlan(
      JSON.stringify({
        decision: "tool",
        traceLines: ["Read the top retrieved paper before answering."],
        toolCalls: [
          {
            name: "read_paper_text",
            target: { scope: "retrieved-paper", index: 1 },
          },
          {
            name: "read_paper_text",
            target: { scope: "retrieved-paper", index: 2 },
          },
        ],
      }),
      continuationFallback,
    );
    assert.equal(plan.decision, "tool");
    assert.deepEqual(plan.toolCalls, [
      {
        name: "read_paper_text",
        target: { scope: "retrieved-paper", index: 1 },
      },
    ]);
  });

  it("falls back to stop on invalid continuation plans", function () {
    const invalid = parseAgentContinuationPlan(
      JSON.stringify({
        decision: "tool",
        traceLines: ["Keep going."],
        toolCalls: [{ name: "read_paper_text", target: { scope: "recent-paper" } }],
      }),
      continuationFallback,
    );
    assert.deepEqual(invalid, continuationFallback);
    assert.deepEqual(buildFallbackAgentContinuationPlan(), {
      decision: "stop",
      traceLines: ["Current grounding looks sufficient, so I will stop tool use."],
      toolCalls: [],
    });
  });
});
