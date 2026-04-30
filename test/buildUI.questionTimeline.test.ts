import { assert } from "chai";
import { buildUI } from "../src/modules/contextPanel/buildUI";

class FakeElement {
  readonly ownerDocument: FakeDocument;
  readonly tagName: string;
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  id = "";
  className = "";
  textContent = "";
  title = "";
  type = "";
  disabled = false;

  constructor(ownerDocument: FakeDocument, tagName: string) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node: FakeElement): FakeElement {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    for (const node of nodes) this.appendChild(node);
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

class FakeDocument {
  defaultView = { HTMLElement: FakeElement };

  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }
}

function findById(root: FakeElement, id: string): FakeElement | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

describe("buildUI question timeline", function () {
  it("keeps the full-question tooltip outside the clipped chat shell", function () {
    const doc = new FakeDocument();
    const body = new FakeElement(doc, "section");

    buildUI(body as unknown as Element, null);

    const chatShell = findById(body, "llm-chat-shell");
    const tooltip = findById(body, "llm-question-timeline-tooltip");

    assert.exists(chatShell);
    assert.exists(tooltip);
    assert.notEqual(tooltip?.parentElement, chatShell);
    assert.equal(tooltip?.parentElement, body);
  });
});
