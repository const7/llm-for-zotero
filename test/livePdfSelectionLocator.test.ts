import { assert } from "chai";
import {
  locateQuoteInPageTexts,
  locateSelectionInPageTexts,
} from "../src/modules/contextPanel/livePdfSelectionLocator";

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

  it("resolves repeated quote matches when they stay on one page", function () {
    const result = locateSelectionInPageTexts(
      [
        {
          pageIndex: 0,
          text: "The baseline improved on this benchmark. Later, the baseline improved on this benchmark.",
        },
      ],
      "The baseline improved on this benchmark.",
      0,
      {
        queryLabel: "Quote",
        resolveSinglePageDuplicates: true,
      },
    );

    assert.equal(result.status, "resolved");
    assert.equal(result.confidence, "low");
    assert.equal(result.computedPageIndex, 0);
    assert.deepEqual(result.matchedPageIndexes, [0]);
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

  it("resolves a truncated long quote using internal anchors", function () {
    const pages = [
      {
        pageIndex: 0,
        text: "Background material that does not matter here.",
      },
      {
        pageIndex: 23,
        text: "When each GC samples only a restricted subset of MCs, inhibitory feedback cannot selectively cancel shared components of two odor representations without also affecting their unique components. As a result, learning reduces overlap only approximately, leaving residual responses in the perpendicular to the original representation subspace directions. This residual activity manifests as a rotation of the encoding subspace, or representational drift. Similar ideas have been proposed elsewhere. For example, Kong et al. suggested that differences in structural connectivity sparsity could account for the contrasting levels of drift observed in hippocampal CA1 versus CA3. The existence of structural constraints does not rule out stochastic fluctuations, but our findings suggest that, in the OB, fixed architecture may be a major contributor to drift.",
      },
    ];

    const result = locateQuoteInPageTexts(
      pages,
      "stricted subset of MCs, inhibitory feedback cannot selectively cancel shared components of two odor representations without also affecting their unique components. As a result, learning reduces overlap only approximately, leaving residual responses in the perpendicular to the original representation subspace directions. This residual activity manifests as a rotation of the encoding subspace, or representational drift (Fig. 4C-E). Similar ideas have been proposed elsewhere. For example, Kong et al. (Kong et al., 2024; Zabeh et al., 2025) suggested that differences in structural connectivity sparsity could account for the contrasting levels of drift observed in hippocampal CA1 versus CA3. The existence of structural constraints does not rule out stochastic fluctuations, but our findings suggest that, in the OB, fixed architecture may be a major contributor to drift",
      23,
    );

    assert.equal(result.status, "resolved");
    assert.oneOf(result.confidence, ["medium", "high"]);
    assert.equal(result.computedPageIndex, 23);
  });

  it("keeps quote matches ambiguous when anchors support two pages equally", function () {
    const duplicatedPassage =
      "learning reduces overlap only approximately leaving residual responses in the perpendicular to the original representation subspace directions";
    const result = locateQuoteInPageTexts(
      [
        {
          pageIndex: 4,
          text: `Context before. ${duplicatedPassage}. Context after.`,
        },
        {
          pageIndex: 9,
          text: `Another section. ${duplicatedPassage}. Ending text.`,
        },
      ],
      duplicatedPassage,
      4,
    );

    assert.equal(result.status, "ambiguous");
    assert.isNull(result.computedPageIndex);
    assert.deepEqual(result.matchedPageIndexes, [4, 9]);
  });

  it("resolves quotes when math-like fragments are omitted from the page text", function () {
    const result = locateQuoteInPageTexts(
      [
        {
          pageIndex: 6,
          text: "The objective includes a regularization term and the model converges to a stable solution after alternating optimization.",
        },
      ],
      "The objective includes a regularization term lambda = 0.5 + beta_t and the model converges to a stable solution after alternating optimization.",
      6,
    );

    assert.equal(result.status, "resolved");
    assert.equal(result.computedPageIndex, 6);
  });

  it("resolves punctuation-heavy truncated classifier quotes", function () {
    const result = locateQuoteInPageTexts(
      [
        {
          pageIndex: 1,
          text: "We used a linear Support Vector Machine with soft margins. Features were standardized (z-scored), and the soft margin parameter C was set to 1. For within-day classification, we used leave-one-out cross-validation, testing classifier prediction on each trial that was left out. Accuracy was reported as the average across all left-out trials. For across-day classification, we trained the SVM on all trials from one day and tested on all trials from another day. Performance on shuffled data was assessed separately.",
        },
      ],
      "ear Support Vector Machine with soft margins. Features were standardized (z-scored), and the soft margin parameter C was set to 1. For within-day classification, we used leave-one-out cross-validation, testing classifier prediction on each trial that was left out. Accuracy was reported as the average across all left-out trials. For across-day classification, we trained the SVM on all trials from one day and tested on all trials from another day. Performance on shuffled data was as",
      1,
    );

    assert.equal(result.status, "resolved");
    assert.equal(result.computedPageIndex, 1);
  });
});
