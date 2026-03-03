import { callLLM } from "../../../../utils/llmClient";
import { estimateTextTokens } from "../../../../utils/modelInputCap";
import { pdfTextCache } from "../../state";
import {
  buildTruncatedFullPaperContext,
  ensurePDFTextCached,
} from "../../pdfContext";
import { createNoteFromAssistantText } from "../../notes";
import { validateSinglePaperToolCall } from "./shared";
import type {
  AgentToolCall,
  AgentToolExecutionContext,
  AgentToolExecutionResult,
  ResolvedAgentToolTarget,
} from "../types";

/** Approximate token budget for the paper context fed to the note writer. */
const NOTE_PAPER_CONTEXT_TOKENS = 6000;
/** Approximate token budget for the note generation output. */
const NOTE_MAX_OUTPUT_TOKENS = 1200;

export function validateWriteNoteCall(call: AgentToolCall): AgentToolCall | null {
  const validated = validateSinglePaperToolCall("write_note", call);
  if (!validated) return null;
  // validateSinglePaperToolCall only returns {name, target} — preserve query
  const query = (call.query || "").trim();
  return query ? { ...validated, query } : validated;
}

export async function executeWriteNoteCall(
  ctx: AgentToolExecutionContext,
  call: AgentToolCall,
  target: ResolvedAgentToolTarget,
): Promise<AgentToolExecutionResult> {
  if (!target.paperContext) {
    return {
      name: "write_note",
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
    { maxTokens: NOTE_PAPER_CONTEXT_TOKENS },
  );

  // Use the planner-supplied query as the note content instruction.
  // The planner is responsible for extracting the content spec from ctx.question
  // and stripping agent-directive phrases like "into the note" / "save to Zotero".
  // If no query was provided, fall back to the default structured template.
  const topicFocus = (call.query || "").trim();

  // NOTE: `context` in ChatParams is rendered as "Document Context:" — it does
  // NOT override the global system prompt.  Put formatting instructions directly
  // in the user `prompt` so the model sees them as the primary task request.
  const userPrompt = topicFocus
    ? [
        "TASK: " + topicFocus,
        "Follow the task instruction exactly. Do not add extra sections, headings, or content beyond what the task asks for.",
        "",
        "Paper:",
        fullPaper.text,
      ].join("\n")
    : [
        "Write a structured research note for the following paper with these sections: Summary, Key Findings, Methodology, Limitations, Notes.",
        "",
        "Paper:",
        fullPaper.text,
      ].join("\n");

  let noteContent: string;
  try {
    noteContent = await callLLM({
      prompt: userPrompt,
      model: ctx.model,
      apiBase: ctx.apiBase,
      apiKey: ctx.apiKey,
      maxTokens: NOTE_MAX_OUTPUT_TOKENS,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      name: "write_note",
      targetLabel: target.targetLabel,
      ok: false,
      traceLines: [`Note generation failed for ${target.targetLabel}: ${errMsg}`],
      groundingText: "",
      addedPaperContexts: [],
      estimatedTokens: 0,
      truncated: false,
    };
  }

  // Persist the note to Zotero
  const parentItem = Zotero.Items.get(target.paperContext.itemId) as Zotero.Item | false;
  if (!parentItem) {
    return {
      name: "write_note",
      targetLabel: target.targetLabel,
      ok: false,
      traceLines: [`Could not resolve parent item for ${target.targetLabel}; note was not saved.`],
      groundingText: "",
      addedPaperContexts: [],
      estimatedTokens: 0,
      truncated: false,
    };
  }

  let saveOutcome: "created" | "appended";
  try {
    saveOutcome = await createNoteFromAssistantText(
      parentItem,
      noteContent,
      ctx.model || "agent",
    );
  } catch (saveErr) {
    const errMsg = saveErr instanceof Error ? saveErr.message : String(saveErr);
    return {
      name: "write_note",
      targetLabel: target.targetLabel,
      ok: false,
      traceLines: [`Note was generated but could not be saved for ${target.targetLabel}: ${errMsg}`],
      groundingText: "",
      addedPaperContexts: [],
      estimatedTokens: 0,
      truncated: false,
    };
  }

  const groundingLines = [
    "Agent Tool Result",
    "- Tool: write_note",
    `- Target: ${target.targetLabel}`,
    `- Note ${saveOutcome} in Zotero`,
    topicFocus ? `- Topic focus: ${topicFocus}` : "",
    "",
    `A note was saved to Zotero for ${target.targetLabel}. Tell the user exactly what was written to the note, quoting the note content below verbatim:`,
    "",
    noteContent,
  ].filter((line) => line !== "");

  const groundingText = groundingLines.join("\n");
  const estimatedTokens = estimateTextTokens(groundingText);

  return {
    name: "write_note",
    targetLabel: target.targetLabel,
    ok: true,
    traceLines: [`Note written for ${target.targetLabel}.`],
    groundingText,
    addedPaperContexts: [target.paperContext],
    estimatedTokens,
    truncated: false,
  };
}
