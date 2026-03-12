import type {
  CollectionBrowseNode,
  CollectionSummary,
  DuplicateGroup,
  EditableArticleMetadataSnapshot,
  LibraryPaperTarget,
  RelatedPaperResult,
  ZoteroGateway,
} from "./zoteroGateway";

export type QueryLibraryEntity = "items" | "collections";
export type QueryLibraryMode = "search" | "list" | "related" | "duplicates";
export type QueryLibraryInclude =
  | "metadata"
  | "attachments"
  | "tags"
  | "collections";

export type QueryLibraryFilters = {
  unfiled?: boolean;
  untagged?: boolean;
  hasPdf?: boolean;
  collectionId?: number;
  author?: string;
  yearFrom?: number;
  yearTo?: number;
};

export type QueryLibraryItemResult = LibraryPaperTarget & {
  metadata?: EditableArticleMetadataSnapshot | null;
  collections?: CollectionSummary[];
};

type SearchResult = Awaited<
  ReturnType<ZoteroGateway["searchLibraryItems"]>
>[number];

type EnrichedSearchResult = Omit<
  SearchResult,
  "attachments" | "tags" | "collections" | "metadata"
> & {
  metadata?: EditableArticleMetadataSnapshot | null;
  attachments?: LibraryPaperTarget["attachments"];
  tags?: string[];
  collections?: CollectionSummary[];
};

function includeField(
  includes: QueryLibraryInclude[] | undefined,
  field: QueryLibraryInclude,
): boolean {
  return Array.isArray(includes) && includes.includes(field);
}

function buildCollectionSummaries(
  zoteroGateway: ZoteroGateway,
  collectionIds: number[],
): CollectionSummary[] {
  return collectionIds
    .map((collectionId) => zoteroGateway.getCollectionSummary(collectionId))
    .filter((entry): entry is CollectionSummary => Boolean(entry));
}

function enrichPaperTarget(
  target: LibraryPaperTarget,
  zoteroGateway: ZoteroGateway,
  include: QueryLibraryInclude[] | undefined,
): QueryLibraryItemResult {
  const result: QueryLibraryItemResult = {
    itemId: target.itemId,
    title: target.title,
    firstCreator: target.firstCreator,
    year: target.year,
    attachments: includeField(include, "attachments") ? target.attachments : [],
    tags: includeField(include, "tags") ? target.tags : [],
    collectionIds: target.collectionIds,
  };
  if (includeField(include, "metadata")) {
    result.metadata = zoteroGateway.getEditableArticleMetadata(
      zoteroGateway.getItem(target.itemId),
    );
  }
  if (includeField(include, "collections")) {
    result.collections = buildCollectionSummaries(
      zoteroGateway,
      target.collectionIds,
    );
  }
  return result;
}

function mergeSearchResult(
  result: SearchResult,
  target: LibraryPaperTarget | null,
  zoteroGateway: ZoteroGateway,
  include: QueryLibraryInclude[] | undefined,
): EnrichedSearchResult {
  return {
    ...result,
    metadata: includeField(include, "metadata")
      ? zoteroGateway.getEditableArticleMetadata(zoteroGateway.getItem(result.itemId))
      : undefined,
    attachments:
      includeField(include, "attachments") && target ? target.attachments : undefined,
    tags: includeField(include, "tags") && target ? target.tags : undefined,
    collections:
      includeField(include, "collections") && target
        ? buildCollectionSummaries(zoteroGateway, target.collectionIds)
        : undefined,
  };
}

export class LibraryQueryService {
  constructor(private readonly zoteroGateway: ZoteroGateway) {}

  queryCollections(params: {
    libraryID: number;
    mode: "search" | "list";
    text?: string;
    limit?: number;
  }): {
    results: CollectionSummary[];
    warnings: string[];
  } {
    const query = `${params.text || ""}`.trim().toLowerCase();
    let results = this.zoteroGateway.listCollectionSummaries(params.libraryID);
    if (params.mode === "search" && query) {
      results = results.filter((collection) => {
        const haystack = `${collection.name} ${collection.path || ""}`.toLowerCase();
        return haystack.includes(query);
      });
    }
    const limit = Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit as number))
      : undefined;
    return {
      results: limit && results.length > limit ? results.slice(0, limit) : results,
      warnings: [],
    };
  }

  async listItems(params: {
    libraryID: number;
    filters?: QueryLibraryFilters;
    limit?: number;
    include?: QueryLibraryInclude[];
  }): Promise<{
    results: QueryLibraryItemResult[];
    totalCount: number;
    warnings: string[];
  }> {
    const filters = params.filters || {};
    const warnings: string[] = [];
    if (filters.hasPdf === false) {
      warnings.push(
        "Item listing is currently limited to Zotero papers with PDF attachments.",
      );
    }
    let papersResult:
      | Awaited<ReturnType<ZoteroGateway["listLibraryPaperTargets"]>>
      | Awaited<ReturnType<ZoteroGateway["listCollectionPaperTargets"]>>
      | Awaited<ReturnType<ZoteroGateway["listUnfiledPaperTargets"]>>
      | Awaited<ReturnType<ZoteroGateway["listUntaggedPaperTargets"]>>;
    if (filters.collectionId) {
      papersResult = await this.zoteroGateway.listCollectionPaperTargets({
        libraryID: params.libraryID,
        collectionId: filters.collectionId,
        limit: params.limit,
      });
    } else if (filters.unfiled) {
      papersResult = await this.zoteroGateway.listUnfiledPaperTargets({
        libraryID: params.libraryID,
        limit: params.limit,
      });
    } else if (filters.untagged) {
      papersResult = await this.zoteroGateway.listUntaggedPaperTargets({
        libraryID: params.libraryID,
        limit: params.limit,
      });
    } else {
      papersResult = await this.zoteroGateway.listLibraryPaperTargets({
        libraryID: params.libraryID,
        limit: params.limit,
      });
    }
    let papers = papersResult.papers;
    if (filters.author) {
      const authorLower = filters.author.toLowerCase();
      papers = papers.filter(
        (p) => p.firstCreator?.toLowerCase().includes(authorLower),
      );
    }
    if (filters.yearFrom != null || filters.yearTo != null) {
      papers = papers.filter((p) => {
        const y = parseInt(p.year || "", 10);
        if (isNaN(y)) return false;
        if (filters.yearFrom != null && y < filters.yearFrom) return false;
        if (filters.yearTo != null && y > filters.yearTo) return false;
        return true;
      });
    }
    const enriched = papers.map((paper) =>
      enrichPaperTarget(paper, this.zoteroGateway, params.include),
    );
    return {
      results: enriched,
      totalCount: papers.length,
      warnings,
    };
  }

  async searchItems(params: {
    libraryID: number;
    text: string;
    limit?: number;
    include?: QueryLibraryInclude[];
    excludeContextItemId?: number | null;
  }): Promise<{
    results: EnrichedSearchResult[];
    warnings: string[];
  }> {
    const results = await this.zoteroGateway.searchLibraryItems({
      libraryID: params.libraryID,
      query: params.text,
      excludeContextItemId: params.excludeContextItemId,
      limit: params.limit,
    });
    const targetMap = new Map(
      this.zoteroGateway
        .getPaperTargetsByItemIds(results.map((entry) => entry.itemId))
        .map((target) => [target.itemId, target] as const),
    );
    return {
      results: results.map((result) =>
        mergeSearchResult(
          result,
          targetMap.get(result.itemId) || null,
          this.zoteroGateway,
          params.include,
        ),
      ),
      warnings: [],
    };
  }

  async findRelatedItems(params: {
    libraryID: number;
    referenceItemId: number;
    limit?: number;
    include?: QueryLibraryInclude[];
  }): Promise<{
    referenceTitle: string;
    results: Array<
      RelatedPaperResult & {
        metadata?: EditableArticleMetadataSnapshot | null;
        collections?: CollectionSummary[];
      }
    >;
    warnings: string[];
  }> {
    const result = await this.zoteroGateway.findRelatedPapersInLibrary({
      libraryID: params.libraryID,
      referenceItemId: params.referenceItemId,
      limit: params.limit,
    });
    return {
      referenceTitle: result.referenceTitle,
      results: result.relatedPapers.map((paper) => ({
        ...paper,
        metadata: includeField(params.include, "metadata")
          ? this.zoteroGateway.getEditableArticleMetadata(
              this.zoteroGateway.getItem(paper.itemId),
            )
          : undefined,
        collections: includeField(params.include, "collections")
          ? buildCollectionSummaries(this.zoteroGateway, paper.collectionIds)
          : undefined,
      })),
      warnings: [],
    };
  }

  async detectDuplicates(params: {
    libraryID: number;
    limit?: number;
    include?: QueryLibraryInclude[];
  }): Promise<{
    totalGroups: number;
    results: Array<
      DuplicateGroup & {
        papers: Array<
          DuplicateGroup["papers"][number] & {
            metadata?: EditableArticleMetadataSnapshot | null;
            collections?: CollectionSummary[];
          }
        >;
      }
    >;
    warnings: string[];
  }> {
    const result = await this.zoteroGateway.detectDuplicatesInLibrary({
      libraryID: params.libraryID,
      limit: params.limit,
    });
    return {
      totalGroups: result.totalGroups,
      results: result.groups.map((group) => ({
        ...group,
        papers: group.papers.map((paper) => ({
          ...paper,
          metadata: includeField(params.include, "metadata")
            ? this.zoteroGateway.getEditableArticleMetadata(
                this.zoteroGateway.getItem(paper.itemId),
              )
            : undefined,
          collections: includeField(params.include, "collections")
            ? buildCollectionSummaries(this.zoteroGateway, paper.collectionIds)
            : undefined,
        })),
      })),
      warnings: [],
    };
  }

  async browseCollectionTree(params: {
    libraryID: number;
  }): Promise<{
    libraryID: number;
    libraryName: string;
    collections: CollectionBrowseNode[];
    unfiled: { name: string; paperCount: number };
  }> {
    return this.zoteroGateway.browseCollections({
      libraryID: params.libraryID,
    });
  }
}
