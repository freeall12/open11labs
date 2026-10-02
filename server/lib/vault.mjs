/* ==========================================================================
   Credential vault.

   Rules from specs/BYOK.md and docs/architecture/security.md:
     - the browser never receives a secret; the API is write-only
     - a secret lives only in the server process, or at rest encrypted under a
       master password the user supplies
     - nothing secret is logged, exported, or embedded in a project file
     - removing a key does not pretend to stop work already accepted upstream

   The default is in-memory: restart the server, keys are gone. That is a
   deliberate trade, not an oversight — a key that survives on disk without
   the user choosing to persist it is the case worth avoiding.
   ========================================================================== */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/** Verbs that are safe to expose. */
export const VALIDATION_STATES = [
  "unconfigured",
  "unverified",
  "validating",
  "available",
  "auth_failed",
  "insufficient_scope",
  "network_error",
  "removed",
];

let seq = 0;

function nextId() {
  seq += 1;
  return `cred_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/** Show enough to recognise a key, never enough to use one. */
export function maskSecret(secret) {
  const s = String(secret ?? "");
  if (s.length <= 8) return "•".repeat(Math.max(s.length, 4));
  return `${s.slice(0, 4)}${"•".repeat(6)}${s.slice(-4)}`;
}

/** Metadata safe to send to the browser. Contains no secret material. */
export function toPublic(rec) {
  return {
    id: rec.id,
    type: rec.type,
    displayName: rec.displayName,
    baseURL: rec.baseURL,
    maskedSecret: rec.maskedSecret,
    validationState: rec.validationState,
    validatedAt: rec.validatedAt,
    lastError: rec.lastError,
    createdAt: rec.createdAt,
    rotatedAt: rec.rotatedAt,
  };
}

export class Vault {
  #records = new Map();
  #secrets = new Map();
  #masterKey = null;

  constructor({ masterPassword } = {}) {
    if (masterPassword) {
      this.#masterKey = scryptSync(masterPassword, "elevenlabs-byok-vault", 32);
    }
  }

  get isPersistent() {
    return this.#masterKey !== null;
  }

  get size() {
    return this.#records.size;
  }

  /**
   * Store a credential. The secret is accepted here and never handed back:
   * there is deliberately no `reveal` method.
   */
  put({ type, displayName, baseURL, secret }) {
    if (!type) throw new TypeError("type is required");
    if (!baseURL) throw new TypeError("baseURL is required");
    if (typeof secret !== "string" || secret.length === 0) {
      throw new TypeError("secret is required and must be a non-empty string");
    }
    assertAllowedBaseURL(baseURL);

    const id = nextId();
    const rec = {
      id,
      type,
      displayName: displayName || type,
      baseURL,
      maskedSecret: maskSecret(secret),
      validationState: "unverified",
      validatedAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
      rotatedAt: null,
    };

    this.#records.set(id, rec);
    this.#secrets.set(id, secret);
    return toPublic(rec);
  }

  /**
   * Replace a secret in place, keeping the same id. Assets that reference the
   * credentialRef keep working; per BYOK.md a job already submitted keeps the
   * credential it was submitted with.
   */
  rotate(id, secret) {
    const rec = this.#records.get(id);
    if (!rec) throw new ReferenceError(`unknown credential: ${id}`);
    if (typeof secret !== "string" || secret.length === 0) {
      throw new TypeError("secret must be a non-empty string");
    }
    rec.maskedSecret = maskSecret(secret);
    rec.validationState = "unverified";
    rec.validatedAt = null;
    rec.lastError = null;
    rec.rotatedAt = new Date().toISOString();
    this.#secrets.set(id, secret);
    return toPublic(rec);
  }

  list() {
    return [...this.#records.values()].map(toPublic);
  }

  get(id) {
    const rec = this.#records.get(id);
    return rec ? toPublic(rec) : null;
  }

  /**
   * The only way to obtain a secret, and it is not reachable from the HTTP
   * layer. Callers must be provider adapters running in-process.
   */
  useSecret(id) {
    const s = this.#secrets.get(id);
    if (!s) throw new ReferenceError(`unknown credential: ${id}`);
    return s;
  }

  markValidation(id, { state, error = null }) {
    const rec = this.#records.get(id);
    if (!rec) throw new ReferenceError(`unknown credential: ${id}`);
    if (!VALIDATION_STATES.includes(state)) {
      throw new TypeError(`unknown validation state: ${state}`);
    }
    rec.validationState = state;
    rec.validatedAt = state === "available" ? new Date().toISOString() : rec.validatedAt;
    rec.lastError = error ? String(error).slice(0, 300) : null;
    return toPublic(rec);
  }

  remove(id) {
    const rec = this.#records.get(id);
    if (!rec) return false;
    this.#records.delete(id);
    this.#secrets.delete(id);
    return true;
  }

  /* --------------------------------------------------------- at rest -- */

  /**
   * Serialised state. With a master key the secrets are encrypted; without
   * one, the export deliberately contains no secret material at all rather
   * than plaintext, so a stray backup file cannot leak a key.
   */
  exportForBackup() {
    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      records: [...this.#records.values()],
    };
    if (!this.#masterKey) return { ...payload, secrets: null, encrypted: false };

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#masterKey, iv);
    const blob = Buffer.concat([
      cipher.update(JSON.stringify([...this.#secrets]), "utf8"),
      cipher.final(),
    ]);
    return {
      ...payload,
      encrypted: true,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      secrets: blob.toString("base64"),
    };
  }

  importFromBackup(blob) {
    if (!blob || blob.version !== 1) {
      throw new TypeError("unsupported backup version");
    }
    for (const rec of blob.records ?? []) this.#records.set(rec.id, rec);
    if (!blob.encrypted) return { restored: blob.records?.length ?? 0, secrets: 0 };

    if (!this.#masterKey) {
      throw new Error("backup is encrypted but no master password was supplied");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#masterKey,
      Buffer.from(blob.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
    const json = Buffer.concat([
      decipher.update(Buffer.from(blob.secrets, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const pairs = JSON.parse(json);
    for (const [id, secret] of pairs) this.#secrets.set(id, secret);
    return { restored: blob.records.length, secrets: pairs.length };
  }
}

/* ------------------------------------------------------------ base URL -- */

const DEFAULT_PROVIDER_HOSTS = {
  elevenlabs: ["api.elevenlabs.io", "api.eu.elevenlabs.io"],
};

/**
 * Only registered provider hosts are allowed. This is what stops a user (or
 * a malicious page that somehow reaches this API) from pointing the server at
 * a private address and having it fetch with the user's key.
 */
export function assertAllowedBaseURL(raw, { allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`invalid baseURL: ${raw}`);
  }

  if (url.protocol !== "https:") {
    throw new TypeError("provider baseURL must be https");
  }
  if (url.username || url.password) {
    throw new TypeError("baseURL must not embed credentials");
  }

  const host = url.hostname.toLowerCase();
  if (allowPrivate) return url;

  const allowed = DEFAULT_PROVIDER_HOSTS.elevenlabs;
  if (!allowed.includes(host)) {
    throw new TypeError(
      `provider host not registered: ${host}. Self-hosted providers must be registered explicitly.`,
    );
  }
  return url;
}

export { timingSafeEqual };
