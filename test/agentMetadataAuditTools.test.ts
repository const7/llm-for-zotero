import { assert } from "chai";
import { createAuditArticleMetadataTool } from "../src/agent/tools/read/auditArticleMetadata";
import { createReadPaperFrontMatterTool } from "../src/agent/tools/read/readPaperFrontMatter";
import { createSearchLibraryItemsTool } from "../src/agent/tools/read/searchLibraryItems";
import type { AgentToolContext } from "../src/agent/types";

describe("metadata audit tools", function () {
  const baseContext: AgentToolContext = {
    request: {
      conversationKey: 1,
      mode: "agent",
      userText: "fix the metadata",
      activeItemId: 77,
      libraryID: 1,
    },
    item: null,
    currentAnswerText: "",
    modelName: "gpt-5.4",
  };

  it("search_library_items returns metadata snapshots for matches", async function () {
    const tool = createSearchLibraryItemsTool({
      getItem: (itemId?: number) =>
        itemId ? ({ id: itemId, libraryID: 1 } as never) : null,
      getActiveContextItem: () => ({ id: 501 } as never),
      searchLibraryItems: async () => [
        {
          itemId: 99,
          title: "Example Paper",
          attachments: [],
          score: 1,
          modifiedAt: 0,
        },
      ],
      getEditableArticleMetadata: () => ({
        itemId: 99,
        itemType: "journalArticle",
        title: "Example Paper",
        fields: {
          title: "Example Paper",
          shortTitle: "",
          abstractNote: "",
          publicationTitle: "Cell",
          journalAbbreviation: "",
          proceedingsTitle: "",
          date: "2020-11-25",
          volume: "",
          issue: "",
          pages: "",
          DOI: "10.1016/j.cell.2020.10.024",
          url: "",
          language: "",
          extra: "",
          ISSN: "",
          ISBN: "",
          publisher: "",
          place: "",
        },
        creators: [
          {
            creatorType: "author",
            firstName: "Alice",
            lastName: "Example",
            fieldMode: 0,
          },
        ],
      }),
    } as never);

    const validated = tool.validate({ query: "10.1016/j.cell.2020.10.024" });
    assert.isTrue(validated.ok);
    if (!validated.ok) return;

    const result = await tool.execute(validated.value, baseContext);
    assert.deepEqual((result as { results: Array<{ metadata?: unknown }> }).results[0]?.metadata, {
      itemId: 99,
      itemType: "journalArticle",
      title: "Example Paper",
      fields: {
        title: "Example Paper",
        shortTitle: "",
        abstractNote: "",
        publicationTitle: "Cell",
        journalAbbreviation: "",
        proceedingsTitle: "",
        date: "2020-11-25",
        volume: "",
        issue: "",
        pages: "",
        DOI: "10.1016/j.cell.2020.10.024",
        url: "",
        language: "",
        extra: "",
        ISSN: "",
        ISBN: "",
        publisher: "",
        place: "",
      },
      creators: [
        {
          creatorType: "author",
          firstName: "Alice",
          lastName: "Example",
          fieldMode: 0,
        },
      ],
    });
  });

  it("read_paper_front_matter resolves the active paper context", async function () {
    const tool = createReadPaperFrontMatterTool(
      {
        getPaperContextForItem: () => ({
          itemId: 77,
          contextItemId: 501,
          title: "Example Paper",
        }),
        getFrontMatterExcerpt: async (params: Record<string, unknown>) => ({
          text: "Alice Example\nExample Paper\nCell",
          chunkIndexes: [0, 1],
          totalChunks: 12,
          paperContext: params.paperContext,
        }),
      } as never,
      {
        resolveMetadataItem: () => ({ id: 77 } as never),
      } as never,
    );

    const validated = tool.validate({});
    assert.isTrue(validated.ok);
    if (!validated.ok) return;

    const result = await tool.execute(validated.value, baseContext);
    assert.deepEqual(result, {
      text: "Alice Example\nExample Paper\nCell",
      chunkIndexes: [0, 1],
      totalChunks: 12,
      paperContext: {
        itemId: 77,
        contextItemId: 501,
        title: "Example Paper",
      },
    });
  });

  it("audit_article_metadata suggests a fuller creator list when the current item is incomplete", async function () {
    const currentItem = { id: 77, libraryID: 1 } as never;
    const matchedItem = { id: 99, libraryID: 1 } as never;
    const tool = createAuditArticleMetadataTool(
      {
        resolveMetadataItem: () => currentItem,
        getItem: (itemId?: number) =>
          itemId === 99 ? matchedItem : itemId === 77 ? currentItem : null,
        getEditableArticleMetadata: (item: { id: number } | null | undefined) => {
          if (!item) return null;
          if (item.id === 77) {
            return {
              itemId: 77,
              itemType: "journalArticle",
              title: "Example Paper",
              fields: {
                title: "Example Paper",
                shortTitle: "",
                abstractNote: "",
                publicationTitle: "Cell",
                journalAbbreviation: "",
                proceedingsTitle: "",
                date: "2020-11",
                volume: "",
                issue: "",
                pages: "",
                DOI: "10.1016/j.cell.2020.10.024",
                url: "",
                language: "",
                extra: "",
                ISSN: "",
                ISBN: "",
                publisher: "",
                place: "",
              },
              creators: [
                {
                  creatorType: "author",
                  firstName: "Xiaomin",
                  lastName: "Bao",
                  fieldMode: 0,
                },
              ],
            };
          }
          return {
            itemId: 99,
            itemType: "journalArticle",
            title: "Example Paper",
            fields: {
              title: "Example Paper",
              shortTitle: "",
              abstractNote: "",
              publicationTitle: "Cell",
              journalAbbreviation: "",
              proceedingsTitle: "",
              date: "2020-11-25",
              volume: "",
              issue: "",
              pages: "",
              DOI: "10.1016/j.cell.2020.10.024",
              url: "",
              language: "",
              extra: "",
              ISSN: "0092-8674",
              ISBN: "",
              publisher: "",
              place: "",
            },
            creators: [
              {
                creatorType: "author",
                firstName: "Timothy H.",
                lastName: "Muller",
                fieldMode: 0,
              },
              {
                creatorType: "author",
                firstName: "Xiaomin",
                lastName: "Bao",
                fieldMode: 0,
              },
            ],
          };
        },
        searchLibraryItems: async () => [
          {
            itemId: 77,
            title: "Example Paper",
            attachments: [],
            score: 1,
            modifiedAt: 0,
          },
          {
            itemId: 99,
            title: "Example Paper",
            attachments: [],
            score: 0.98,
            modifiedAt: 0,
          },
        ],
      } as never,
      {
        getPaperContextForItem: () => null,
      } as never,
    );

    const validated = tool.validate({});
    assert.isTrue(validated.ok);
    if (!validated.ok) return;

    const result = await tool.execute(validated.value, baseContext);
    const normalized = result as {
      suggestedPatch: { creators?: Array<{ firstName?: string; lastName?: string }> };
      suggestions: Array<{ field: string; after: string }>;
    };

    assert.lengthOf(normalized.suggestedPatch.creators || [], 2);
    const creatorSuggestion = normalized.suggestions.find(
      (entry) => entry.field === "creators",
    );
    assert.exists(creatorSuggestion);
    assert.include(creatorSuggestion?.after || "", "Timothy H. Muller");
    assert.include(creatorSuggestion?.after || "", "Xiaomin Bao");
  });

  it("audit_article_metadata does not auto-suggest risky fields from a title-only match", async function () {
    const currentItem = { id: 77, libraryID: 1 } as never;
    const matchedItem = { id: 99, libraryID: 1 } as never;
    const tool = createAuditArticleMetadataTool(
      {
        resolveMetadataItem: () => currentItem,
        getItem: (itemId?: number) =>
          itemId === 99 ? matchedItem : itemId === 77 ? currentItem : null,
        getEditableArticleMetadata: (item: { id: number } | null | undefined) => {
          if (!item) return null;
          if (item.id === 77) {
            return {
              itemId: 77,
              itemType: "journalArticle",
              title: "Example Paper",
              fields: {
                title: "Example Paper",
                shortTitle: "",
                abstractNote: "",
                publicationTitle: "Cell",
                journalAbbreviation: "",
                proceedingsTitle: "",
                date: "",
                volume: "",
                issue: "",
                pages: "",
                DOI: "",
                url: "",
                language: "",
                extra: "",
                ISSN: "",
                ISBN: "",
                publisher: "",
                place: "",
              },
              creators: [],
            };
          }
          return {
            itemId: 99,
            itemType: "journalArticle",
            title: "Example Paper",
            fields: {
              title: "Example Paper",
              shortTitle: "",
              abstractNote: "",
              publicationTitle: "Different Journal",
              journalAbbreviation: "",
              proceedingsTitle: "",
              date: "2019-02-10",
              volume: "",
              issue: "",
              pages: "",
              DOI: "",
              url: "https://wrong.example.com",
              language: "",
              extra: "",
              ISSN: "1234-5678",
              ISBN: "",
              publisher: "",
              place: "",
            },
            creators: [
              {
                creatorType: "author",
                firstName: "Alice",
                lastName: "Example",
                fieldMode: 0,
              },
            ],
          };
        },
        searchLibraryItems: async () => [
          {
            itemId: 99,
            title: "Example Paper",
            attachments: [],
            score: 0.95,
            modifiedAt: 0,
          },
        ],
      } as never,
      {
        getPaperContextForItem: () => null,
      } as never,
    );

    const validated = tool.validate({});
    assert.isTrue(validated.ok);
    if (!validated.ok) return;

    const result = await tool.execute(validated.value, baseContext);
    const normalized = result as {
      suggestedPatch: Record<string, unknown>;
      suggestions: Array<{ field: string }>;
    };

    assert.notProperty(normalized.suggestedPatch, "url");
    assert.notProperty(normalized.suggestedPatch, "ISSN");
    assert.notIncludeMembers(
      normalized.suggestions.map((entry) => entry.field),
      ["url", "ISSN"],
    );
  });
});
