import type { PaperContextRef } from "./types";

export type PaperSearchCandidate = PaperContextRef & {
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

function getFirstPdfChildAttachment(item: Zotero.Item): Zotero.Item | null {
  if (!item?.isRegularItem?.()) return null;
  const attachments = item.getAttachments();
  for (const attachmentId of attachments) {
    const attachment = Zotero.Items.get(attachmentId);
    if (
      attachment &&
      attachment.isAttachment() &&
      attachment.attachmentContentType === "application/pdf"
    ) {
      return attachment;
    }
  }
  return null;
}

function buildCandidate(item: Zotero.Item): PaperSearchCandidate | null {
  const contextAttachment = getFirstPdfChildAttachment(item);
  if (!contextAttachment) return null;
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
    contextItemId: contextAttachment.id,
    citationKey,
    title,
    firstCreator,
    year,
    score: 0,
    modifiedAt: toModifiedTimestamp(item.dateModified),
  };
}

function scoreCandidate(
  candidate: PaperSearchCandidate,
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

export async function searchPaperCandidates(
  libraryID: number,
  query: string,
  excludeConversationItemId?: number | null,
  limit = 20,
): Promise<PaperSearchCandidate[]> {
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
    typeof excludeConversationItemId === "number" &&
    Number.isFinite(excludeConversationItemId) &&
    excludeConversationItemId > 0
      ? Math.floor(excludeConversationItemId)
      : null;
  const normalizedQuery = normalizeSearchToken(query);
  const candidates: PaperSearchCandidate[] = [];
  for (const item of items) {
    if (!item?.isRegularItem?.()) continue;
    if (excludeId && item.id === excludeId) continue;
    const candidate = buildCandidate(item);
    if (!candidate) continue;
    candidate.score = normalizedQuery
      ? scoreCandidate(candidate, normalizedQuery)
      : 0;
    if (normalizedQuery && candidate.score <= 0) continue;
    candidates.push(candidate);
  }
  candidates.sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    return b.modifiedAt - a.modifiedAt;
  });
  return candidates.slice(0, normalizedLimit);
}
