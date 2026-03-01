import { collectReaderSelectionDocuments } from "./readerSelection";
import { sanitizeText } from "./textUtils";

export type LivePdfPageText = {
  pageIndex: number;
  pageLabel?: string;
  text: string;
};

export type LivePdfSelectionLocateStatus =
  | "resolved"
  | "ambiguous"
  | "not-found"
  | "selection-too-short"
  | "unavailable";

export type LivePdfSelectionLocateConfidence = "high" | "medium" | "low" | "none";

export type LivePdfSelectionLocateResult = {
  status: LivePdfSelectionLocateStatus;
  confidence: LivePdfSelectionLocateConfidence;
  selectionText: string;
  normalizedSelection: string;
  expectedPageIndex: number | null;
  computedPageIndex: number | null;
  matchedPageIndexes: number[];
  totalMatches: number;
  pagesScanned: number;
  excerpt?: string;
  reason?: string;
};

type PageMatch = {
  pageIndex: number;
  matchIndexes: number[];
  excerpt?: string;
};

const PAGE_CONTAINER_SELECTOR = [
  ".page[data-page-number]",
  ".page[data-page-index]",
  "[data-page-number]",
  "[data-page-index]",
].join(", ");

function normalizeLocatorText(value: string): string {
  return sanitizeText(value || "")
    .replace(/\u00ad/g, "")
    .replace(/([A-Za-z])-\s+([A-Za-z])/g, "$1$2")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findAllMatchIndexes(haystack: string, needle: string): number[] {
  if (!haystack || !needle) return [];
  const out: number[] = [];
  let cursor = 0;
  while (cursor < haystack.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found < 0) break;
    out.push(found);
    cursor = found + Math.max(1, Math.floor(needle.length / 2));
  }
  return out;
}

function buildExcerpt(text: string, index: number, matchLength: number): string {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const start = Math.max(0, index - 72);
  const end = Math.min(normalized.length, index + matchLength + 72);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";
  return `${prefix}${normalized.slice(start, end).trim()}${suffix}`;
}

function isElementNode(value: unknown): value is Element {
  return Boolean(
    value &&
      typeof value === "object" &&
      "nodeType" in value &&
      (value as { nodeType?: unknown }).nodeType === 1,
  );
}

function getElementFromNode(node: Node | null | undefined): Element | null {
  if (!node) return null;
  if (node.nodeType === 1) {
    return node as Element;
  }
  return node.parentElement || null;
}

function parsePageIndexFromElement(element: Element | null | undefined): number | null {
  let current = element || null;
  while (current) {
    const pageNumberAttr = current.getAttribute("data-page-number");
    if (pageNumberAttr) {
      const pageNumber = Number.parseInt(pageNumberAttr, 10);
      if (Number.isFinite(pageNumber) && pageNumber >= 1) {
        return pageNumber - 1;
      }
    }
    const pageIndexAttr = current.getAttribute("data-page-index");
    if (pageIndexAttr) {
      const pageIndex = Number.parseInt(pageIndexAttr, 10);
      if (Number.isFinite(pageIndex) && pageIndex >= 0) {
        return pageIndex;
      }
    }
    current = current.parentElement;
  }
  return null;
}

function getPageLabelFromElement(element: Element | null | undefined): string | undefined {
  let current = element || null;
  while (current) {
    const pageNumberAttr = current.getAttribute("data-page-number");
    if (pageNumberAttr) {
      return pageNumberAttr;
    }
    const pageIndexAttr = current.getAttribute("data-page-index");
    if (pageIndexAttr) {
      const pageIndex = Number.parseInt(pageIndexAttr, 10);
      if (Number.isFinite(pageIndex) && pageIndex >= 0) {
        return `${pageIndex + 1}`;
      }
    }
    current = current.parentElement;
  }
  return undefined;
}

function countRenderedPages(doc: Document): number {
  return doc.querySelectorAll(PAGE_CONTAINER_SELECTOR).length;
}

function getSelectionPageElement(doc: Document): Element | null {
  const selection = doc.defaultView?.getSelection?.();
  if (!selection || selection.rangeCount < 1 || selection.isCollapsed) {
    return null;
  }
  const candidates: Array<Node | null> = [
    selection.anchorNode,
    selection.focusNode,
    selection.getRangeAt(0).commonAncestorContainer,
  ];
  for (const node of candidates) {
    const element = getElementFromNode(node);
    const pageIndex = parsePageIndexFromElement(element);
    if (pageIndex !== null) {
      return element;
    }
  }
  return null;
}

function buildDomResolvedResult(
  selectionText: string,
  expectedPageIndex: number | null,
  pageIndex: number,
  pageLabel?: string,
  pagesScanned = 0,
): LivePdfSelectionLocateResult {
  return {
    status: "resolved",
    confidence: "high",
    selectionText: sanitizeText(selectionText || "").trim(),
    normalizedSelection: normalizeLocatorText(selectionText),
    expectedPageIndex,
    computedPageIndex: pageIndex,
    matchedPageIndexes: [pageIndex],
    totalMatches: 1,
    pagesScanned,
    reason: pageLabel
      ? `Resolved directly from the live selection DOM on page ${pageLabel}.`
      : "Resolved directly from the live selection DOM.",
  };
}

function matchByPrefixSuffix(
  normalizedPageText: string,
  normalizedSelection: string,
): number[] {
  if (normalizedSelection.length < 48) return [];
  const edgeLength = Math.max(18, Math.min(64, Math.floor(normalizedSelection.length / 3)));
  const prefix = normalizedSelection.slice(0, edgeLength).trim();
  const suffix = normalizedSelection.slice(-edgeLength).trim();
  if (!prefix || !suffix) return [];
  const out: number[] = [];
  let cursor = 0;
  while (cursor < normalizedPageText.length) {
    const prefixIndex = normalizedPageText.indexOf(prefix, cursor);
    if (prefixIndex < 0) break;
    const suffixSearchStart = prefixIndex + prefix.length;
    const suffixIndex = normalizedPageText.indexOf(suffix, suffixSearchStart);
    if (suffixIndex < 0) break;
    const spanLength = suffixIndex + suffix.length - prefixIndex;
    if (spanLength <= normalizedSelection.length * 1.8 + 48) {
      out.push(prefixIndex);
    }
    cursor = prefixIndex + Math.max(1, Math.floor(prefix.length / 2));
  }
  return out;
}

function collectPageMatches(
  pages: LivePdfPageText[],
  normalizedSelection: string,
): { matches: PageMatch[]; confidence: LivePdfSelectionLocateConfidence } {
  const exactMatches: PageMatch[] = [];
  for (const page of pages) {
    const normalizedPageText = normalizeLocatorText(page.text);
    const matchIndexes = findAllMatchIndexes(normalizedPageText, normalizedSelection);
    if (!matchIndexes.length) continue;
    exactMatches.push({
      pageIndex: page.pageIndex,
      matchIndexes,
      excerpt: buildExcerpt(
        normalizedPageText,
        matchIndexes[0],
        normalizedSelection.length,
      ),
    });
  }
  if (exactMatches.length) {
    return { matches: exactMatches, confidence: "high" };
  }

  const fallbackMatches: PageMatch[] = [];
  for (const page of pages) {
    const normalizedPageText = normalizeLocatorText(page.text);
    const matchIndexes = matchByPrefixSuffix(normalizedPageText, normalizedSelection);
    if (!matchIndexes.length) continue;
    fallbackMatches.push({
      pageIndex: page.pageIndex,
      matchIndexes,
      excerpt: buildExcerpt(
        normalizedPageText,
        matchIndexes[0],
        normalizedSelection.length,
      ),
    });
  }
  return {
    matches: fallbackMatches,
    confidence: fallbackMatches.length ? "medium" : "none",
  };
}

export function locateSelectionInPageTexts(
  pages: LivePdfPageText[],
  selectionText: string,
  expectedPageIndex?: number | null,
): LivePdfSelectionLocateResult {
  const normalizedSelection = normalizeLocatorText(selectionText);
  if (!normalizedSelection) {
    return {
      status: "unavailable",
      confidence: "none",
      selectionText: sanitizeText(selectionText || "").trim(),
      normalizedSelection,
      expectedPageIndex: expectedPageIndex ?? null,
      computedPageIndex: null,
      matchedPageIndexes: [],
      totalMatches: 0,
      pagesScanned: pages.length,
      reason: "Selection text was empty.",
    };
  }
  if (normalizedSelection.length < 12) {
    return {
      status: "selection-too-short",
      confidence: "none",
      selectionText: sanitizeText(selectionText || "").trim(),
      normalizedSelection,
      expectedPageIndex: expectedPageIndex ?? null,
      computedPageIndex: null,
      matchedPageIndexes: [],
      totalMatches: 0,
      pagesScanned: pages.length,
      reason: "Selection was too short for reliable page resolution.",
    };
  }

  const { matches, confidence } = collectPageMatches(pages, normalizedSelection);
  const matchedPageIndexes = matches.map((match) => match.pageIndex);
  const totalMatches = matches.reduce(
    (sum, match) => sum + match.matchIndexes.length,
    0,
  );
  if (!matches.length) {
    return {
      status: "not-found",
      confidence: "none",
      selectionText: sanitizeText(selectionText || "").trim(),
      normalizedSelection,
      expectedPageIndex: expectedPageIndex ?? null,
      computedPageIndex: null,
      matchedPageIndexes,
      totalMatches,
      pagesScanned: pages.length,
      reason: "The live PDF text search did not find the current selection.",
    };
  }
  if (matches.length > 1 || totalMatches > 1) {
    return {
      status: "ambiguous",
      confidence: confidence === "high" ? "low" : confidence,
      selectionText: sanitizeText(selectionText || "").trim(),
      normalizedSelection,
      expectedPageIndex: expectedPageIndex ?? null,
      computedPageIndex: null,
      matchedPageIndexes,
      totalMatches,
      pagesScanned: pages.length,
      excerpt: matches[0].excerpt,
      reason: "The current selection matched more than one location in the live PDF.",
    };
  }

  return {
    status: "resolved",
    confidence,
    selectionText: sanitizeText(selectionText || "").trim(),
    normalizedSelection,
    expectedPageIndex: expectedPageIndex ?? null,
    computedPageIndex: matches[0].pageIndex,
    matchedPageIndexes,
    totalMatches,
    pagesScanned: pages.length,
    excerpt: matches[0].excerpt,
  };
}

function getPdfViewerApplication(reader: any): any | null {
  const candidates = [
    reader?._internalReader?._lastView,
    reader?._internalReader?._primaryView,
    reader?._internalReader?._secondaryView,
    reader,
  ];
  for (const candidate of candidates) {
    const app =
      candidate?._iframeWindow?.PDFViewerApplication ||
      candidate?._iframe?.contentWindow?.PDFViewerApplication ||
      candidate?._window?.PDFViewerApplication;
    if (app?.pdfDocument) {
      return app;
    }
  }
  return null;
}

function getExpectedPageIndex(reader: any, app?: any | null): number | null {
  const candidates = [
    reader?._internalReader?._state?.primaryViewStats?.pageIndex,
    reader?._internalReader?._state?.secondaryViewStats?.pageIndex,
    Number.isFinite(app?.page) ? Number(app.page) - 1 : null,
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function locateCurrentSelectionFromDom(
  reader: any,
  selectionText: string,
): LivePdfSelectionLocateResult | null {
  const normalizedSelection = normalizeLocatorText(selectionText);
  if (!normalizedSelection) return null;

  const app = getPdfViewerApplication(reader);
  const expectedPageIndex = getExpectedPageIndex(reader, app);
  const docs = collectReaderSelectionDocuments(reader);
  for (const doc of docs) {
    const selectedText = sanitizeText(doc.defaultView?.getSelection?.()?.toString() || "").trim();
    if (!selectedText) continue;
    if (normalizeLocatorText(selectedText) !== normalizedSelection) continue;
    const selectionPageElement = getSelectionPageElement(doc);
    const pageIndex = parsePageIndexFromElement(selectionPageElement);
    if (pageIndex === null) continue;
    return buildDomResolvedResult(
      selectionText,
      expectedPageIndex,
      pageIndex,
      getPageLabelFromElement(selectionPageElement),
      countRenderedPages(doc),
    );
  }
  return null;
}

function extractPageTextFromElement(pageElement: Element): string {
  const textLayer =
    pageElement.querySelector(".textLayer") ||
    pageElement.querySelector('[class*="textLayer"]');
  return sanitizeText((textLayer?.textContent || pageElement.textContent || "").trim());
}

function extractRenderedPageTexts(reader: any): {
  pages: LivePdfPageText[];
  expectedPageIndex: number | null;
} {
  const app = getPdfViewerApplication(reader);
  const pagesByIndex = new Map<number, LivePdfPageText>();
  const docs = collectReaderSelectionDocuments(reader);
  for (const doc of docs) {
    const pageElements = Array.from(doc.querySelectorAll(PAGE_CONTAINER_SELECTOR)).filter(
      isElementNode,
    );
    for (const pageElement of pageElements) {
      const pageIndex = parsePageIndexFromElement(pageElement);
      if (pageIndex === null || pagesByIndex.has(pageIndex)) continue;
      const text = extractPageTextFromElement(pageElement);
      if (!text) continue;
      pagesByIndex.set(pageIndex, {
        pageIndex,
        pageLabel: getPageLabelFromElement(pageElement) || `${pageIndex + 1}`,
        text,
      });
    }
  }

  return {
    pages: Array.from(pagesByIndex.values()).sort((a, b) => a.pageIndex - b.pageIndex),
    expectedPageIndex: getExpectedPageIndex(reader, app),
  };
}

export async function locateCurrentSelectionInLivePdfReader(
  reader: any,
  selectionText: string,
): Promise<LivePdfSelectionLocateResult> {
  const cleanSelection = sanitizeText(selectionText || "").trim();
  if (!cleanSelection) {
    return {
      status: "unavailable",
      confidence: "none",
      selectionText: cleanSelection,
      normalizedSelection: "",
      expectedPageIndex: null,
      computedPageIndex: null,
      matchedPageIndexes: [],
      totalMatches: 0,
      pagesScanned: 0,
      reason: "No live reader selection was available.",
    };
  }

  try {
    const domResolved = locateCurrentSelectionFromDom(reader, cleanSelection);
    if (domResolved) {
      return domResolved;
    }

    const { pages, expectedPageIndex } = extractRenderedPageTexts(reader);
    if (!pages.length) {
      return {
        status: "unavailable",
        confidence: "none",
        selectionText: cleanSelection,
        normalizedSelection: normalizeLocatorText(cleanSelection),
        expectedPageIndex,
        computedPageIndex: null,
        matchedPageIndexes: [],
        totalMatches: 0,
        pagesScanned: 0,
        reason: "The active reader did not expose a live selection page or rendered page text.",
      };
    }

    const result = locateSelectionInPageTexts(pages, cleanSelection, expectedPageIndex);
    if (result.status === "resolved" && result.reason) {
      return {
        ...result,
        reason: `${result.reason} This was matched against the currently rendered live reader pages.`,
      };
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "unavailable",
      confidence: "none",
      selectionText: cleanSelection,
      normalizedSelection: normalizeLocatorText(cleanSelection),
      expectedPageIndex: getExpectedPageIndex(reader, getPdfViewerApplication(reader)),
      computedPageIndex: null,
      matchedPageIndexes: [],
      totalMatches: 0,
      pagesScanned: 0,
      reason: `Live reader locator failed: ${message}`,
    };
  }
}
