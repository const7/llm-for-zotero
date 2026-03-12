import type { AgentAction, ActionExecutionContext, ActionResult } from "./types";
import { callTool } from "./executor";

type LiteratureReviewInput = {
  topic: string;
  source?: "openalex" | "arxiv" | "europepmc";
  limit?: number;
  targetCollectionId?: number;
  /** If true, reads imported papers and saves a synthesis note. */
  synthesize?: boolean;
};

type LiteratureReviewOutput = {
  discovered: number;
  imported: number;
  noteId?: number;
};

/**
 * Searches for literature on a topic, lets the user select papers to import,
 * and optionally generates a synthesis note from the imported papers.
 */
export const literatureReviewAction: AgentAction<LiteratureReviewInput, LiteratureReviewOutput> = {
  name: "literature_review",
  description:
    "Search for academic literature on a topic, review the results, import selected papers, " +
    "and optionally save a synthesis note. Uses OpenAlex, arXiv, or Europe PMC as the source.",
  inputSchema: {
    type: "object",
    required: ["topic"],
    additionalProperties: false,
    properties: {
      topic: {
        type: "string",
        description: "The research topic or query to search for.",
      },
      source: {
        type: "string",
        enum: ["openalex", "arxiv", "europepmc"],
        description: "Search source. Default: openalex.",
      },
      limit: {
        type: "number",
        description: "Max number of results to return. Default: 10.",
      },
      targetCollectionId: {
        type: "number",
        description: "If set, imported papers are added to this collection.",
      },
      synthesize: {
        type: "boolean",
        description: "If true, saves a synthesis note after import. Default: false.",
      },
    },
  },

  async execute(
    input: LiteratureReviewInput,
    ctx: ActionExecutionContext,
  ): Promise<ActionResult<LiteratureReviewOutput>> {
    const STEPS = 2 + (input.synthesize ? 2 : 0);
    let step = 0;

    // Step 1: search literature online
    ctx.onProgress({
      type: "step_start",
      step: "Searching literature",
      index: ++step,
      total: STEPS,
    });

    const searchResult = await callTool(
      "search_literature_online",
      {
        mode: "search",
        query: input.topic,
        source: input.source || "openalex",
        limit: input.limit || 10,
        libraryID: ctx.libraryID,
      },
      ctx,
      `Searching for "${input.topic}"`,
    );

    if (!searchResult.ok) {
      return {
        ok: false,
        error: `Search failed: ${JSON.stringify(searchResult.content)}`,
      };
    }

    // Parse paper results
    const searchContent = searchResult.content as Record<string, unknown>;
    const rawResults = Array.isArray(searchContent.results) ? searchContent.results : [];

    type PaperRow = {
      id: string;
      title: string;
      subtitle?: string;
      badges?: string[];
      href?: string;
      importIdentifier?: string;
    };

    const paperRows: PaperRow[] = rawResults
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r, i) => {
        const title = typeof r.title === "string" ? r.title : `Result ${i + 1}`;
        const authors = Array.isArray(r.authors)
          ? r.authors.filter((a): a is string => typeof a === "string").slice(0, 3).join(", ")
          : "";
        const year = r.year ? String(r.year) : "";
        const subtitle = [year, authors].filter(Boolean).join(" · ") || undefined;
        const doi =
          typeof r.doi === "string" && r.doi.trim()
            ? r.doi.trim().replace(/^https?:\/\/doi\.org\//i, "")
            : null;
        const arxivMatch =
          typeof r.sourceUrl === "string"
            ? /arxiv\.org\/abs\/([\d.]+)/i.exec(r.sourceUrl)?.[1]
            : null;
        const importIdentifier = doi?.startsWith("10.") ? doi : arxivMatch ? `arxiv:${arxivMatch}` : undefined;
        const badges: string[] = [];
        if (typeof r.citationCount === "number") badges.push(`${r.citationCount} citations`);
        if (doi) badges.push(`DOI: ${doi}`);
        return {
          id: `paper-${i + 1}`,
          title,
          subtitle,
          badges: badges.length ? badges : undefined,
          href: typeof r.openAccessUrl === "string" ? r.openAccessUrl : undefined,
          importIdentifier,
        };
      });

    ctx.onProgress({
      type: "step_done",
      step: "Searching literature",
      summary: `Found ${paperRows.length} result${paperRows.length === 1 ? "" : "s"}`,
    });

    if (!paperRows.length) {
      return { ok: true, output: { discovered: 0, imported: 0 } };
    }

    // Step 2: present HITL paper selection card, then import selected
    ctx.onProgress({
      type: "step_start",
      step: "Reviewing and importing papers",
      index: ++step,
      total: STEPS,
    });

    const requestId = `literature-review-${Date.now()}`;
    const reviewCard = {
      toolName: "literature_review",
      mode: "review" as const,
      title: `Literature results for "${input.topic}"`,
      description: "Select the papers you want to import into your Zotero library.",
      confirmLabel: "Import selected",
      cancelLabel: "Cancel",
      actions: [
        { id: "import", label: "Import selected", style: "primary" as const },
        { id: "cancel", label: "Cancel", style: "secondary" as const },
      ],
      defaultActionId: "import",
      cancelActionId: "cancel",
      fields: [
        {
          type: "paper_result_list" as const,
          id: "selectedPaperIds",
          label: "Search results",
          rows: paperRows.map((p) => ({ ...p, checked: true })),
          minSelectedByAction: [{ actionId: "import", min: 1 }],
        },
      ],
    };

    const resolution = await ctx.requestConfirmation(requestId, reviewCard);

    if (!resolution.approved || resolution.actionId === "cancel") {
      return { ok: true, output: { discovered: paperRows.length, imported: 0 } };
    }

    // Extract selected paper identifiers
    const data = (resolution.data || {}) as Record<string, unknown>;
    const selectedIds = Array.isArray(data.selectedPaperIds)
      ? (data.selectedPaperIds as string[])
      : paperRows.map((p) => p.id); // default: all checked

    const selectedPapers = paperRows.filter((p) => selectedIds.includes(p.id));
    const identifiers = Array.from(
      new Set(
        selectedPapers
          .map((p) => p.importIdentifier)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (!identifiers.length) {
      return { ok: true, output: { discovered: paperRows.length, imported: 0 } };
    }

    const importOperations: Array<Record<string, unknown>> = [
      {
        type: "import_identifiers",
        identifiers,
        libraryID: ctx.libraryID,
      },
    ];

    if (input.targetCollectionId) {
      importOperations[0].collectionId = input.targetCollectionId;
    }

    const importResult = await callTool(
      "mutate_library",
      { operations: importOperations },
      ctx,
      "Importing papers",
    );

    const importContent = importResult.content as Record<string, unknown>;
    const importResults = Array.isArray(importContent.results) ? importContent.results : [];
    const importedItemIds: number[] = importResults
      .map((r: unknown) => {
        if (r && typeof r === "object") {
          const record = r as Record<string, unknown>;
          return typeof record.itemId === "number" ? record.itemId : null;
        }
        return null;
      })
      .filter((id): id is number => id !== null);

    const importedCount = importResult.ok ? (importedItemIds.length || identifiers.length) : 0;

    ctx.onProgress({
      type: "step_done",
      step: "Reviewing and importing papers",
      summary: `Imported ${importedCount} paper${importedCount === 1 ? "" : "s"}`,
    });

    let noteId: number | undefined;

    if (input.synthesize && importedCount > 0) {
      // Step 3: read imported papers
      ctx.onProgress({
        type: "step_start",
        step: "Reading imported papers",
        index: ++step,
        total: STEPS,
      });

      const readResult = await callTool(
        "read_library",
        {
          itemIds: importedItemIds,
          sections: ["metadata"],
        },
        ctx,
        "Reading imported papers",
      );

      ctx.onProgress({ type: "step_done", step: "Reading imported papers" });

      // Step 4: save synthesis note
      ctx.onProgress({
        type: "step_start",
        step: "Saving synthesis note",
        index: ++step,
        total: STEPS,
      });

      const readContent = readResult.ok
        ? (readResult.content as Record<string, Record<string, unknown>>)
        : {};

      const noteLines = [
        `## Literature Review: ${input.topic}`,
        ``,
        `*Source: ${input.source || "openalex"} | Query: "${input.topic}"*`,
        ``,
        `### Imported Papers`,
      ];

      for (const [, entry] of Object.entries(readContent)) {
        if (!entry || typeof entry !== "object") continue;
        const meta = entry.metadata as Record<string, unknown> | null | undefined;
        if (!meta) continue;
        const title = typeof meta.title === "string" ? meta.title : "Untitled";
        const year = typeof meta.date === "string" ? meta.date.slice(0, 4) : "";
        const doi = typeof meta.DOI === "string" ? meta.DOI : "";
        noteLines.push(`- **${title}**${year ? ` (${year})` : ""}${doi ? ` — DOI: ${doi}` : ""}`);
      }

      const saveResult = await callTool(
        "mutate_library",
        {
          operations: [
            {
              type: "save_note",
              content: noteLines.join("\n"),
              target: "standalone",
            },
          ],
        },
        ctx,
        "Saving synthesis note",
      );

      if (saveResult.ok) {
        const saveContent = saveResult.content as Record<string, unknown>;
        const results = Array.isArray(saveContent.results) ? saveContent.results : [];
        const first = results[0] as Record<string, unknown> | undefined;
        noteId = typeof first?.noteId === "number" ? first.noteId : undefined;
      }

      ctx.onProgress({ type: "step_done", step: "Saving synthesis note" });
    }

    return {
      ok: true,
      output: {
        discovered: paperRows.length,
        imported: importedCount,
        noteId,
      },
    };
  },
};
