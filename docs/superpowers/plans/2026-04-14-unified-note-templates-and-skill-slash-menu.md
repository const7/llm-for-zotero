# Unified Note Templates & Skill Slash Menu

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the "Obsidian Integration" note template system into the skill framework so templates work for both Zotero notes and file-based notes, add `name`/`description` metadata to skills, and surface all skills in the `/` slash menu with System/Personal badges.

**Architecture:** Skills gain two new frontmatter fields (`name`, `description`) for display. The Obsidian note template moves from Zotero prefs into the skill file body, while the vault path config is rebranded as "Notes Directory." The slash menu renders a "Skills" section sourced from `getAllSkills()`, with force-activation bypassing regex matching when a skill is selected from the menu.

**Tech Stack:** TypeScript, XUL/XHTML (Zotero 7 Gecko runtime), CSS

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/agent/skills/skillLoader.ts` | Parse `name:` and `description:` frontmatter fields |
| Modify | `src/agent/skills/index.ts` | Track builtin filenames for System/Personal badge |
| Modify | `src/agent/skills/userSkills.ts` | Tag loaded skills with `builtin` flag; update template scaffold |
| Modify | `src/agent/skills/write-to-obsidian.md` | Rename to generic note-to-file; embed template inline; add `name`/`description` |
| Modify | `src/agent/skills/note-from-paper.md` | Add `name`/`description` frontmatter |
| Modify | `src/agent/skills/note-editing.md` | Add `name`/`description` frontmatter |
| Modify | All other built-in skill `.md` files | Add `name`/`description` frontmatter |
| Modify | `src/agent/model/messageBuilder.ts` | Replace `buildObsidianConfigSection()` with `buildNotesDirectorySection()`; support forced skill IDs |
| Modify | `src/agent/types.ts` | Add `forcedSkillIds?: string[]` to `AgentRequest` |
| Modify | `src/utils/obsidianConfig.ts` | Rename exports to generic "notes directory" naming; remove template-related functions |
| Modify | `addon/content/preferences.xhtml` | Rebrand "Obsidian Integration" → "Notes Directory"; remove template textarea |
| Modify | `src/modules/preferenceScript.ts` | Update wiring for rebranded settings |
| Modify | `src/modules/contextPanel/buildUI.ts` | Add "Skills" section to slash menu DOM |
| Modify | `src/modules/contextPanel/setupHandlers.ts` | Render skills in slash menu; handle skill selection → force activation |
| Modify | `src/modules/contextPanel/chat.ts` | Pass `forcedSkillIds` through `buildAgentRuntimeRequest` |
| Modify | `src/modules/contextPanel/types.ts` | Add `forcedSkillIds` to `SendQuestionOptions` |
| Modify | `addon/content/zoteroPane.css` | Style for skill items (description + badge) |

---

### Task 1: Extend Skill Frontmatter with `name` and `description`

**Files:**
- Modify: `src/agent/skills/skillLoader.ts:19-73`

- [ ] **Step 1: Update the `AgentSkill` type**

In `src/agent/skills/skillLoader.ts`, add `name`, `description`, and `builtin` fields to the type:

```typescript
export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  patterns: RegExp[];
  instruction: string;
  builtin: boolean;
};
```

- [ ] **Step 2: Parse `name:` and `description:` in `parseSkill()`**

In the `parseSkill()` function, after the existing `id` and `match` parsing loop (lines 55-68), add parsing for the two new fields. Update the return to include defaults:

```typescript
export function parseSkill(raw: string): AgentSkill {
  const lines = raw.split("\n");
  let inFrontmatter = false;
  let frontmatterEnd = 0;
  const fmLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      }
      frontmatterEnd = i + 1;
      break;
    }
    if (inFrontmatter) {
      fmLines.push(trimmed);
    }
  }

  let id = "unknown";
  let name = "";
  let description = "";
  const patterns: RegExp[] = [];

  for (const line of fmLines) {
    const idMatch = line.match(/^id:\s*(.+)$/);
    if (idMatch) {
      id = idMatch[1].trim();
      continue;
    }
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      name = nameMatch[1].trim();
      continue;
    }
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) {
      description = descMatch[1].trim();
      continue;
    }
    const matchMatch = line.match(/^match:\s*\/(.+)\/([gimsuy]*)$/);
    if (matchMatch) {
      try {
        patterns.push(new RegExp(matchMatch[1], matchMatch[2]));
      } catch {
        // Skip invalid regex
      }
    }
  }

  const instruction = lines.slice(frontmatterEnd).join("\n").trim();

  // Default name from id if not provided
  if (!name) {
    name = id
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return { id, name, description, patterns, instruction, builtin: false };
}
```

- [ ] **Step 3: Verify the parser handles all cases**

Build the project to confirm there are no type errors:

```bash
cd /Users/yat-lok/workspace/llm-for-zotero && npm run build
```

Expected: Build succeeds (there will be type errors in downstream files referencing `AgentSkill` without `builtin` — those are addressed in Task 2).

- [ ] **Step 4: Commit**

```bash
git add src/agent/skills/skillLoader.ts
git commit -m "feat: add name, description, builtin fields to AgentSkill type"
```

---

### Task 2: Tag Built-in Skills and Update Skill Index

**Files:**
- Modify: `src/agent/skills/index.ts`
- Modify: `src/agent/skills/userSkills.ts:137-195`

- [ ] **Step 1: Export the built-in filename set from `index.ts`**

In `src/agent/skills/index.ts`, add an exported set of built-in filenames so `userSkills.ts` can tag loaded skills:

```typescript
/** Set of filenames that are built-in (shipped with the plugin). */
export const BUILTIN_SKILL_FILENAMES = new Set(Object.keys(BUILTIN_SKILL_FILES));
```

- [ ] **Step 2: Tag skills with `builtin` flag in `loadUserSkills()`**

In `src/agent/skills/userSkills.ts`, import `BUILTIN_SKILL_FILENAMES` and set the `builtin` flag after parsing each skill. The `filePath` from `getChildren()` is an absolute path, so extract the filename:

```typescript
import { BUILTIN_SKILL_FILES, BUILTIN_SKILL_FILENAMES } from "./index";
```

In the `loadUserSkills()` function, after `const skill = parseSkill(raw);`, add:

```typescript
// Tag as builtin if the filename matches a shipped skill
const filename = filePath.split(/[/\\]/).pop() || "";
skill.builtin = BUILTIN_SKILL_FILENAMES.has(filename);
```

- [ ] **Step 3: Update the skill template scaffold in `createSkillTemplate()`**

In `src/agent/skills/userSkills.ts`, update the template string in `createSkillTemplate()` to include the new fields:

```typescript
const template = `---
id: my-custom-skill
name: My Custom Skill
description: Describe what this skill does
match: /your regex pattern here/i
---

Describe when and how the agent should behave when this skill matches.
`;
```

- [ ] **Step 4: Build and verify**

```bash
cd /Users/yat-lok/workspace/llm-for-zotero && npm run build
```

Expected: Build succeeds with no type errors related to `AgentSkill`.

- [ ] **Step 5: Commit**

```bash
git add src/agent/skills/index.ts src/agent/skills/userSkills.ts
git commit -m "feat: tag skills with builtin flag, export BUILTIN_SKILL_FILENAMES"
```

---

### Task 3: Add `name` and `description` to All Built-in Skill Files

**Files:**
- Modify: `src/agent/skills/write-to-obsidian.md`
- Modify: `src/agent/skills/note-from-paper.md`
- Modify: `src/agent/skills/note-editing.md`
- Modify: `src/agent/skills/literature-review.md`
- Modify: `src/agent/skills/analyze-figures.md`
- Modify: `src/agent/skills/simple-paper-qa.md`
- Modify: `src/agent/skills/evidence-based-qa.md`
- Modify: `src/agent/skills/compare-papers.md`
- Modify: `src/agent/skills/library-analysis.md`
- Modify: `src/agent/skills/import-cited-reference.md`

Add `name:` and `description:` lines to the frontmatter of each skill file, right after the `id:` line.

- [ ] **Step 1: Update `write-to-obsidian.md`**

Also rename the id and add generic trigger patterns so it activates on "save note to file" without requiring the word "obsidian". Keep old patterns for backward compat. Embed the default template inline in the instruction body instead of referencing the system prompt config.

Change the frontmatter to:

```markdown
---
id: note-to-file
name: Save Note to File
description: Write notes to a local directory as Markdown, Org-mode, or any text format
match: /\b(write|save|export|send)\b.*\bobsidian\b/i
match: /\bobsidian\b.*\b(note|write|save|export)\b/i
match: /\bto\s+obsidian\b/i
match: /\bobsidian\b.*\bvault\b/i
match: /\b(save|write|export)\b.*\bnote\b.*\b(to\s+)?(file|disk|local|directory|folder)\b/i
match: /\b(note|notes?)\b.*\b(to\s+)?(file|disk|local|directory|folder)\b/i
---
```

Update the instruction body: replace all references to "Obsidian" with generic language. Change the "Prerequisites" section to reference "Notes directory configuration" instead of "Obsidian vault path." Add a "Default template" section that embeds the template inline:

```markdown
## Writing Notes to File

When the user asks to write, save, or export a note to a local file, follow this workflow.
This skill is content-agnostic — it works for any note type: single paper summary, literature review, multi-paper comparison, research notes, or free-form writing.

### Prerequisites
- The user's notes directory path and default folder are provided in the system prompt under "Notes directory configuration". If missing, tell the user to configure the notes directory in the plugin preferences (Settings > Agent tab).
- The default folder is used when the user doesn't specify a folder. If the user specifies a different folder, write there instead.

### Default template (use unless the user has customized this skill)
```
---
title: "{{title}}"
date: {{date}}
tags: [zotero]
---

# {{title}}

{{content}}

---
*Written by LLM-for-Zotero*
```
If this skill has been customized by the user, use their template above instead.
```

Keep the rest of the Recipe (Steps 1-5) and Key rules sections, but change "Obsidian vault" references to "notes directory" and "vault path" to "notes directory path." Change `[@citekey]` instruction to: "Use Pandoc citation syntax `[@citekey]` for references when writing Markdown. Adapt citation syntax to the target format (e.g., `[cite:@citekey]` for Org-mode)."

- [ ] **Step 2: Rename the file**

```bash
cd /Users/yat-lok/workspace/llm-for-zotero
git mv src/agent/skills/write-to-obsidian.md src/agent/skills/note-to-file.md
```

- [ ] **Step 3: Update imports in `index.ts`**

In `src/agent/skills/index.ts`:

Replace:
```typescript
import writeToObsidianRaw from "./write-to-obsidian.md";
```
With:
```typescript
import noteToFileRaw from "./note-to-file.md";
```

And in `BUILTIN_SKILL_FILES`, replace:
```typescript
"write-to-obsidian.md": writeToObsidianRaw,
```
With:
```typescript
"note-to-file.md": noteToFileRaw,
```

- [ ] **Step 4: Update `note-from-paper.md`**

Add after `id:`:
```markdown
name: Reading Notes
description: Create reading notes from a paper with optional figures
```

- [ ] **Step 5: Update `note-editing.md`**

Add after `id:`:
```markdown
name: Edit Note
description: Create, edit, or append to Zotero notes
```

- [ ] **Step 6: Update `literature-review.md`**

Add after `id:`:
```markdown
name: Literature Review
description: Structured scientific review with thematic synthesis and citations
```

- [ ] **Step 7: Update `analyze-figures.md`**

Add after `id:`:
```markdown
name: Analyze Figures
description: Analyze figures, tables, and diagrams from papers using MinerU cache
```

- [ ] **Step 8: Update `simple-paper-qa.md`**

Add after `id:`:
```markdown
name: Paper Q&A
description: Answer general questions about a paper with minimal tool calls
```

- [ ] **Step 9: Update `evidence-based-qa.md`**

Add after `id:`:
```markdown
name: Evidence-Based Q&A
description: Answer specific questions with targeted evidence retrieval from papers
```

- [ ] **Step 10: Update `compare-papers.md`**

Add after `id:`:
```markdown
name: Compare Papers
description: Compare multiple papers by theme, methodology, or findings
```

- [ ] **Step 11: Update `library-analysis.md`**

Add after `id:`:
```markdown
name: Library Analysis
description: Analyze your whole library or collection with statistics and breakdowns
```

- [ ] **Step 12: Update `import-cited-reference.md`**

Add after `id:`:
```markdown
name: Import References
description: Import cited papers into your Zotero library by DOI or reference number
```

- [ ] **Step 13: Build and verify**

```bash
cd /Users/yat-lok/workspace/llm-for-zotero && npm run build
```

Expected: Build succeeds.

- [ ] **Step 14: Commit**

```bash
git add src/agent/skills/
git commit -m "feat: add name/description to all skills; rename write-to-obsidian to note-to-file"
```

---

### Task 4: Rebrand Settings — "Obsidian Integration" → "Notes Directory"

**Files:**
- Modify: `src/utils/obsidianConfig.ts`
- Modify: `addon/content/preferences.xhtml:244-411`
- Modify: `src/modules/preferenceScript.ts:1801-1898`
- Modify: `src/agent/model/messageBuilder.ts:241-264`

- [ ] **Step 1: Rename config functions in `obsidianConfig.ts`**

The pref keys stay the same (for backward compat with existing user data), but rename the exported functions. Remove the template-related functions since the template now lives in the skill file:

```typescript
import { config } from "../../package.json";

// Pref keys unchanged for backward compat with existing user data
const NOTES_DIR_PATH_KEY = `${config.prefsPrefix}.obsidianVaultPath`;
const NOTES_DIR_FOLDER_KEY = `${config.prefsPrefix}.obsidianTargetFolder`;
const NOTES_DIR_ATTACHMENTS_KEY = `${config.prefsPrefix}.obsidianAttachmentsFolder`;

export function getNotesDirectoryPath(): string {
  const value = Zotero.Prefs.get(NOTES_DIR_PATH_KEY, true);
  return typeof value === "string" ? value : "";
}

export function setNotesDirectoryPath(value: string): void {
  Zotero.Prefs.set(NOTES_DIR_PATH_KEY, value, true);
}

export function getNotesDirectoryFolder(): string {
  const value = Zotero.Prefs.get(NOTES_DIR_FOLDER_KEY, true);
  return typeof value === "string" ? value : "Zotero Notes";
}

export function setNotesDirectoryFolder(value: string): void {
  Zotero.Prefs.set(NOTES_DIR_FOLDER_KEY, value, true);
}

export function getNotesDirectoryAttachmentsFolder(): string {
  const value = Zotero.Prefs.get(NOTES_DIR_ATTACHMENTS_KEY, true);
  return typeof value === "string" ? value : "assets";
}

export function setNotesDirectoryAttachmentsFolder(value: string): void {
  Zotero.Prefs.set(NOTES_DIR_ATTACHMENTS_KEY, value, true);
}

export function isNotesDirectoryConfigured(): boolean {
  return getNotesDirectoryPath().trim().length > 0;
}

// ── Backward-compat aliases (used by old imports until fully migrated) ────
export const getObsidianVaultPath = getNotesDirectoryPath;
export const setObsidianVaultPath = setNotesDirectoryPath;
export const getObsidianTargetFolder = getNotesDirectoryFolder;
export const setObsidianTargetFolder = setNotesDirectoryFolder;
export const getObsidianAttachmentsFolder = getNotesDirectoryAttachmentsFolder;
export const setObsidianAttachmentsFolder = setNotesDirectoryAttachmentsFolder;
export const isObsidianConfigured = isNotesDirectoryConfigured;
```

- [ ] **Step 2: Update `messageBuilder.ts` — replace `buildObsidianConfigSection()`**

Replace `buildObsidianConfigSection()` with `buildNotesDirectorySection()`. Remove the template injection (it now comes from the skill). Update the imports at the top of the file.

```typescript
function buildNotesDirectorySection(): string {
  if (!isNotesDirectoryConfigured()) return "";
  const dirPath = getNotesDirectoryPath();
  const targetFolder = getNotesDirectoryFolder();
  const attachmentsFolder = getNotesDirectoryAttachmentsFolder();
  const defaultTargetPath = targetFolder
    ? joinLocalPath(dirPath, targetFolder)
    : dirPath;
  return [
    "Notes directory configuration (user-configured):",
    `- Directory path: ${dirPath}`,
    `- Default folder: ${targetFolder}`,
    `- Default target path: ${defaultTargetPath}`,
    `- Attachments folder: ${attachmentsFolder} (subfolder for copied figures and images)`,
  ].join("\n");
}
```

In `buildAgentInitialMessages()`, update the section id:

```typescript
{
  id: "notes-directory-config",
  lines: [buildNotesDirectorySection()],
},
```

Update the imports at the top:
- Remove: `getObsidianVaultPath`, `getObsidianTargetFolder`, `getObsidianAttachmentsFolder`, `getObsidianNoteTemplate`, `getDefaultObsidianNoteTemplate`, `isObsidianConfigured`
- Add: `getNotesDirectoryPath`, `getNotesDirectoryFolder`, `getNotesDirectoryAttachmentsFolder`, `isNotesDirectoryConfigured`

- [ ] **Step 3: Update `preferences.xhtml` — rebrand the UI card**

In `addon/content/preferences.xhtml`, lines 244-411, update:

1. Card header: `"Obsidian Integration"` → `"Notes Directory"`
2. Description text: `"Write notes from your Zotero papers directly to your Obsidian vault. Configure the vault path and default folder below."` → `"Configure a local directory for saving notes as files. Used by the 'Save Note to File' skill and any custom note skills you create."`
3. "Vault Path" label → `"Notes Directory Path"`
4. Placeholder: `"/path/to/vault or C:\path\to\vault"` → `"/path/to/notes or C:\path\to\notes"`
5. Help text: `"Absolute path to your Obsidian vault folder"` → `"Absolute path to the directory where notes are saved as files"`
6. Keep "Default Folder" and "Attachments Folder" fields as-is (labels are already generic enough).
7. Remove the entire "Note Template" `<html:div>` block (lines 364-409) — the `<textarea>`, the help text, and the "Reset to Default" button.
8. Update "Test Write Access" to say "Test Write Access" (unchanged — already generic).

- [ ] **Step 4: Update `preferenceScript.ts` — remove template wiring**

In `src/modules/preferenceScript.ts`, lines 1801-1898:

1. Update the querySelector IDs — they stay the same (element IDs reference `addonRef` which is unchanged in the XHTML).
2. Replace `getObsidianVaultPath`/`setObsidianVaultPath` with `getNotesDirectoryPath`/`setNotesDirectoryPath` (or use the compat aliases).
3. Replace `getObsidianTargetFolder`/`setObsidianTargetFolder` with `getNotesDirectoryFolder`/`setNotesDirectoryFolder`.
4. Replace `getObsidianAttachmentsFolder`/`setObsidianAttachmentsFolder` with `getNotesDirectoryAttachmentsFolder`/`setNotesDirectoryAttachmentsFolder`.
5. Remove the `obsTemplateInput`, `obsResetTemplateBtn` wiring blocks (lines ~1809-1854 that reference the template textarea and reset button).
6. Update imports at the top of the file.

- [ ] **Step 5: Build and verify**

```bash
cd /Users/yat-lok/workspace/llm-for-zotero && npm run build
```

Expected: Build succeeds. Search for any remaining references to removed functions:

```bash
grep -r "getObsidianNoteTemplate\|getDefaultObsidianNoteTemplate\|setObsidianNoteTemplate" src/
```

Expected: No matches (all references should be removed).

- [ ] **Step 6: Commit**

```bash
git add src/utils/obsidianConfig.ts src/agent/model/messageBuilder.ts addon/content/preferences.xhtml src/modules/preferenceScript.ts
git commit -m "feat: rebrand Obsidian Integration to Notes Directory; move template to skill"
```

---

### Task 5: Add `forcedSkillIds` to the Agent Request Pipeline

**Files:**
- Modify: `src/agent/types.ts:13-31`
- Modify: `src/agent/model/messageBuilder.ts:192-216`
- Modify: `src/modules/contextPanel/types.ts:254-282`
- Modify: `src/modules/contextPanel/chat.ts:2718-2750`
- Modify: `src/modules/contextPanel/agentMode/agentEngine.ts:262-274`

This task threads a `forcedSkillIds` field from the UI through to the system prompt builder so that skills selected from the slash menu bypass regex matching.

- [ ] **Step 1: Add `forcedSkillIds` to `AgentRequest`**

In `src/agent/types.ts`, add to the `AgentRequest` type:

```typescript
export type AgentRequest = {
  conversationKey: number;
  mode: "agent";
  userText: string;
  activeItemId?: number;
  selectedTexts?: string[];
  selectedTextSources?: SelectedTextSource[];
  selectedPaperContexts?: PaperContextRef[];
  fullTextPaperContexts?: PaperContextRef[];
  pinnedPaperContexts?: PaperContextRef[];
  attachments?: ChatAttachment[];
  screenshots?: string[];
  /** Skill IDs to force-activate regardless of regex matching (from slash menu selection). */
  forcedSkillIds?: string[];
  model?: string;
  // ... rest unchanged
};
```

- [ ] **Step 2: Update `collectGuidanceInstructions` to honor forced skills**

In `src/agent/model/messageBuilder.ts`, modify `collectGuidanceInstructions()`:

```typescript
function collectGuidanceInstructions(
  request: AgentRuntimeRequest,
  tools: AgentToolDefinition<any, any>[],
): string[] {
  const instructions = new Set<string>();
  for (const tool of tools) {
    const guidance = tool.guidance;
    if (!guidance) continue;
    if (!guidance.matches(request)) continue;
    const instruction = guidance.instruction.trim();
    if (instruction) instructions.add(instruction);
  }

  const forcedIds = new Set(request.forcedSkillIds || []);

  for (const skill of getAllSkills()) {
    // Activate if regex matches OR if force-activated from slash menu
    if (!forcedIds.has(skill.id) && !matchesSkill(skill, request)) continue;
    const instruction = skill.instruction.trim();
    if (instruction) instructions.add(instruction);
  }
  if (!instructions.size) return [];
  return [
    "The following tool guidance is provided because the user's message may be relevant to these capabilities. " +
      "Use your judgement: only invoke a tool if it directly addresses what the user is asking for. " +
      "Do NOT invoke a tool just because its guidance appears here — the user's actual intent takes priority.",
    ...instructions,
  ];
}
```

- [ ] **Step 3: Add `forcedSkillIds` to `SendQuestionOptions`**

In `src/modules/contextPanel/types.ts`, add to `SendQuestionOptions`:

```typescript
/** Skill IDs force-activated via slash menu selection. */
forcedSkillIds?: string[];
```

- [ ] **Step 4: Thread `forcedSkillIds` through `sendAgentQuestion`**

In `src/modules/contextPanel/chat.ts`:

Update the `sendAgentQuestion` function signature to include `forcedSkillIds`:
```typescript
async function sendAgentQuestion(opts: {
  // ... existing fields ...
  forcedSkillIds?: string[];
}): Promise<void> {
```

In `buildAgentRuntimeRequest`, add:
```typescript
async function buildAgentRuntimeRequest(
  params: BuildAgentRuntimeRequestParams,
): Promise<AgentRuntimeRequest> {
  // ... existing code ...
  return {
    // ... existing fields ...
    forcedSkillIds: params.forcedSkillIds,
    activeNoteContext: buildActiveNoteRuntimeContext(params.item),
  };
}
```

Update `BuildAgentRuntimeRequestParams` (or its shape type) to include `forcedSkillIds?: string[]`.

- [ ] **Step 5: Thread through the agent engine**

In `src/modules/contextPanel/agentMode/agentEngine.ts`, the `BuildAgentRuntimeRequestParamsShape` type and the call at line 262 need `forcedSkillIds`. Add `forcedSkillIds?: string[]` to the shape type, and in the `sendAgentTurn` function where `buildAgentRuntimeRequest` is called, pass it:

```typescript
const runtimeRequest = await deps.buildAgentRuntimeRequest({
  // ... existing fields ...
  forcedSkillIds: opts.forcedSkillIds,
});
```

Update `sendAgentTurn`'s `opts` type to include `forcedSkillIds?: string[]`.

- [ ] **Step 6: Thread through `sendQuestion` in `chat.ts`**

In the `sendQuestion` function, pass `forcedSkillIds` to `sendAgentQuestion`:

```typescript
if (runtimeMode === "agent" && !skipAgentDispatch) {
  await sendAgentQuestion({
    // ... existing fields ...
    forcedSkillIds: opts.forcedSkillIds,
  });
  return;
}
```

- [ ] **Step 7: Build and verify**

```bash
cd /Users/yat-lok/workspace/llm-for-zotero && npm run build
```

Expected: Build succeeds. The field flows from `SendQuestionOptions` → `sendAgentQuestion` → `sendAgentTurn` → `buildAgentRuntimeRequest` → `AgentRuntimeRequest` → `collectGuidanceInstructions`.

- [ ] **Step 8: Commit**

```bash
git add src/agent/types.ts src/agent/model/messageBuilder.ts src/modules/contextPanel/types.ts src/modules/contextPanel/chat.ts src/modules/contextPanel/agentMode/agentEngine.ts
git commit -m "feat: add forcedSkillIds pipeline for slash-menu skill activation"
```

---

### Task 6: Render Skills in the Slash Menu

**Files:**
- Modify: `src/modules/contextPanel/buildUI.ts:442-489`
- Modify: `src/modules/contextPanel/setupHandlers.ts:7551-7612`
- Modify: `addon/content/zoteroPane.css:5091-5133`

- [ ] **Step 1: Add CSS for skill description and badge**

In `addon/content/zoteroPane.css`, after the existing `.llm-action-picker-title` rule (line ~5129), update the description rule and add a badge rule:

```css
.llm-action-picker-description {
  font-size: var(--llm-fs-11);
  font-weight: 400;
  color: var(--fill-secondary, #888);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-left: 6px;
  flex: 1;
  min-width: 0;
}

.llm-action-picker-badge {
  font-size: calc(10px * var(--llm-font-scale, 1));
  font-weight: 500;
  color: var(--fill-tertiary, #aaa);
  white-space: nowrap;
  margin-left: auto;
  padding-left: 8px;
  flex-shrink: 0;
}
```

Also update `.llm-action-picker-item` to ensure the flex layout accommodates the three elements (title, description, badge):

```css
.llm-action-picker-item {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  font: inherit;
  padding: 5px 8px;
  cursor: pointer;
  outline: none;
  gap: 2px;
}
```

And update `.llm-action-picker-title` to prevent it from taking all horizontal space:

```css
.llm-action-picker-title {
  font-size: var(--llm-fs-12);
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
  max-width: 40%;
}
```

- [ ] **Step 2: Add a `renderSkillsInSlashMenu` function in `setupHandlers.ts`**

In `setupHandlers.ts`, near the existing `renderAgentActionsInSlashMenu` function (line ~7551), add a new function. This function needs access to `getAllSkills` and the slash menu DOM. Add the import at the top of the file:

```typescript
import { getAllSkills } from "../../agent/skills";
```

Then add the function:

```typescript
/** Prepends filtered skills into the slash menu (agent mode only). */
const renderSkillsInSlashMenu = (query: string = "") => {
  // Clear previous skill items
  const list = slashMenu?.querySelector(".llm-action-picker-list");
  if (!list) return;
  const ownerDoc = body.ownerDocument;
  if (!ownerDoc) return;

  // Remove old skill items
  list.querySelectorAll("[data-slash-skill-item]").forEach((el) => el.remove());

  const allSkills = getAllSkills();
  if (!allSkills.length) return;

  const filtered = query
    ? allSkills.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query) ||
          s.id.toLowerCase().includes(query),
      )
    : allSkills;

  if (!filtered.length) return;

  const firstExisting = list.firstChild;

  const mkSkillEl = (tag: string, cls: string): HTMLElement => {
    const el = ownerDoc.createElement(tag);
    el.className = cls;
    el.setAttribute("data-slash-skill-item", "true");
    return el;
  };

  // "Skills" section label
  const sectionLabel = mkSkillEl("div", "llm-slash-menu-section");
  sectionLabel.setAttribute("aria-hidden", "true");
  sectionLabel.textContent = t("Skills");
  list.insertBefore(sectionLabel, firstExisting);

  // Skill items
  filtered.forEach((skill) => {
    const btn = mkSkillEl("button", "llm-action-picker-item") as HTMLButtonElement;
    btn.type = "button";
    btn.title = skill.description || skill.name;

    const titleEl = ownerDoc.createElement("span");
    titleEl.className = "llm-action-picker-title";
    titleEl.textContent = skill.name;

    const descEl = ownerDoc.createElement("span");
    descEl.className = "llm-action-picker-description";
    descEl.textContent = skill.description;

    const badgeEl = ownerDoc.createElement("span");
    badgeEl.className = "llm-action-picker-badge";
    badgeEl.textContent = skill.builtin ? t("System") : t("Personal");

    btn.append(titleEl, descEl, badgeEl);

    btn.addEventListener("click", (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      consumeActiveActionToken();
      closeSlashMenu();
      handleSkillSelection(skill);
    });

    list.insertBefore(btn, firstExisting);
  });
};
```

- [ ] **Step 3: Implement `handleSkillSelection`**

When a user selects a skill from the slash menu, the skill's instruction should be force-activated for the next message. Store the selected skill ID and inject it when the user sends their message.

Add state and handler near the `activeCommandAction` state (line ~7325):

```typescript
/** The skill ID force-selected from the slash menu, if any. */
let forcedSkillId: string | null = null;

/** Badge element for the forced skill, rendered in the compose area. */
let forcedSkillBadge: HTMLElement | null = null;

const clearForcedSkill = (): void => {
  forcedSkillId = null;
  if (forcedSkillBadge) {
    forcedSkillBadge.remove();
    forcedSkillBadge = null;
  }
  inputBox.style.textIndent = "";
  if (inputBox.dataset.originalPlaceholder !== undefined) {
    inputBox.placeholder = inputBox.dataset.originalPlaceholder;
    delete inputBox.dataset.originalPlaceholder;
  }
};

const handleSkillSelection = (skill: AgentSkill): void => {
  clearForcedSkill();
  clearCommandChip();
  forcedSkillId = skill.id;

  // Ensure agent mode
  if (getCurrentRuntimeMode() !== "agent" && getAgentModeEnabled()) {
    setCurrentRuntimeMode("agent");
  }

  const ownerDoc = body.ownerDocument;
  const composeArea = inputBox.closest(".llm-compose-area") || inputBox.parentElement;
  if (!ownerDoc || !composeArea) return;

  // Render inline badge (same pattern as insertCommandToken)
  const badge = ownerDoc.createElement("div");
  badge.className = "llm-command-inline";
  badge.title = skill.description || skill.name;
  badge.textContent = `/${skill.id}`;

  const cs = ownerDoc.defaultView?.getComputedStyle(inputBox);
  const padTop = cs ? parseFloat(cs.paddingTop) : 12;
  const padLeft = cs ? parseFloat(cs.paddingLeft) : 14;
  const borderTop = cs ? parseFloat(cs.borderTopWidth) : 1;
  const borderLeft = cs ? parseFloat(cs.borderLeftWidth) : 1;
  badge.style.top = `${inputBox.offsetTop + borderTop + padTop}px`;
  badge.style.left = `${inputBox.offsetLeft + borderLeft + padLeft}px`;
  composeArea.appendChild(badge);
  forcedSkillBadge = badge;

  const badgeWidth = badge.offsetWidth;
  inputBox.style.textIndent = `${badgeWidth + 6}px`;

  if (inputBox.dataset.originalPlaceholder === undefined) {
    inputBox.dataset.originalPlaceholder = inputBox.placeholder;
  }
  inputBox.placeholder = skill.description || "";
  inputBox.value = "";
  inputBox.focus({ preventScroll: true });
  const EvtCtor = (inputBox.ownerDocument?.defaultView as any)?.Event ?? Event;
  inputBox.dispatchEvent(new EvtCtor("input", { bubbles: true }));
};
```

Add the `AgentSkill` type import at the top of the file:

```typescript
import type { AgentSkill } from "../../agent/skills/skillLoader";
```

- [ ] **Step 4: Wire skill selection into the send flow**

In the `executeSend` function (line ~9228), before the existing `chipAction` check, add forced skill handling. The `forcedSkillId` is consumed and passed through `doSend`:

Find the section:
```typescript
const chipAction = getActiveCommandAction();
if (chipAction) {
```

Add before it:
```typescript
// Consume forced skill from slash menu selection
const pendingForcedSkillId = forcedSkillId;
if (pendingForcedSkillId) {
  clearForcedSkill();
}
```

Then thread it into `doSend`. The `doSend` function is created by `createSendFlowController`, which calls `deps.sendQuestion(...)`. We need to add `forcedSkillIds` to that call.

In `src/modules/contextPanel/setupHandlers/controllers/sendFlowController.ts`, add a `getForcedSkillIds` dependency:

```typescript
// In SendFlowControllerDeps type:
getForcedSkillIds?: () => string[] | undefined;
consumeForcedSkillIds?: () => string[] | undefined;
```

In the `doSend` function of `sendFlowController.ts`, just before the `sendQuestion` call (line ~480):

```typescript
const forcedSkillIds = deps.consumeForcedSkillIds?.();
```

And pass it into `deps.sendQuestion({...})`:
```typescript
forcedSkillIds,
```

Back in `setupHandlers.ts` where `createSendFlowController` is called (line ~8742), provide the deps:

```typescript
consumeForcedSkillIds: () => {
  if (!forcedSkillId) return undefined;
  const ids = [forcedSkillId];
  clearForcedSkill();
  return ids;
},
```

- [ ] **Step 5: Call `renderSkillsInSlashMenu` from `scheduleActionPickerTrigger`**

In the `scheduleActionPickerTrigger` function (line ~7101), call `renderSkillsInSlashMenu` alongside `renderAgentActionsInSlashMenu`:

```typescript
if (getCurrentRuntimeMode() === "agent") {
  const query = token.query.toLowerCase().trim();
  renderSkillsInSlashMenu(query);
  renderAgentActionsInSlashMenu(query);
}
```

Skills should appear first (before agent actions) since they are prepended before existing items.

- [ ] **Step 6: Clear forced skill on Backspace/Escape**

In the existing keyboard handler for the input box, where `clearCommandChip()` is called on Backspace (when the input is empty and a chip is active), add the same for `forcedSkillBadge`:

Find the Backspace handler and add:
```typescript
if (forcedSkillId && !inputBox.value) {
  clearForcedSkill();
  e.preventDefault();
  return;
}
```

- [ ] **Step 7: Build and verify**

```bash
cd /Users/yat-lok/workspace/llm-for-zotero && npm run build
```

Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add addon/content/zoteroPane.css src/modules/contextPanel/buildUI.ts src/modules/contextPanel/setupHandlers.ts src/modules/contextPanel/setupHandlers/controllers/sendFlowController.ts
git commit -m "feat: render skills in slash menu with System/Personal badges and force-activation"
```

---

### Task 7: Handle Backward Compatibility for Existing Users

**Files:**
- Modify: `src/agent/skills/userSkills.ts:84-125`

Existing users already have `write-to-obsidian.md` in their skills directory. After this update, the plugin ships `note-to-file.md` as a new built-in. We need to handle the transition so users don't end up with both a stale `write-to-obsidian.md` AND a new `note-to-file.md`.

- [ ] **Step 1: Add migration logic in `initUserSkills()`**

In `src/agent/skills/userSkills.ts`, add a migration step in `initUserSkills()` after the directory existence check and before the seeding loop:

```typescript
// ── Migration: write-to-obsidian.md → note-to-file.md ──────────────
// If the user has the old write-to-obsidian.md (seeded by a prior version)
// and does NOT have note-to-file.md yet, rename the old file and update
// the seeded set. If they've customized the old file, keep it as-is
// (they'll get both — the old one with their customizations, and the new
// built-in default next time initUserSkills runs).
try {
  const oldPath = joinLocalPath(dir, "write-to-obsidian.md");
  const newPath = joinLocalPath(dir, "note-to-file.md");
  const oldExists = await io.exists(oldPath);
  const newExists = await io.exists(newPath);

  if (oldExists && !newExists) {
    // Read old file to check if user customized it
    const oldData = await io.read!(oldPath);
    const oldBytes = oldData instanceof Uint8Array ? oldData : new Uint8Array(oldData as ArrayBuffer);
    const oldContent = new TextDecoder("utf-8").decode(oldBytes);

    // Check if the old file still has the original id (not user-customized)
    if (/^id:\s*write-to-obsidian\s*$/m.test(oldContent)) {
      // Not customized — safe to remove and let the new one be seeded
      await io.remove!(oldPath);
      Zotero.debug?.("[llm-for-zotero] Removed old write-to-obsidian.md (migrated to note-to-file.md)");
    }
    // If customized (different id or content), leave both — user keeps their version
  }

  // Clean up seeded tracking
  if (seeded.has("write-to-obsidian.md")) {
    seeded.delete("write-to-obsidian.md");
  }
} catch (err) {
  Zotero.debug?.(`[llm-for-zotero] Skill migration warning: ${err instanceof Error ? err.message : String(err)}`);
}
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/yat-lok/workspace/llm-for-zotero && npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/agent/skills/userSkills.ts
git commit -m "feat: add migration from write-to-obsidian.md to note-to-file.md"
```

---

### Task 8: Update Matched Skill Trace Events

**Files:**
- Modify: `src/agent/skills/index.ts:75-81`

The `getMatchedSkillIds` function is used for trace events. It should also report force-activated skills.

- [ ] **Step 1: Update `getMatchedSkillIds` to accept forced IDs**

```typescript
export function getMatchedSkillIds(
  request: Pick<import("../types").AgentRuntimeRequest, "userText" | "forcedSkillIds">,
): string[] {
  const forcedIds = new Set(request.forcedSkillIds || []);
  return getAllSkills()
    .filter((skill) => forcedIds.has(skill.id) || matchesSkill(skill, request))
    .map((skill) => skill.id);
}
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/yat-lok/workspace/llm-for-zotero && npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/agent/skills/index.ts
git commit -m "feat: include force-activated skills in trace events"
```

---

### Task 9: End-to-End Verification

- [ ] **Step 1: Full build**

```bash
cd /Users/yat-lok/workspace/llm-for-zotero && npm run build
```

Expected: Clean build with no errors.

- [ ] **Step 2: Search for stale references**

```bash
cd /Users/yat-lok/workspace/llm-for-zotero
grep -r "write-to-obsidian" src/ addon/ --include="*.ts" --include="*.xhtml" --include="*.css"
grep -r "getDefaultObsidianNoteTemplate\|setObsidianNoteTemplate\|getObsidianNoteTemplate\|OBSIDIAN_NOTE_TEMPLATE_KEY" src/
grep -r "obsidian-note-template\|obsidian-reset-template" addon/
```

Expected: No matches for any of these patterns (all references should be updated or removed).

- [ ] **Step 3: Verify skill frontmatter parsing**

Manually inspect that each built-in skill `.md` file has valid `name:` and `description:` lines by reviewing the files:

```bash
grep -A1 "^name:" src/agent/skills/*.md
grep -A1 "^description:" src/agent/skills/*.md
```

Expected: All 10 skill files have both fields.

- [ ] **Step 4: Test in Zotero**

1. Install the built plugin in Zotero.
2. Open the chat panel → type `/` → verify the "Skills" section appears with all skills listed.
3. Verify each skill shows: name, description (truncated), System/Personal badge.
4. Filter by typing `/read` — should filter to "Reading Notes" and any matching skills.
5. Select a skill → verify the inline badge appears → type a message → verify the skill activates.
6. Go to Settings > Agent tab → verify the card says "Notes Directory" (not "Obsidian Integration").
7. Verify the note template textarea is gone.
8. Configure a notes directory path → test write access → verify it works.
9. In chat, type "save this note to file" (without saying "obsidian") → verify the note-to-file skill activates.
10. Type "save to obsidian" → verify it still activates (backward compat patterns).

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```
