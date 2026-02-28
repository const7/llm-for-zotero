import { assert } from "chai";
import {
  getLastUsedAgentEnabled,
  setLastUsedAgentEnabled,
} from "../src/modules/contextPanel/prefHelpers";

describe("prefHelpers agent toggle", function () {
  const prefKey = "extensions.zotero.llmforzotero.lastUsedAgentEnabled";
  const prefStore = new Map<string, unknown>();
  const originalZotero = (globalThis as { Zotero?: unknown }).Zotero;

  beforeEach(function () {
    prefStore.clear();
    (globalThis as { Zotero?: unknown }).Zotero = {
      Prefs: {
        get: (key: string) => prefStore.get(key),
        set: (key: string, value: unknown) => {
          prefStore.set(key, value);
        },
      },
    };
  });

  after(function () {
    (globalThis as { Zotero?: unknown }).Zotero = originalZotero;
  });

  it("returns null when the preference is missing", function () {
    assert.isNull(getLastUsedAgentEnabled());
  });

  it("persists boolean agent state", function () {
    setLastUsedAgentEnabled(true);
    assert.strictEqual(prefStore.get(prefKey), true);
    assert.strictEqual(getLastUsedAgentEnabled(), true);

    setLastUsedAgentEnabled(false);
    assert.strictEqual(prefStore.get(prefKey), false);
    assert.strictEqual(getLastUsedAgentEnabled(), false);
  });

  it("parses string boolean preference values", function () {
    prefStore.set(prefKey, "true");
    assert.strictEqual(getLastUsedAgentEnabled(), true);

    prefStore.set(prefKey, "false");
    assert.strictEqual(getLastUsedAgentEnabled(), false);
  });
});
