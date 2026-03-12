import type { PaperContextRef } from "../../shared/types";
import type {
  AgentRuntimeRequest,
} from "../types";
import type {
  CollectionSummary,
  EditableArticleMetadataSnapshot,
  LibraryPaperTargetAttachment,
  PaperAnnotationRecord,
  PaperNoteRecord,
  ZoteroGateway,
} from "./zoteroGateway";

export type ReadLibrarySection =
  | "metadata"
  | "notes"
  | "annotations"
  | "attachments"
  | "collections";

export type ReadLibraryResultEntry = {
  itemId: number;
  title: string;
  metadata?: EditableArticleMetadataSnapshot | null;
  notes?: PaperNoteRecord[];
  annotations?: PaperAnnotationRecord[];
  attachments?: LibraryPaperTargetAttachment[];
  collections?: CollectionSummary[];
};

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value) && value > 0)));
}

export class LibraryReadService {
  constructor(private readonly zoteroGateway: ZoteroGateway) {}

  resolveItemIds(params: {
    request: AgentRuntimeRequest;
    itemIds?: number[];
    paperContexts?: PaperContextRef[];
  }): number[] {
    const itemIds = [
      ...(params.itemIds || []),
      ...(params.paperContexts || []).map((entry) => entry.itemId),
      ...this.zoteroGateway.listPaperContexts(params.request).map((entry) => entry.itemId),
      Number(params.request.activeItemId) || 0,
    ];
    return uniqueNumbers(itemIds);
  }

  readItems(params: {
    request: AgentRuntimeRequest;
    itemIds?: number[];
    paperContexts?: PaperContextRef[];
    sections: ReadLibrarySection[];
    maxNotes?: number;
    maxAnnotations?: number;
  }): Record<string, ReadLibraryResultEntry> {
    const itemIds = this.resolveItemIds(params);
    const targetMap = new Map(
      this.zoteroGateway
        .getPaperTargetsByItemIds(itemIds)
        .map((target) => [target.itemId, target] as const),
    );
    const sectionSet = new Set(params.sections);
    const results: Record<string, ReadLibraryResultEntry> = {};
    for (const itemId of itemIds) {
      const item = this.zoteroGateway.resolveMetadataItem({ itemId });
      if (!item) continue;
      const metadata =
        sectionSet.has("metadata")
          ? this.zoteroGateway.getEditableArticleMetadata(item)
          : undefined;
      const target = targetMap.get(itemId);
      const collectionIds = target?.collectionIds || [];
      results[String(itemId)] = {
        itemId,
        title:
          metadata?.title ||
          target?.title ||
          `${item.getDisplayTitle?.() || `Item ${itemId}`}`,
        metadata,
        notes: sectionSet.has("notes")
          ? this.zoteroGateway.getPaperNotes({
              item,
              maxNotes: params.maxNotes,
            })
          : undefined,
        annotations: sectionSet.has("annotations")
          ? this.zoteroGateway.getPaperAnnotations({
              item,
              maxAnnotations: params.maxAnnotations,
            })
          : undefined,
        attachments: sectionSet.has("attachments") ? target?.attachments || [] : undefined,
        collections: sectionSet.has("collections")
          ? collectionIds
              .map((collectionId) => this.zoteroGateway.getCollectionSummary(collectionId))
              .filter((entry): entry is CollectionSummary => Boolean(entry))
          : undefined,
      };
    }
    return results;
  }
}
