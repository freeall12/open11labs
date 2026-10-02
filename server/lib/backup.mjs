/* ==========================================================================
   Export / import.

   A bundle is what a user hands to someone else or archives, so it is treated
   as untrusted on the way out and on the way in:

     out — carries the schema version, relative asset paths, and the model /
           licence provenance of each result. It never carries credentials,
           absolute paths, or anything from the private research corpus.
     in  — the schema version must match, every path is re-resolved inside the
           destination, and size limits are enforced before anything is written.
           A path that escapes the target is a hard failure, not a warning.
   ========================================================================== */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, isAbsolute, sep } from "node:path";

export const BUNDLE_FORMAT = "open11labs-backup";
export const BUNDLE_VERSION = 1;

/** Guard rails for an untrusted import. */
export const IMPORT_LIMITS = {
  maxEntries: 10_000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxEntryBytes: 200 * 1024 * 1024,
};

/** Keys that must never leave the machine in a bundle. */
const FORBIDDEN_KEYS = new Set([
  "secret",
  "apikey",
  "api_key",
  "xi-api-key",
  "authorization",
  "token",
  "password",
  "credential",
  "credentials",
  "encrypted",
  "iv",
  "tag",
]);

/**
 * Build an exportable bundle. `assets` are supplied by the AssetStore, which
 * already knows the absolute paths; this function is the boundary where they
 * become relative.
 */
export function buildBundle({ projects, assets, jobs = [], cost = null, generatedAt }) {
  const entries = [];
  let totalBytes = 0;

  for (const asset of assets) {
    if (totalBytes + asset.byteSize > IMPORT_LIMITS.maxTotalBytes) break;
    entries.push({
      id: asset.id,
      // Relative, so the bundle does not disclose the user's home directory.
      path: `assets/${asset.id.slice(0, 2)}/${asset.id}`,
      byteSize: asset.byteSize,
      mediaType: asset.mediaType,
      contentHash: asset.contentHash,
      displayName: asset.displayName,
      sourceJobId: asset.sourceJobId,
      origin: asset.origin,
      licenseSource: asset.licenseSource,
    });
    totalBytes += asset.byteSize;
  }

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    generatedAt,
    counts: {
      projects: projects.length,
      assets: entries.length,
      jobs: jobs.length,
    },
    projects: projects.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      revision: p.revision,
      schemaVersion: p.schemaVersion,
      content: p.content,
      assetRefs: p.assetRefs,
    })),
    assets: entries,
    // Job history without the input snapshots, which can contain user text.
    jobs: jobs.map((j) => ({
      id: j.id,
      type: j.type,
      providerId: j.providerId,
      modelId: j.modelId,
      status: j.status,
      requestId: j.requestId,
      outputAssetIds: j.outputAssetIds,
      createdAt: j.createdAt,
    })),
    cost,
  };
}

/** Serialise to disk, then hash so a restore can verify it. */
export function writeBundle(root, bundle) {
  const dir = resolve(root);
  mkdirSync(dir, { recursive: true });
  const name = `backup-${bundle.generatedAt.replace(/[:.]/g, "-")}.json`;
  const target = join(dir, name);
  const json = JSON.stringify(bundle, null, 2);
  writeFileSync(target, json, "utf8");
  return { path: target, sha256: createHash("sha256").update(json).digest("hex") };
}

/**
 * Validate an incoming bundle before a single byte is written.
 * Throws with a specific reason; returning warnings would let a caller ignore
 * the dangerous case.
 */
export function validateBundle(bundle) {
  if (!bundle || bundle.format !== BUNDLE_FORMAT) {
    throw new TypeError("not an open11labs backup bundle");
  }
  if (bundle.version !== BUNDLE_VERSION) {
    throw new TypeError(
      `unsupported bundle version ${bundle.version}; this build reads ${BUNDLE_VERSION}`,
    );
  }

  const assets = bundle.assets ?? [];
  const projects = bundle.projects ?? [];

  if (assets.length > IMPORT_LIMITS.maxEntries) {
    throw new TypeError("bundle exceeds the entry limit");
  }

  let total = 0;
  for (const a of assets) {
    if (typeof a.path !== "string" || !a.path) {
      throw new TypeError("asset entry has no path");
    }
    if (isAbsolute(a.path) || a.path.startsWith("..") || a.path.includes(`..${sep}`)) {
      throw new TypeError(`asset path escapes the bundle: ${a.path}`);
    }
    if (a.byteSize > IMPORT_LIMITS.maxEntryBytes) {
      throw new TypeError("asset entry exceeds the per-entry size limit");
    }
    total += a.byteSize ?? 0;
  }
  if (total > IMPORT_LIMITS.maxTotalBytes) {
    throw new TypeError("bundle exceeds the total size limit");
  }

  // A bundle that still carries credential-shaped keys is refused outright
  // rather than silently stripped: it means the producer is wrong.
  const serialised = JSON.stringify(bundle);
  for (const key of FORBIDDEN_KEYS) {
    if (new RegExp(`"${key}"\\s*:`, "i").test(serialised)) {
      throw new TypeError(`bundle contains a forbidden key: ${key}`);
    }
  }

  for (const p of projects) {
    if (p.schemaVersion !== null && p.schemaVersion !== undefined) {
      if (typeof p.schemaVersion !== "number") {
        throw new TypeError("project schemaVersion must be a number");
      }
    }
  }

  return { projects, assets, totalBytes: total };
}

/** Re-resolve an entry path inside `dest`, refusing anything that escapes. */
export function safeJoin(dest, entryPath) {
  const base = resolve(dest);
  const target = resolve(join(base, entryPath));
  if (target !== base && !target.startsWith(base + sep)) {
    throw new TypeError(`path escapes destination: ${entryPath}`);
  }
  return target;
}

export function readBundleFile(path) {
  if (!existsSync(path)) throw new TypeError("bundle file not found");
  const stat = statSync(path);
  if (stat.size > IMPORT_LIMITS.maxTotalBytes) {
    throw new TypeError("bundle file exceeds the total size limit");
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Directory listing helper used by the storage screen. */
export function listDir(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).map((name) => {
    const p = join(root, name);
    const s = statSync(p);
    return { name, bytes: s.isFile() ? s.size : null, isDir: s.isDirectory() };
  });
}

export { relative };
