import { assert } from "chai";
import { buildContextPlanSystemMessages } from "../src/modules/contextPanel/requestSystemMessages";

describe("requestSystemMessages", function () {
  it("adds a truncation disclosure for first-turn full-paper requests", function () {
    const messages = buildContextPlanSystemMessages({
      strategy: "paper-first-full",
      inputCapEffects: {
        documentContextTrimmed: true,
        documentContextDropped: false,
        promptTrimmed: false,
        historyDropped: false,
      },
    });

    assert.lengthOf(messages, 1);
    assert.include(messages[0], "truncated");
    assert.include(messages[0], "model input limit");
  });

  it("keeps capability guidance and omits truncation disclosure when not needed", function () {
    const messages = buildContextPlanSystemMessages({
      strategy: "paper-followup-retrieval",
      assistantInstruction:
        "Say briefly that you can access the paper's full text.",
      inputCapEffects: {
        documentContextTrimmed: false,
        documentContextDropped: false,
        promptTrimmed: false,
        historyDropped: false,
      },
    });

    assert.lengthOf(messages, 2);
    assert.include(messages[0], "full text");
    assert.include(messages[0], "Never say that you do not have full access");
    assert.equal(
      messages[1],
      "Say briefly that you can access the paper's full text.",
    );
  });
});
