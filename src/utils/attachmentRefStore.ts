import {
  ATTACHMENT_BLOBS_TABLE,
  removeAttachmentFile,
} from "../modules/contextPanel/attachmentStorage";

export type AttachmentRefOwnerType = "conversation";

const ATTACHMENT_REFS_TABLE = "llm_for_zotero_attachment_refs";
const TEMP_ATTACHMENT_REFS_TABLE = `${ATTACHMENT_REFS_TABLE}_old`;
const ATTACHMENT_REFS_BLOB_INDEX = "llm_for_zotero_attachment_refs_blob_idx";
export const ATTACHMENT_GC_MIN_AGE_MS = 24 * 60 * 60 * 1000;

let refStoreInitTask: Promise<void> | null = null;

function normalizeOwnerId(ownerId: number): number | null {
  if (!Number.isFinite(ownerId)) return null;
  const normalized = Math.floor(ownerId);
  return normalized > 0 ? normalized : null;
}

function normalizeHashes(hashes: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const raw of hashes) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(trimmed)) continue;
    unique.add(trimmed);
  }
  return Array.from(unique);
}

async function ensureAttachmentRefTables(): Promise<void> {
  if (!refStoreInitTask) {
    refStoreInitTask = (async () => {
      await Zotero.DB.queryAsync(
        `CREATE TABLE IF NOT EXISTS ${ATTACHMENT_BLOBS_TABLE} (
          hash TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          size_bytes INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )`,
      );
      await Zotero.DB.queryAsync(
        `CREATE TABLE IF NOT EXISTS ${ATTACHMENT_REFS_TABLE} (
          owner_type TEXT NOT NULL CHECK(owner_type IN ('conversation')),
          owner_id INTEGER NOT NULL,
          blob_hash TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(owner_type, owner_id, blob_hash)
        )`,
      );
      await rebuildLegacyAttachmentRefsTableIfNeeded();
      await Zotero.DB.queryAsync(
        `CREATE INDEX IF NOT EXISTS ${ATTACHMENT_REFS_BLOB_INDEX}
         ON ${ATTACHMENT_REFS_TABLE} (blob_hash)`,
      );
    })();
  }
  await refStoreInitTask;
}

async function rebuildLegacyAttachmentRefsTableIfNeeded(): Promise<void> {
  const rows = (await Zotero.DB.queryAsync(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    [ATTACHMENT_REFS_TABLE],
  )) as Array<{ sql?: unknown }> | undefined;
  const createSql = typeof rows?.[0]?.sql === "string" ? rows[0].sql : "";
  if (createSql.includes("CHECK(owner_type IN ('conversation'))")) return;

  await Zotero.DB.queryAsync(`DROP INDEX IF EXISTS ${ATTACHMENT_REFS_BLOB_INDEX}`);
  await Zotero.DB.queryAsync(`DROP TABLE IF EXISTS ${TEMP_ATTACHMENT_REFS_TABLE}`);
  await Zotero.DB.queryAsync(
    `ALTER TABLE ${ATTACHMENT_REFS_TABLE}
     RENAME TO ${TEMP_ATTACHMENT_REFS_TABLE}`,
  );
  await Zotero.DB.queryAsync(
    `CREATE TABLE ${ATTACHMENT_REFS_TABLE} (
      owner_type TEXT NOT NULL CHECK(owner_type IN ('conversation')),
      owner_id INTEGER NOT NULL,
      blob_hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(owner_type, owner_id, blob_hash)
    )`,
  );
  await Zotero.DB.queryAsync(
    `INSERT OR REPLACE INTO ${ATTACHMENT_REFS_TABLE}
      (owner_type, owner_id, blob_hash, updated_at)
     SELECT owner_type, owner_id, blob_hash, updated_at
     FROM ${TEMP_ATTACHMENT_REFS_TABLE}
     WHERE owner_type = 'conversation'`,
  );
  await Zotero.DB.queryAsync(`DROP TABLE IF EXISTS ${TEMP_ATTACHMENT_REFS_TABLE}`);
}

async function filterKnownBlobHashes(hashes: string[]): Promise<string[]> {
  if (!hashes.length) return [];
  const placeholders = hashes.map(() => "?").join(", ");
  const rows = (await Zotero.DB.queryAsync(
    `SELECT hash FROM ${ATTACHMENT_BLOBS_TABLE} WHERE hash IN (${placeholders})`,
    hashes,
  )) as Array<{ hash?: unknown }> | undefined;
  if (!rows?.length) return [];
  return normalizeHashes(
    rows
      .map((row) => (typeof row.hash === "string" ? row.hash : ""))
      .filter(Boolean),
  );
}

export async function initAttachmentRefStore(): Promise<void> {
  await ensureAttachmentRefTables();
}

export async function replaceOwnerAttachmentRefs(
  ownerType: AttachmentRefOwnerType,
  ownerId: number,
  hashes: readonly string[],
): Promise<void> {
  const normalizedOwnerId = normalizeOwnerId(ownerId);
  if (!normalizedOwnerId) return;
  await ensureAttachmentRefTables();
  const normalizedHashes = await filterKnownBlobHashes(normalizeHashes(hashes));
  await Zotero.DB.executeTransaction(async () => {
    await Zotero.DB.queryAsync(
      `DELETE FROM ${ATTACHMENT_REFS_TABLE}
       WHERE owner_type = ?
         AND owner_id = ?`,
      [ownerType, normalizedOwnerId],
    );
    if (!normalizedHashes.length) return;
    const now = Date.now();
    for (const hash of normalizedHashes) {
      await Zotero.DB.queryAsync(
        `INSERT OR REPLACE INTO ${ATTACHMENT_REFS_TABLE}
          (owner_type, owner_id, blob_hash, updated_at)
         VALUES (?, ?, ?, ?)`,
        [ownerType, normalizedOwnerId, hash, now],
      );
    }
  });
}

export async function clearOwnerAttachmentRefs(
  ownerType: AttachmentRefOwnerType,
  ownerId: number,
): Promise<void> {
  const normalizedOwnerId = normalizeOwnerId(ownerId);
  if (!normalizedOwnerId) return;
  await ensureAttachmentRefTables();
  await Zotero.DB.queryAsync(
    `DELETE FROM ${ATTACHMENT_REFS_TABLE}
     WHERE owner_type = ?
       AND owner_id = ?`,
    [ownerType, normalizedOwnerId],
  );
}

export async function collectAndDeleteUnreferencedBlobs(
  minAgeMs: number,
): Promise<void> {
  await ensureAttachmentRefTables();
  const minAge = Number.isFinite(minAgeMs)
    ? Math.max(0, Math.floor(minAgeMs))
    : ATTACHMENT_GC_MIN_AGE_MS;
  const cutoff = Date.now() - minAge;
  const rows = (await Zotero.DB.queryAsync(
    `SELECT b.hash AS hash, b.path AS path
     FROM ${ATTACHMENT_BLOBS_TABLE} b
     LEFT JOIN ${ATTACHMENT_REFS_TABLE} r
       ON r.blob_hash = b.hash
     WHERE r.blob_hash IS NULL
       AND b.created_at <= ?`,
    [cutoff],
  )) as Array<{ hash?: unknown; path?: unknown }> | undefined;
  if (!rows?.length) return;

  for (const row of rows) {
    const hash =
      typeof row.hash === "string" && /^[a-f0-9]{64}$/i.test(row.hash.trim())
        ? row.hash.trim().toLowerCase()
        : "";
    if (!hash) continue;
    const path = typeof row.path === "string" ? row.path.trim() : "";
    if (path) {
      try {
        await removeAttachmentFile(path);
      } catch (err) {
        ztoolkit.log("LLM: Failed to delete unreferenced attachment blob", err);
        continue;
      }
    }
    await Zotero.DB.queryAsync(
      `DELETE FROM ${ATTACHMENT_BLOBS_TABLE}
       WHERE hash = ?
         AND NOT EXISTS (
           SELECT 1
           FROM ${ATTACHMENT_REFS_TABLE}
           WHERE blob_hash = ?
         )`,
      [hash, hash],
    );
  }
}
