import { assert } from "chai";
import { resolveStandalonePaperTabLabel } from "../src/modules/contextPanel/standaloneTabLabel";

describe("standaloneTabLabel", function () {
  const globalScope = globalThis as typeof globalThis & {
    Zotero?: {
      Items?: {
        get?: (id: number) => Zotero.Item | null;
      };
    };
  };
  const originalZotero = globalScope.Zotero;

  const parentPaper = {
    id: 10,
    isRegularItem: () => true,
  } as unknown as Zotero.Item;

  const attachedNote = {
    id: 42,
    parentID: 10,
    isNote: () => true,
    getDisplayTitle: () => "Draft note",
    getField: () => "",
    getNoteTitle: () => "Draft note",
  } as unknown as Zotero.Item;

  const paperItem = {
    id: 88,
    isNote: () => false,
  } as unknown as Zotero.Item;

  beforeEach(function () {
    globalScope.Zotero = {
      ...(originalZotero || {}),
      Items: {
        get: (id: number) => (id === 10 ? parentPaper : null),
      },
    };
  });

  afterEach(function () {
    if (originalZotero) {
      globalScope.Zotero = originalZotero;
      return;
    }
    delete globalScope.Zotero;
  });

  it("labels an attached note paper slot as Note editing", function () {
    assert.equal(
      resolveStandalonePaperTabLabel({ paperSlotItem: attachedNote }),
      "Note editing",
    );
  });

  it("labels a regular paper slot as Paper chat", function () {
    assert.equal(
      resolveStandalonePaperTabLabel({ paperSlotItem: paperItem }),
      "Paper chat",
    );
  });

  it("falls back to Paper chat when there is no paper-side context", function () {
    assert.equal(resolveStandalonePaperTabLabel(), "Paper chat");
    assert.equal(
      resolveStandalonePaperTabLabel({ paperSlotItem: null }),
      "Paper chat",
    );
  });

  it("overrides the paper slot label with Web chat while webchat is active", function () {
    assert.equal(
      resolveStandalonePaperTabLabel({
        paperSlotItem: attachedNote,
        isWebChat: true,
      }),
      "Web chat",
    );
  });

  it("preserves a note-editing paper slot label while library chat is active", function () {
    const paperSlotItem = attachedNote;
    const labelWhileLibraryChat = resolveStandalonePaperTabLabel({
      paperSlotItem,
    });
    const labelAfterReturning = resolveStandalonePaperTabLabel({
      paperSlotItem,
    });

    assert.equal(labelWhileLibraryChat, "Note editing");
    assert.equal(labelAfterReturning, "Note editing");
  });

  it("preserves a regular paper-slot label while library chat is active", function () {
    const paperSlotItem = paperItem;
    const labelWhileLibraryChat = resolveStandalonePaperTabLabel({
      paperSlotItem,
    });
    const labelAfterReturning = resolveStandalonePaperTabLabel({
      paperSlotItem,
    });

    assert.equal(labelWhileLibraryChat, "Paper chat");
    assert.equal(labelAfterReturning, "Paper chat");
  });
});
