import { assert } from "chai";
import { createAgentLoopRunner } from "../src/modules/contextPanel/agentLoop";
import type {
  AgentContinuationPlan,
  AgentQueryPlan,
} from "../src/modules/contextPanel/agentTypes";
import type { AgentToolExecutionResult } from "../src/modules/contextPanel/agentTools/types";
import type { PaperContextRef } from "../src/modules/contextPanel/types";

describe("agentLoop", function () {
  const retrievedPaper: PaperContextRef = {
    itemId: 1,
    contextItemId: 10,
    title: "Retrieved Paper",
  };
  const activePaper: PaperContextRef = {
    itemId: 2,
    contextItemId: 20,
    title: "Active Paper",
  };
  const selectedPaperA: PaperContextRef = {
    itemId: 3,
    contextItemId: 30,
    title: "Same Title",
    attachmentTitle: "Main PDF",
    firstCreator: "Kim",
    year: "2025",
  };
  const selectedPaperB: PaperContextRef = {
    itemId: 3,
    contextItemId: 31,
    title: "Same Title",
    attachmentTitle: "Supplement PDF",
    firstCreator: "Kim",
    year: "2025",
  };

  function buildInitialPlan(): AgentQueryPlan {
    return {
      action: "library-search",
      searchQuery: "memory",
      maxPapersToRead: 2,
      traceLines: ["Initial planner trace."],
      toolCalls: [
        {
          name: "read_paper_text",
          target: { scope: "retrieved-paper", index: 1 },
        },
      ],
    };
  }

  function buildContinuationPlan(): AgentContinuationPlan {
    return {
      decision: "stop",
      traceLines: ["Continuation planner stopped."],
      toolCalls: [],
    };
  }

  it("runs retrieval and one tool call, then combines context prefixes", async function () {
    const traces: string[] = [];
    const runAgentLoop = createAgentLoopRunner({
      planAgentQuery: async () => buildInitialPlan(),
      resolveAgentContext: async () => ({
        mode: "library-search",
        contextPrefix: "Library prefix",
        paperContexts: [retrievedPaper],
        pinnedPaperContexts: [retrievedPaper],
        statusText: "Searching library (1 match)",
        traceLines: ["Library matched 1 paper."],
      }),
      executeAgentToolCall: async () => ({
        name: "read_paper_text",
        targetLabel: "Retrieved Paper",
        ok: true,
        traceLines: ["Loaded full text for Retrieved Paper."],
        groundingText: "Tool prefix",
        addedPaperContexts: [retrievedPaper],
        estimatedTokens: 500,
        truncated: false,
      }),
      planAgentContinuation: async () => buildContinuationPlan(),
    });

    const result = await runAgentLoop({
      item: { libraryID: 5 } as Zotero.Item,
      question: "read the paper",
      activeContextItem: null,
      conversationMode: "open",
      paperContexts: [],
      pinnedPaperContexts: [],
      recentPaperContexts: [],
      model: "gpt-4o-mini",
      onTrace: (line) => traces.push(line),
    });

    assert.equal(result.conversationMode, "open");
    assert.deepEqual(result.paperContexts, [retrievedPaper]);
    assert.include(result.contextPrefix, "Library prefix");
    assert.include(result.contextPrefix, "Tool prefix");
    assert.include(traces, "Planner selected library-search.");
    assert.include(traces, "Tool call: read_paper_text(retrieved-paper#1).");
    assert.include(traces, "Continuation planner stopped.");
  });

  it("lets the continuation planner request one more tool call", async function () {
    const toolResults: AgentToolExecutionResult[] = [];
    const runAgentLoop = createAgentLoopRunner({
      planAgentQuery: async () => ({
        action: "active-paper",
        maxPapersToRead: 1,
        traceLines: ["Use active paper first."],
        toolCalls: [],
      }),
      resolveAgentContext: async () => null,
      executeAgentToolCall: async ({ call }) => {
        const result: AgentToolExecutionResult = {
          name: "read_paper_text",
          targetLabel: call?.name || "",
          ok: true,
          traceLines: ["Loaded active paper text."],
          groundingText: "Active paper full text",
          addedPaperContexts: [activePaper],
          estimatedTokens: 400,
          truncated: false,
        };
        toolResults.push(result);
        return result;
      },
      planAgentContinuation: async () => ({
        decision: "tool",
        traceLines: ["Continuation planner requested a tool."],
        toolCalls: [
          {
            name: "read_paper_text",
            target: { scope: "active-paper" },
          },
        ],
      }),
    });

    const result = await runAgentLoop({
      item: { libraryID: 5 } as Zotero.Item,
      question: "read active paper",
      activeContextItem: { id: 20 } as Zotero.Item,
      conversationMode: "paper",
      paperContexts: [],
      pinnedPaperContexts: [],
      recentPaperContexts: [],
      model: "gpt-4o-mini",
    });

    assert.lengthOf(toolResults, 1);
    assert.include(result.contextPrefix, "Active paper full text");
  });

  it("recovers from a wrong retrieved-paper target and reads both selected papers", async function () {
    const executedTargets: string[] = [];
    const traces: string[] = [];
    const runAgentLoop = createAgentLoopRunner({
      planAgentQuery: async () => ({
        action: "existing-paper-contexts",
        maxPapersToRead: 2,
        traceLines: ["Use the selected papers."],
        toolCalls: [
          {
            name: "read_paper_text",
            target: { scope: "retrieved-paper", index: 1 },
          },
        ],
      }),
      resolveAgentContext: async () => null,
      executeAgentToolCall: async ({ call }) => {
        const target =
          call?.target && "index" in call.target
            ? `${call.target.scope}#${call.target.index}`
            : call?.target.scope || "unknown";
        executedTargets.push(target);
        if (target === "retrieved-paper#1") {
          return {
            name: "read_paper_text",
            targetLabel: "retrieved-paper#1",
            ok: false,
            traceLines: ["Target was unavailable: retrieved-paper#1."],
            groundingText: "",
            addedPaperContexts: [],
            estimatedTokens: 0,
            truncated: false,
          };
        }
        const paper =
          target === "selected-paper#1" ? selectedPaperA : selectedPaperB;
        return {
          name: "read_paper_text",
          targetLabel: target,
          ok: true,
          traceLines: [`Loaded full text for ${target}.`],
          groundingText: `Tool output for ${target}`,
          addedPaperContexts: [paper],
          estimatedTokens: 400,
          truncated: false,
        };
      },
      planAgentContinuation: async () => ({
        decision: "stop",
        traceLines: ["Continuation planner stopped."],
        toolCalls: [],
      }),
    });

    const result = await runAgentLoop({
      item: { libraryID: 5 } as Zotero.Item,
      question:
        "can you help me read both the papers and tell me what mathematical theories they proposed?",
      activeContextItem: null,
      conversationMode: "open",
      paperContexts: [selectedPaperA, selectedPaperB],
      pinnedPaperContexts: [],
      recentPaperContexts: [],
      model: "gpt-4o-mini",
      onTrace: (line) => traces.push(line),
    });

    assert.deepEqual(executedTargets, [
      "retrieved-paper#1",
      "selected-paper#1",
      "selected-paper#2",
    ]);
    assert.include(
      traces,
      "Using selected-paper#1 from existing paper contexts because the previous tool target was unavailable.",
    );
    assert.include(
      traces,
      "Question asks to read both selected papers, so I will also read selected-paper#2.",
    );
    assert.include(result.contextPrefix, "Tool output for selected-paper#1");
    assert.include(result.contextPrefix, "Tool output for selected-paper#2");
  });

  it("balances tool budget across two selected-paper full-text reads", async function () {
    const toolTokenCaps: number[] = [];
    const runAgentLoop = createAgentLoopRunner({
      planAgentQuery: async () => ({
        action: "existing-paper-contexts",
        maxPapersToRead: 2,
        traceLines: ["Use the selected papers."],
        toolCalls: [
          {
            name: "read_paper_text",
            target: { scope: "selected-paper", index: 1 },
          },
        ],
      }),
      resolveAgentContext: async () => null,
      executeAgentToolCall: async ({ call, ctx, state }) => {
        toolTokenCaps.push(ctx.toolTokenCap || 0);
        const target =
          call?.target && "index" in call.target
            ? `${call.target.scope}#${call.target.index}`
            : call?.target.scope || "unknown";
        const estimatedTokens = target === "selected-paper#1" ? 2200 : 2200;
        state.executedCallKeys.add(`${call?.name}:${target}`);
        state.totalEstimatedTokens += estimatedTokens;
        state.executedCallCount += 1;
        return {
          name: "read_paper_text",
          targetLabel: target,
          ok: true,
          traceLines: [`Loaded full text for ${target}.`],
          groundingText: `Tool output for ${target}`,
          addedPaperContexts: [
            target === "selected-paper#1" ? selectedPaperA : selectedPaperB,
          ],
          estimatedTokens,
          truncated: false,
        };
      },
      planAgentContinuation: async () => ({
        decision: "stop",
        traceLines: [],
        toolCalls: [],
      }),
    });

    const result = await runAgentLoop({
      item: { libraryID: 5 } as Zotero.Item,
      question: "please read both papers and tell me the mathematical theories",
      activeContextItem: null,
      conversationMode: "open",
      paperContexts: [selectedPaperA, selectedPaperB],
      pinnedPaperContexts: [],
      recentPaperContexts: [],
      model: "gpt-4o-mini",
      availableContextBudgetTokens: 4500,
    });

    assert.deepEqual(toolTokenCaps, [2250, 2300]);
    assert.include(result.contextPrefix, "Tool output for selected-paper#1");
    assert.include(result.contextPrefix, "Tool output for selected-paper#2");
  });
});
