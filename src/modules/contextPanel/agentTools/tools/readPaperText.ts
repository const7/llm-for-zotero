import { pdfTextCache } from "../../state";
import {
  buildTruncatedFullPaperContext,
  ensurePDFTextCached,
} from "../../pdfContext";
import type {
  AgentToolCall,
  AgentToolExecutionContext,
  AgentToolExecutionResult,
  AgentToolTarget,
  ResolvedAgentToolTarget,
} from "../types";

function normalizeTarget(target: AgentToolTarget | undefined): AgentToolTarget | null {
  if (!target) return null;
  switch (target.scope) {
    case "active-paper":
      return { scope: "active-paper" };
    case "selected-paper":
    case "pinned-paper":
    case "recent-paper":
    case "retrieved-paper": {
      const parsed = Math.floor(Number(target.index));
      if (!Number.isFinite(parsed) || parsed < 1) return null;
      return { scope: target.scope, index: parsed };
    }
    default:
      return null;
  }
}

export function validateReadPaperTextCall(
  call: AgentToolCall,
): AgentToolCall | null {
  if (call.name !== "read_paper_text") return null;
  const normalizedTarget = normalizeTarget(call.target);
  if (!normalizedTarget) return null;
  return {
    name: "read_paper_text",
    target: normalizedTarget,
  };
}

export async function executeReadPaperTextCall(
  ctx: AgentToolExecutionContext,
  _call: AgentToolCall,
  target: ResolvedAgentToolTarget,
): Promise<AgentToolExecutionResult> {
  if (!target.paperContext) {
    return {
      name: "read_paper_text",
      targetLabel: target.targetLabel,
      ok: false,
      traceLines: [target.error || `Tool target was unavailable: ${target.targetLabel}.`],
      groundingText: "",
      addedPaperContexts: [],
      estimatedTokens: 0,
      truncated: false,
    };
  }

  if (target.contextItem) {
    await ensurePDFTextCached(target.contextItem);
  }
  const pdfContext = target.contextItem
    ? pdfTextCache.get(target.contextItem.id)
    : undefined;
  const fullPaper = buildTruncatedFullPaperContext(
    target.paperContext,
    pdfContext,
    {
      maxTokens:
        Number.isFinite(ctx.toolTokenCap) && Number(ctx.toolTokenCap) > 0
          ? Math.max(1, Math.floor(Number(ctx.toolTokenCap)))
          : Number.MAX_SAFE_INTEGER,
    },
  );
  const extractable = Boolean(pdfContext?.chunks.length);
  const groundingLines = [
    "Agent Tool Result",
    "- Tool: read_paper_text",
    `- Target: ${target.targetLabel}`,
    `- Extractable full text available: ${extractable ? "yes" : "no"}`,
    `- Returned full text excerpt: ${extractable && fullPaper.text.includes("Paper Text:") ? "yes" : "no"}`,
    `- Truncated: ${fullPaper.truncated ? "yes" : "no"}`,
    `- Estimated tool tokens: ${fullPaper.estimatedTokens}`,
    "",
    fullPaper.text,
  ];
  const traceLines = [
    extractable
      ? `Loaded full text for ${target.targetLabel}${fullPaper.truncated ? " (truncated by tool budget)." : "."}`
      : `Full text unavailable for ${target.targetLabel}; using metadata only.`,
  ];

  return {
    name: "read_paper_text",
    targetLabel: target.targetLabel,
    ok: true,
    traceLines,
    groundingText: groundingLines.join("\n"),
    addedPaperContexts: [target.paperContext],
    estimatedTokens: fullPaper.estimatedTokens,
    truncated: fullPaper.truncated,
  };
}
