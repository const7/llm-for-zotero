import { resolveActiveNoteSession } from "./portalScope";

export type StandalonePaperTabLabel =
  | "Note editing"
  | "Paper chat"
  | "Web chat";

export function resolveStandalonePaperTabLabel(options?: {
  paperSlotItem?: Zotero.Item | null;
  isWebChat?: boolean;
}): StandalonePaperTabLabel {
  if (options?.isWebChat) return "Web chat";
  return resolveActiveNoteSession(options?.paperSlotItem || null)
    ? "Note editing"
    : "Paper chat";
}
