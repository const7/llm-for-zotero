/**
 * Skill intent classifier — runs ONCE per user turn.
 *
 * Architecture note: when the user sends a message, this module is called
 * exactly once (before the agent loop starts) to decide which skills apply.
 * The returned skill IDs flow into the system prompt, and that system prompt
 * is reused across every model inference the agent performs to fulfil the
 * request. There is no per-model-call classifier cost.
 *
 * The classifier uses the user's configured primary model (via
 * `request.model` / `request.apiBase` / `request.apiKey`) and a small
 * structured prompt listing each skill's `id` + `description`. On any error
 * — network failure, malformed JSON, unconfigured model — it falls back to
 * the per-skill regex `match:` patterns so the agent still works.
 */
import { callLLM } from "../../utils/llmClient";
import { matchesSkill } from "../skills/skillLoader";
import type { AgentSkill } from "../skills/skillLoader";
import type { AgentRuntimeRequest } from "../types";

/**
 * Classify which skills apply to the given request.
 *
 * Returns a list of skill IDs drawn from `skills`. Never throws — any
 * failure falls back to regex matching.
 */
export async function detectSkillIntent(
  request: AgentRuntimeRequest,
  skills: AgentSkill[],
  signal?: AbortSignal,
): Promise<string[]> {
  if (skills.length === 0) return [];
  const userText = (request.userText || "").trim();
  if (!userText) return regexFallback(skills, request);
  if (!request.model || !request.apiBase) {
    return regexFallback(skills, request);
  }

  const prompt = buildClassifierPrompt(skills, request);

  let raw: string;
  try {
    raw = await callLLM({
      prompt,
      model: request.model,
      apiBase: request.apiBase,
      apiKey: request.apiKey,
      authMode: request.authMode,
      providerProtocol: request.providerProtocol,
      temperature: 0,
      maxTokens: 200,
      signal,
    });
  } catch (err) {
    Zotero.debug?.(
      `[llm-for-zotero] Skill classifier LLM call failed, falling back to regex: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return regexFallback(skills, request);
  }

  const parsed = parseClassifierResponse(raw, skills);
  if (parsed === null) {
    Zotero.debug?.(
      `[llm-for-zotero] Skill classifier returned malformed JSON, falling back to regex. Raw: ${raw.slice(0, 200)}`,
    );
    return regexFallback(skills, request);
  }
  return parsed;
}

function regexFallback(
  skills: AgentSkill[],
  request: Pick<AgentRuntimeRequest, "userText">,
): string[] {
  return skills
    .filter((skill) => matchesSkill(skill, request))
    .map((skill) => skill.id);
}

function buildClassifierPrompt(
  skills: AgentSkill[],
  request: AgentRuntimeRequest,
): string {
  const skillList = skills
    .map((skill) => `- ${skill.id}: ${skill.description || "(no description)"}`)
    .join("\n");

  const context: string[] = [];
  context.push(
    request.activeItemId
      ? "- Active paper: yes (paper-chat mode)"
      : "- Active paper: no (library-chat mode)",
  );
  if (request.activeNoteContext) context.push("- Active note present: yes");
  if (request.selectedTexts?.length)
    context.push(`- Selected text snippets: ${request.selectedTexts.length}`);
  if (request.screenshots?.length)
    context.push(`- Screenshots attached: ${request.screenshots.length}`);
  if (request.fullTextPaperContexts?.length)
    context.push(
      `- Full-text papers marked: ${request.fullTextPaperContexts.length}`,
    );

  return [
    "You are a skill router for a Zotero research-assistant agent. Given the user's message and the available skills below, return the IDs of every skill that applies. Multiple IDs are fine when several are relevant. Return an empty list when none clearly apply.",
    "",
    "Available skills:",
    skillList,
    "",
    "Runtime context:",
    ...context,
    "",
    "User message:",
    `"""`,
    request.userText,
    `"""`,
    "",
    'Reply with ONLY a JSON object in this exact shape, no prose, no code fences: {"skillIds": ["id1", "id2"]}',
  ].join("\n");
}

/**
 * Parse the classifier's response into a list of valid skill IDs.
 * Returns null if the response cannot be interpreted (caller falls back).
 */
export function parseClassifierResponse(
  raw: string,
  skills: AgentSkill[],
): string[] | null {
  if (!raw) return null;
  // Tolerate code fences or surrounding prose — extract the first {…} blob.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const ids = (parsed as { skillIds?: unknown }).skillIds;
  if (!Array.isArray(ids)) return null;
  const validIds = new Set(skills.map((s) => s.id));
  return ids
    .filter((value): value is string => typeof value === "string")
    .filter((id) => validIds.has(id));
}
