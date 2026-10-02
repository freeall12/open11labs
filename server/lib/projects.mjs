/* ==========================================================================
   Projects and folders.

   Single-user and local: there is no owner, member or role column, and no
   filter that could leak one. What remains is the part that actually needs
   care — revision conflict detection, so two tabs editing the same project
   cannot silently overwrite each other, and reference-aware deletion.
   ========================================================================== */

import { randomUUID } from "node:crypto";
import { openDb } from "./db.mjs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  revision    INTEGER NOT NULL DEFAULT 1,
  content     TEXT NOT NULL,
  asset_refs  TEXT NOT NULL DEFAULT '[]',
  draft       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT,
  created_at  TEXT NOT NULL
);
`;

export const PROJECT_SCHEMA_VERSION = 1;

export class RevisionConflictError extends Error {
  constructor(expected, actual) {
    super("项目已被其他窗口修改");
    this.code = "REVISION_CONFLICT";
    this.expectedRevision = expected;
    this.actualRevision = actual;
  }
}

export class ProjectStore {
  #db;
  #now;

  constructor({ db, dbPath, now = () => new Date().toISOString() }) {
    this.#db = db ?? openDb(dbPath);
    this.#db.exec(SCHEMA);
    this.#now = now;
  }

  create({ kind, name, content = {}, assetRefs = [] }) {
    const id = randomUUID();
    const at = this.#now();
    this.#db
      .prepare(
        `INSERT INTO projects (id, kind, name, revision, content, asset_refs, created_at, updated_at)
         VALUES (?,?,?,1,?,?,?,?)`,
      )
      .run(id, kind, name, JSON.stringify({ v: PROJECT_SCHEMA_VERSION, ...content }), JSON.stringify(assetRefs), at, at);
    return this.get(id);
  }

  get(id) {
    const row = this.#db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? this.#toPublic(row) : null;
  }

  list() {
    return this.#db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all()
      .map((r) => this.#toPublic(r));
  }

  /**
   * Save with an optimistic revision check. A caller that passes a stale
   * revision gets a conflict, never a silent overwrite.
   */
  save(id, { expectedRevision, content, name, assetRefs }) {
    const current = this.get(id);
    if (!current) throw new ReferenceError(`unknown project: ${id}`);
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new RevisionConflictError(expectedRevision, current.revision);
    }

    this.#db
      .prepare(
        `UPDATE projects
            SET revision = revision + 1,
                name = COALESCE(?, name),
                content = COALESCE(?, content),
                asset_refs = COALESCE(?, asset_refs),
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        name ?? null,
        content ? JSON.stringify({ v: PROJECT_SCHEMA_VERSION, ...content }) : null,
        assetRefs ? JSON.stringify(assetRefs) : null,
        this.#now(),
        id,
      );
    return this.get(id);
  }

  /** Duplicating gives a new id and does not re-run any generation. */
  duplicate(id, { name } = {}) {
    const src = this.get(id);
    if (!src) throw new ReferenceError(`unknown project: ${id}`);
    return this.create({
      kind: src.kind,
      name: name ?? `${src.name} 副本`,
      content: src.content,
      assetRefs: src.assetRefs,
    });
  }

  /**
   * Derive a variant: same structure, a few variables swapped.
   *
   * This is the idea borrowed from open-source video-DSL projects such as
   * hypit, where one workflow is re-run with different variables instead of
   * being rebuilt. A variant is cheap because the structure and any already
   * generated assets are reused; only the named variables change.
   *
   * Nothing is re-generated here — a variant is a project until someone runs
   * it, and running it goes through the normal cost-confirmation path.
   *
   * @param {string} id
   * @param {{ name?: string, variables?: Record<string, unknown>, assetRefs?: string[] }} opts
   */
  deriveVariant(id, { name, variables = {}, assetRefs } = {}) {
    const src = this.get(id);
    if (!src) throw new ReferenceError(`unknown project: ${id}`);

    const base = src.content?.variables ?? {};
    const merged = { ...base, ...variables };
    const changed = Object.keys(variables).filter(
      (k) => JSON.stringify(base[k]) !== JSON.stringify(variables[k]),
    );

    return this.create({
      kind: src.kind,
      name: name ?? `${src.name} 变体`,
      content: {
        ...src.content,
        // Variables are named, not positional, so a variant survives the
        // structure changing underneath it.
        variables: merged,
        derivedFrom: { id: src.id, revision: src.revision, changed },
      },
      assetRefs: assetRefs ?? src.assetRefs,
    });
  }

  rename(id, name) {
    return this.save(id, { name });
  }

  saveDraft(id, draft) {
    this.#db
      .prepare("UPDATE projects SET draft = ?, updated_at = ? WHERE id = ?")
      .run(draft ?? null, this.#now(), id);
    return this.get(id);
  }

  /**
   * Delete a project. Assets are intentionally left alone — they may be shared,
   * and docs/architecture/data.md requires the impact to be surfaced rather
   * than a cascading wipe.
   */
  remove(id) {
    const project = this.get(id);
    if (!project) return { removed: false };
    this.#db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    return {
      removed: true,
      retainedAssets: project.assetRefs,
      note: `保留了 ${project.assetRefs.length} 个仍存在于素材库的资产，未级联删除`,
    };
  }

  /** Which projects still point at an asset — the check before deletion. */
  referencesFor(assetId) {
    return this.list()
      .filter((p) => p.assetRefs.includes(assetId))
      .map((p) => ({ id: p.id, name: p.name, revision: p.revision }));
  }

  /* ---------------------------------------------------------- folders -- */

  createFolder({ name, parentId = null }) {
    const id = randomUUID();
    this.#db
      .prepare("INSERT INTO folders (id, name, parent_id, created_at) VALUES (?,?,?,?)")
      .run(id, name, parentId, this.#now());
    return { id, name, parentId };
  }

  listFolders() {
    return this.#db
      .prepare("SELECT * FROM folders ORDER BY created_at")
      .all()
      .map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id }));
  }

  close() {
    this.#db.close();
  }

  #toPublic(row) {
    const content = JSON.parse(row.content);
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      revision: row.revision,
      schemaVersion: content.v ?? null,
      content,
      assetRefs: JSON.parse(row.asset_refs || "[]"),
      draft: row.draft,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
