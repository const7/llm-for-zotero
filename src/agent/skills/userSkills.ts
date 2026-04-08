/**
 * Skills — runtime loading from the Zotero data directory.
 *
 * The user's skills directory is the sole source of truth. Built-in skills
 * are copied there on first run (or when new ones are added in updates).
 * Users can create, edit, or delete `.md` skill files freely.
 */
import { parseSkill } from "./skillLoader";
import type { AgentSkill } from "./skillLoader";
import { BUILTIN_SKILL_FILES } from "./index";

const USER_SKILLS_DIR_NAME = "llm-for-zotero/skills";

// ---------------------------------------------------------------------------
// Gecko runtime helpers (mirrors patterns from mineruCache.ts)
// ---------------------------------------------------------------------------

type PathUtilsLike = {
  join?: (...parts: string[]) => string;
};

type IOUtilsLike = {
  exists?: (path: string) => Promise<boolean>;
  read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  write?: (path: string, data: Uint8Array) => Promise<number>;
  makeDirectory?: (
    path: string,
    options?: { createAncestors?: boolean; ignoreExisting?: boolean },
  ) => Promise<void>;
  getChildren?: (path: string) => Promise<string[]>;
  remove?: (path: string) => Promise<void>;
};

function getPathUtils(): PathUtilsLike | undefined {
  return (globalThis as { PathUtils?: PathUtilsLike }).PathUtils;
}

function getIOUtils(): IOUtilsLike | undefined {
  return (globalThis as unknown as { IOUtils?: IOUtilsLike }).IOUtils;
}

function joinPath(...parts: string[]): string {
  const pathUtils = getPathUtils();
  if (pathUtils?.join) return pathUtils.join(...parts);
  return parts
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? part.replace(/[\\/]+$/, "")
        : part.replace(/^[\\/]+|[\\/]+$/g, ""),
    )
    .join("/");
}

function getBaseDir(): string {
  const zotero = Zotero as unknown as {
    DataDirectory?: { dir?: string };
    Profile?: { dir?: string };
  };
  const dataDir = zotero.DataDirectory?.dir;
  if (typeof dataDir === "string" && dataDir.trim()) return dataDir.trim();
  const profileDir = zotero.Profile?.dir;
  if (typeof profileDir === "string" && profileDir.trim())
    return profileDir.trim();
  throw new Error("Cannot resolve Zotero data directory for user skills");
}

/** Returns the directory path where user skill files are stored. */
export function getUserSkillsDir(): string {
  return joinPath(getBaseDir(), USER_SKILLS_DIR_NAME);
}

// ---------------------------------------------------------------------------
// Initialization — copy missing built-in skills to user folder
// ---------------------------------------------------------------------------

/**
 * Ensure the user skills directory exists and contains all built-in skills.
 * Missing built-in files are copied; existing files are never overwritten.
 * Call this before loadUserSkills().
 */
export async function initUserSkills(): Promise<void> {
  const io = getIOUtils();
  if (!io?.exists || !io?.write || !io?.makeDirectory) return;

  const dir = getUserSkillsDir();

  try {
    const exists = await io.exists(dir);
    if (!exists) {
      await io.makeDirectory(dir, {
        createAncestors: true,
        ignoreExisting: true,
      });
    }
  } catch {
    return;
  }

  const encoder = new TextEncoder();

  for (const [filename, content] of Object.entries(BUILTIN_SKILL_FILES)) {
    const filePath = joinPath(dir, filename);
    try {
      const exists = await io.exists(filePath);
      if (!exists) {
        await io.write(filePath, encoder.encode(content));
        Zotero.debug?.(
          `[llm-for-zotero] Copied built-in skill to user folder: ${filename}`,
        );
      }
    } catch (err) {
      Zotero.debug?.(
        `[llm-for-zotero] Failed to copy built-in skill ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Scan the user skills directory for `.md` files and parse them.
 * This is the sole source of skills — all skills come from the user folder.
 * Returns an empty array if the directory does not exist or no valid
 * skill files are found. Never throws.
 */
export async function loadUserSkills(): Promise<AgentSkill[]> {
  const io = getIOUtils();
  if (!io?.exists || !io?.read || !io?.getChildren) return [];

  const dir = getUserSkillsDir();

  try {
    const exists = await io.exists(dir);
    if (!exists) return [];
  } catch {
    return [];
  }

  // List .md files
  let entries: string[];
  try {
    entries = await io.getChildren(dir);
  } catch {
    return [];
  }

  const mdFiles = entries.filter((entry) => entry.endsWith(".md"));
  if (mdFiles.length === 0) return [];

  const skills: AgentSkill[] = [];

  for (const filePath of mdFiles) {
    try {
      const data = await io.read(filePath);
      const bytes =
        data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
      const raw = new TextDecoder("utf-8").decode(bytes);

      const skill = parseSkill(raw);

      // Validate: must have a real id and at least one pattern
      if (skill.id === "unknown" || skill.patterns.length === 0) {
        Zotero.debug?.(
          `[llm-for-zotero] Skipping invalid skill file (missing id or match patterns): ${filePath}`,
        );
        continue;
      }

      skills.push(skill);
    } catch (err) {
      Zotero.debug?.(
        `[llm-for-zotero] Error loading skill file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (skills.length > 0) {
    Zotero.debug?.(
      `[llm-for-zotero] Loaded ${skills.length} skill(s) from ${dir}`,
    );
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Skill file management (used by the skills popup UI)
// ---------------------------------------------------------------------------

/** List all .md filenames in the user skills directory. */
export async function listSkillFiles(): Promise<string[]> {
  const io = getIOUtils();
  if (!io?.exists || !io?.getChildren) return [];

  const dir = getUserSkillsDir();
  try {
    const exists = await io.exists(dir);
    if (!exists) return [];
    const entries = await io.getChildren(dir);
    return entries.filter((entry) => entry.endsWith(".md"));
  } catch {
    return [];
  }
}

/** Delete a skill file by its full path. */
export async function deleteSkillFile(filePath: string): Promise<boolean> {
  const io = getIOUtils();
  if (!io?.remove) return false;

  try {
    await io.remove(filePath);
    return true;
  } catch (err) {
    Zotero.debug?.(
      `[llm-for-zotero] Failed to delete skill file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Create a new skill template file and return its full path.
 * Auto-generates a unique filename (custom-skill-1.md, custom-skill-2.md, ...).
 */
export async function createSkillTemplate(): Promise<string | null> {
  const io = getIOUtils();
  if (!io?.exists || !io?.write) return null;

  const dir = getUserSkillsDir();
  const encoder = new TextEncoder();
  const template = `---
id: my-custom-skill
match: /your regex pattern here/i
---

Describe when and how the agent should behave when this skill matches.
`;

  let index = 1;
  let filePath: string;
  // Find the next available filename
  // eslint-disable-next-line no-constant-condition
  while (true) {
    filePath = joinPath(dir, `custom-skill-${index}.md`);
    try {
      const exists = await io.exists(filePath);
      if (!exists) break;
    } catch {
      break;
    }
    index++;
    if (index > 999) return null; // safety limit
  }

  try {
    await io.write(filePath, encoder.encode(template));
    return filePath;
  } catch (err) {
    Zotero.debug?.(
      `[llm-for-zotero] Failed to create skill template: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
