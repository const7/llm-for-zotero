import {
  normalizeProviderProtocolForAuthMode,
  supportsProviderProtocolFileInputs,
} from "../../../utils/providerProtocol";
import type { AgentToolDefinition } from "../../types";
import {
  isExplicitWholeDocumentRequest,
  type PdfPageService,
} from "../../services/pdfPageService";
import {
  buildPdfToolSchemaProperties,
  parsePdfTargetArgs,
  type PdfTargetArgs,
} from "./pdfToolShared";
import { fail, ok } from "../shared";

type PreparedFileCache = {
  contextItemId?: number;
  expiresAt: number;
};

const fileCache = new Map<number, PreparedFileCache>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCachedFile(conversationKey: number): PreparedFileCache | null {
  const entry = fileCache.get(conversationKey);
  if (!entry || Date.now() > entry.expiresAt) {
    fileCache.delete(conversationKey);
    return null;
  }
  return entry;
}

function setCachedFile(conversationKey: number, contextItemId?: number): void {
  fileCache.set(conversationKey, {
    contextItemId,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function clearPreparePdfFileCache(conversationKey: number): void {
  fileCache.delete(conversationKey);
}

function supportsNativePdfInput(params: {
  providerProtocol?: string;
  apiBase?: string;
  authMode?: string;
}): boolean {
  const protocol = normalizeProviderProtocolForAuthMode({
    protocol: params.providerProtocol,
    authMode: params.authMode,
    apiBase: params.apiBase,
  });
  return supportsProviderProtocolFileInputs(protocol);
}

export function createPreparePdfFileForModelTool(
  pdfPageService: PdfPageService,
): AgentToolDefinition<PdfTargetArgs, unknown> {
  return {
    spec: {
      name: "prepare_pdf_file_for_model",
      description:
        "Prepare a whole PDF file for direct model input. This is an advanced path for file-input capable models only. For most \"whole PDF\" requests you should instead use prepare_pdf_pages_for_model with scope:\"whole_document\" so the model receives page images.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: buildPdfToolSchemaProperties(),
      },
      mutability: "read",
      requiresConfirmation: true,
    },
    presentation: {
      label: "Prepare PDF File",
      summaries: {
        onCall: "Preparing the full PDF for direct model reading",
        onPending: "Waiting for your approval before sending the whole PDF",
        onApproved: "Approval received - sending the whole PDF",
        onDenied: "Whole-PDF send cancelled",
        onSuccess: "Prepared the whole PDF for direct model reading",
      },
    },
    validate: (args) => {
      const parsed = parsePdfTargetArgs(args);
      if (!parsed.ok) return parsed;
      return ok({
        ...parsed.value,
        scope: "whole_document" as const,
      });
    },
    shouldRequireConfirmation: async (_input, context) => {
      // Reject immediately if the model/auth does not support native file input
      // so the agent gets a useful error before we do any file I/O.
      if (
        !supportsNativePdfInput({
          providerProtocol: context.request.providerProtocol,
          apiBase: context.request.apiBase,
          authMode: context.request.authMode,
        })
      ) {
        throw new Error(
          "Whole-document PDF input is not supported by this model/provider. " +
            "Use prepare_pdf_pages_for_model to send specific pages as images instead.",
        );
      }
      return getCachedFile(context.request.conversationKey) === null;
    },
    createPendingAction: async (input, context) => {
      const prepared = await pdfPageService.preparePdfFileForModel({
        request: context.request,
        paperContext: input.paperContext,
        itemId: input.itemId,
        contextItemId: input.contextItemId,
        attachmentId: input.attachmentId,
        name: input.name,
      });
      return {
        toolName: "prepare_pdf_file_for_model",
        title: `Send whole PDF — ${prepared.target.title}`,
        description:
          "The entire PDF file will be sent to the model. Use this only when full-document inspection is necessary.",
        confirmLabel: "Send to model",
        cancelLabel: "Cancel",
        fields: [],
      };
    },
    execute: async (input, context) => {
      if (
        !supportsNativePdfInput({
          providerProtocol: context.request.providerProtocol,
          apiBase: context.request.apiBase,
          authMode: context.request.authMode,
        })
      ) {
        throw new Error(
          "Whole-document PDF input is only available on file-input capable models. Use page images instead for this model.",
        );
      }
      if (!isExplicitWholeDocumentRequest(context.request.userText)) {
        throw new Error(
          "Whole-document PDF input is only allowed when the user explicitly asks to inspect the entire PDF or document.",
        );
      }
      const prepared = await pdfPageService.preparePdfFileForModel({
        request: context.request,
        paperContext: input.paperContext,
        itemId: input.itemId,
        contextItemId: input.contextItemId,
        attachmentId: input.attachmentId,
        name: input.name,
      });
      setCachedFile(context.request.conversationKey, prepared.target.contextItemId);
      return {
        content: {
          target: {
            source: prepared.target.source,
            title: prepared.target.title,
            paperContext: prepared.target.paperContext,
            contextItemId: prepared.target.contextItemId,
            itemId: prepared.target.itemId,
          },
          transport: "native_pdf_file",
          scope: "whole_document",
        },
        artifacts: [prepared.artifact],
      };
    },
  };
}
