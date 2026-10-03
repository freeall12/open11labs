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

import { allowedHostsFor, requiresSelfHosted } from "../../packages/providers/registry.mjs";
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
    // Surfaced so the UI can say "this talks to your own machine".
    selfHosted: Boolean(rec.selfHosted),
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
  put({ type, displayName, baseURL, secret, selfHosted = false }) {
    if (!type) throw new TypeError("type is required");
    if (!baseURL) throw new TypeError("baseURL is required");
    if (typeof secret !== "string" || secret.length === 0) {
      throw new TypeError("secret is required and must be a non-empty string");
    }
    // A self-hosted provider is the one documented exception to the URL
    // allowlist, and it has to be opted into explicitly. It is recorded on
    // the credential so the UI can label it and the runner can hold it to a
    // loopback-or-declared-host rule.
    assertAllowedBaseURL(baseURL, { type, allowPrivate: selfHosted === true });

    const id = nextId();
    const rec = {
      id,
      type,
      displayName: displayName || type,
      baseURL,
      selfHosted: selfHosted === true,
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

/**
 * Validate a provider base URL against that provider's registered hosts.
 *
 * `type` selects the allowlist. A provider with an empty list (self-hosted)
 * is only reachable when the user marked the credential self-hosted, and even
 * then only over https or on loopback — a self-hosted entry must not become a
 * way to send a key in clear text to an arbitrary public host.
 *
 * @param {string} raw
 * @param {{ type?: string, allowPrivate?: boolean }} [options]
 */
export function assertAllowedBaseURL(raw, { type, allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`invalid baseURL: ${raw}`);
  }

  if (url.username || url.password) {
    throw new TypeError("baseURL must not embed credentials");
  }

  const host = url.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";

  if (allowPrivate) {
    // A registered self-hosted provider may serve plain http on loopback,
    // because that traffic never leaves the machine. A public host over http
    // is refused even when self-hosted: the credential would travel in clear.
    if (url.protocol === "http:" && isLoopback) return url;
    if (url.protocol === "https:") {
      const p = host.split(".").map(Number);
      const looksPrivate =
        isLoopback ||
        (p.length === 4 && (p[0] === 10 || p[0] === 192 || (p[0] === 172 && p[1] >= 16)));
      if (looksPrivate) return url;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new TypeError(`provider baseURL protocol not allowed: ${url.protocol}`);
    }
  }

  if (url.protocol !== "https:") {
    throw new TypeError(
      isLoopback
        ? "本机地址需要显式标记为自托管 Provider 才允许使用"
        : "provider baseURL must be https",
    );
  }

  const allowed = allowedHostsFor(type);
  if (allowed.length === 0) {
    // A self-hosted provider has no registered host list by design. The host
    // still has to be one the user declared, so name the host in the error.
    throw new TypeError(
      `provider host not registered for type "${type ?? "unknown"}": ${host}. ` +
        "A self-hosted provider must be on loopback or a private range, or its host must be registered.",
    );
  }
  if (!allowed.includes(host)) {
    throw new TypeError(`provider host not registered for ${type}: ${host}`);
  }
  return url;
}

/**
 * Whether a credential of this type must be self-hosted. Surfaced to the UI
 * so the form can require the checkbox instead of failing at save time.
 */
export function selfHostedRequired(type) {
  return requiresSelfHosted(type);
}

export { timingSafeEqual };
