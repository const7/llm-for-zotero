import { assert } from "chai";
import {
  buildAgentTraceDisplayItems,
  getPendingActionButtonLayout,
} from "../src/modules/contextPanel/agentTrace/render";
import type { AgentPendingAction, AgentRunEventRecord } from "../src/agent/types";

describe("agentTrace render", function () {
  it("preserves whitespace when compacting reasoning deltas", function () {
    const events: AgentRunEventRecord[] = [
      {
        runId: "run-1",
        seq: 1,
        eventType: "reasoning",
        payload: {
          type: "reasoning",
          round: 1,
          details: "Let me ",
        },
        createdAt: 1,
      },
      {
        runId: "run-1",
        seq: 2,
        eventType: "reasoning",
        payload: {
          type: "reasoning",
          round: 1,
          details: "read the paper first.",
        },
        createdAt: 2,
      },
    ];

    const items = buildAgentTraceDisplayItems(events, null);
    const reasoningItem = items.find(
      (item) => item.type === "reasoning",
    );

    assert.deepInclude(reasoningItem, {
      type: "reasoning",
      details: "Let me read the paper first.",
    });
  });

  it("uses a single primary action surface for multi-action review cards", function () {
    const action: AgentPendingAction = {
      toolName: "search_literature_online",
      mode: "review",
      title: "Review online search results",
      actions: [
        { id: "import", label: "Import selected", style: "primary" },
        { id: "save_note", label: "Save selected as note", style: "secondary" },
        { id: "new_search", label: "Search again", style: "secondary" },
        { id: "cancel", label: "Cancel", style: "secondary" },
      ],
      defaultActionId: "import",
      cancelActionId: "cancel",
      fields: [],
    };

    assert.deepEqual(getPendingActionButtonLayout(action), {
      hasActionChooser: true,
      showsFooterExecuteButton: false,
    });
  });

  it("shows a footer execute button when a multi-action review needs extra input", function () {
    const action: AgentPendingAction = {
      toolName: "search_literature_online",
      mode: "review",
      title: "Review online literature results",
      actions: [
        { id: "import", label: "Import selected", style: "primary" },
        { id: "save_note", label: "Save selected as note", style: "secondary" },
        { id: "new_search", label: "Search again", style: "secondary" },
        { id: "cancel", label: "Cancel", style: "secondary" },
      ],
      defaultActionId: "import",
      cancelActionId: "cancel",
      fields: [
        {
          type: "text",
          id: "nextQuery",
          label: "Next search query",
          value: "plasticity",
          visibleForActionIds: ["new_search"],
          requiredForActionIds: ["new_search"],
        },
      ],
    };

    assert.deepEqual(getPendingActionButtonLayout(action), {
      hasActionChooser: true,
      showsFooterExecuteButton: true,
    });
  });

  it("keeps the footer execute button for legacy confirm-cancel cards", function () {
    const action: AgentPendingAction = {
      toolName: "mutate_library",
      title: "Confirm library change",
      confirmLabel: "Apply",
      cancelLabel: "Cancel",
      fields: [],
    };

    assert.deepEqual(getPendingActionButtonLayout(action), {
      hasActionChooser: false,
      showsFooterExecuteButton: true,
    });
  });
});
