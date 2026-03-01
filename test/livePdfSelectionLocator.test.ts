import { assert } from "chai";
import { locateSelectionInPageTexts } from "../src/modules/contextPanel/livePdfSelectionLocator";

describe("livePdfSelectionLocator", function () {
  it("resolves a unique selection to the matching page", function () {
    const result = locateSelectionInPageTexts(
      [
        {
          pageIndex: 0,
          text: "Introduction to the paper.",
        },
        {
          pageIndex: 1,
          text: "Representational drift remained stable across repeated measurements.",
        },
      ],
      "Representational drift remained stable across repeated measurements.",
      1,
    );

    assert.equal(result.status, "resolved");
    assert.equal(result.confidence, "high");
    assert.equal(result.expectedPageIndex, 1);
    assert.equal(result.computedPageIndex, 1);
    assert.deepEqual(result.matchedPageIndexes, [1]);
  });

  it("marks repeated matches as ambiguous", function () {
    const result = locateSelectionInPageTexts(
      [
        {
          pageIndex: 0,
          text: "The baseline improved on this benchmark.",
        },
        {
          pageIndex: 1,
          text: "A replication found that the baseline improved on this benchmark.",
        },
      ],
      "The baseline improved on this benchmark.",
      0,
    );

    assert.equal(result.status, "ambiguous");
    assert.isNull(result.computedPageIndex);
    assert.deepEqual(result.matchedPageIndexes, [0, 1]);
  });

  it("uses prefix-suffix fallback for hyphenated page text", function () {
    const result = locateSelectionInPageTexts(
      [
        {
          pageIndex: 0,
          text: "Representational drift was ob-\nserved consistently over time in the population response.",
        },
      ],
      "Representational drift was observed consistently over time in the population response.",
      0,
    );

    assert.equal(result.status, "resolved");
    assert.oneOf(result.confidence, ["high", "medium"]);
    assert.equal(result.computedPageIndex, 0);
  });

  it("rejects very short selections", function () {
    const result = locateSelectionInPageTexts(
      [
        {
          pageIndex: 0,
          text: "Tiny sample page text.",
        },
      ],
      "Tiny",
      0,
    );

    assert.equal(result.status, "selection-too-short");
    assert.isNull(result.computedPageIndex);
  });
});
