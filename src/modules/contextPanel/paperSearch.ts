import type { PaperContextRef } from "./types";

export type PaperSearchAttachmentCandidate = {
  contextItemId: number;
  title: string;
  score: number;
};

export type PaperSearchGroupCandidate = Omit<
  PaperContextRef,
  "contextItemId"
> & {
  attachments: PaperSearchAttachmentCandidate[];
  score: number;
  modifiedAt: number;
};

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeSearchToken(value: string): string {
  return value.toLowerCase().trim();
}

function extractYear(value: string): string | undefined {
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match?.[0];
}

function toModifiedTimestamp(value: unknown): number {
  const text = normalizeText(value);
  if (!text) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getPdfChildAttachments(item: Zotero.Item): Zotero.Item[] {
  const out: Zotero.Item[] = [];
  if (!item?.isRegularItem?.()) return out;
  const attachments = item.getAttachments();
  for (const attachmentId of attachments) {
    const attachment = Zotero.Items.get(attachmentId);
    if (
      attachment &&
      attachment.isAttachment() &&
      attachment.attachmentContentType === "application/pdf"
    ) {
      out.push(attachment);
    }
  }
  return out;
}

function resolveAttachmentTitle(
  attachment: Zotero.Item,
  index: number,
  total: number,
): string {
  const title = normalizeText(attachment.getField("title"));
  if (title) return title;
  const filename = normalizeText(
    (attachment as unknown as { attachmentFilename?: string })
      .attachmentFilename || "",
  );
  if (filename) return filename;
  if (total > 1) return `PDF ${index + 1}`;
  return "PDF";
}

function buildAttachmentCandidates(
  attachments: Zotero.Item[],
): PaperSearchAttachmentCandidate[] {
  return attachments.map((attachment, index) => ({
    contextItemId: attachment.id,
    title: resolveAttachmentTitle(attachment, index, attachments.length),
    score: 0,
  }));
}

function buildGroupCandidate(
  item: Zotero.Item,
  attachments: Zotero.Item[],
): PaperSearchGroupCandidate | null {
  if (!attachments.length) return null;
  const title = normalizeText(item.getField("title")) || `Item ${item.id}`;
  const citationKey = normalizeText(item.getField("citationKey")) || undefined;
  const firstCreator =
    normalizeText(item.firstCreator) ||
    normalizeText(item.getField("firstCreator")) ||
    undefined;
  const year =
    extractYear(normalizeText(item.getField("year"))) ||
    extractYear(normalizeText(item.getField("date"))) ||
    undefined;
  return {
    itemId: item.id,
    citationKey,
    title,
    firstCreator,
    year,
    attachments: buildAttachmentCandidates(attachments),
    score: 0,
    modifiedAt: toModifiedTimestamp(item.dateModified),
  };
}

function scorePaperMetadata(
  candidate: Pick<
    PaperContextRef,
    "citationKey" | "title" | "firstCreator" | "year"
  >,
  query: string,
): number {
  const normalizedQuery = normalizeSearchToken(query);
  if (!normalizedQuery) return 0;
  const queryTokens = normalizedQuery.split(/\s+/g).filter(Boolean);
  const citationKey = normalizeSearchToken(candidate.citationKey || "");
  const title = normalizeSearchToken(candidate.title || "");
  const creator = normalizeSearchToken(candidate.firstCreator || "");
  const year = normalizeSearchToken(candidate.year || "");

  let score = 0;
  if (citationKey && citationKey.startsWith(normalizedQuery)) {
    score += 1200;
  } else if (citationKey && citationKey.includes(normalizedQuery)) {
    score += 1000;
  }
  if (title.includes(normalizedQuery)) {
    score += 700;
  }
  if (creator.includes(normalizedQuery)) {
    score += 500;
  }
  if (year && (year === normalizedQuery || year.includes(normalizedQuery))) {
    score += 300;
  }

  if (queryTokens.length > 1) {
    const combined = `${citationKey} ${title} ${creator} ${year}`.trim();
    const tokenMatches = queryTokens.reduce((count, token) => {
      return count + (combined.includes(token) ? 1 : 0);
    }, 0);
    score += tokenMatches * 80;
  }

  return score;
}

function scoreAttachmentTitle(title: string, query: string): number {
  const normalizedQuery = normalizeSearchToken(query);
  if (!normalizedQuery) return 0;
  const queryTokens = normalizedQuery.split(/\s+/g).filter(Boolean);
  const normalizedTitle = normalizeSearchToken(title);
  if (!normalizedTitle) return 0;

  let score = 0;
  if (normalizedTitle.startsWith(normalizedQuery)) {
    score += 640;
  } else if (normalizedTitle.includes(normalizedQuery)) {
    score += 560;
  }
  if (queryTokens.length > 1) {
    const tokenMatches = queryTokens.reduce((count, token) => {
      return count + (normalizedTitle.includes(token) ? 1 : 0);
    }, 0);
    score += tokenMatches * 60;
  }
  return score;
}

export async function searchPaperCandidates(
  libraryID: number,
  query: string,
  excludeContextItemId?: number | null,
  limit = 20,
): Promise<PaperSearchGroupCandidate[]> {
  if (!Number.isFinite(libraryID) || libraryID <= 0) return [];
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.floor(limit))
    : 20;
  let items: Zotero.Item[] = [];
  try {
    items = await Zotero.Items.getAll(libraryID, true, false, false);
  } catch (err) {
    ztoolkit.log("LLM: Failed to load library items for paper search", err);
    return [];
  }
  const excludeId =
    typeof excludeContextItemId === "number" &&
    Number.isFinite(excludeContextItemId) &&
    excludeContextItemId > 0
      ? Math.floor(excludeContextItemId)
      : null;
  const normalizedQuery = normalizeSearchToken(query);
  const candidates: PaperSearchGroupCandidate[] = [];
  for (const item of items) {
    if (!item?.isRegularItem?.()) continue;
    const contextAttachments = getPdfChildAttachments(item).filter(
      (attachment) => !excludeId || attachment.id !== excludeId,
    );
    if (!contextAttachments.length) continue;
    const candidate = buildGroupCandidate(item, contextAttachments);
    if (!candidate) continue;

    const paperScore = normalizedQuery
      ? scorePaperMetadata(candidate, normalizedQuery)
      : 0;
    for (const attachment of candidate.attachments) {
      attachment.score = normalizedQuery
        ? scoreAttachmentTitle(attachment.title, normalizedQuery)
        : 0;
    }
    const bestAttachmentScore = candidate.attachments.reduce(
      (maxScore, attachment) => Math.max(maxScore, attachment.score),
      0,
    );
    candidate.score = Math.max(paperScore, bestAttachmentScore);
    if (normalizedQuery && candidate.score <= 0) continue;

    candidate.attachments.sort((a, b) => {
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) return scoreDelta;
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
    candidates.push(candidate);
  }
  candidates.sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    return b.modifiedAt - a.modifiedAt;
  });
  return candidates.slice(0, normalizedLimit);
}
