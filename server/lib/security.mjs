/* ==========================================================================
   Request guards.

   These are the gates named in docs/architecture/security.md. They are not a
   substitute for a security review; they are the concrete minimum that must
   hold before any credential or paid call is reachable.

   Threat addressed: a page on another origin reaching the local server.
   Binding to loopback stops remote hosts, but it does NOT stop a browser on
   this machine from being tricked into sending requests, because loopback
   targets are still "same machine". Hence Host and Origin validation plus a
   session-bound CSRF token.
   ========================================================================== */

import { randomBytes, timingSafeEqual } from "node:crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Hosts we will answer for, given the port we actually bound. */
export function allowedHosts(port) {
  return new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
    // A bare host without a port is a malformed request for our listener.
    "127.0.0.1",
    "localhost",
    "[::1]",
  ]);
}

export class RequestRejected extends Error {
  constructor(status, code, detail) {
    super(`${code}: ${detail ?? ""}`.trim());
    this.status = status;
    this.code = code;
  }
}

/** Reject anything not addressed to this listener. Blocks DNS-rebinding. */
export function assertHost(req, port) {
  const host = req.headers.host;
  if (!host) {
    throw new RequestRejected(400, "HOST_MISSING", "no Host header");
  }
  if (!allowedHosts(port).has(host)) {
    throw new RequestRejected(403, "HOST_REJECTED", `Host ${host}`);
  }
}

/**
 * Validate Origin on state-changing requests.
 *
 * A same-origin browser request carries an Origin equal to our own. A missing
 * Origin on a mutating request is refused rather than assumed safe: the only
 * legitimate clients here are the SPA (which sends it) and the test harness
 * (which sets it explicitly).
 */
export function assertOrigin(req, port) {
  if (SAFE_METHODS.has(req.method)) return;

  const origin = req.headers.origin;
  if (!origin) {
    throw new RequestRejected(403, "ORIGIN_MISSING", "mutating request without Origin");
  }

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new RequestRejected(403, "ORIGIN_INVALID", origin);
  }

  const host = `${parsed.hostname}:${parsed.port || "80"}`;
  const ok =
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    allowedHosts(port).has(parsed.host) &&
    (allowedHosts(port).has(host) || parsed.port === String(port));

  if (!ok) {
    throw new RequestRejected(403, "ORIGIN_REJECTED", origin);
  }
}

/* ------------------------------------------------------------- session -- */

/**
 * A single-user local session. There is no registration and no login, but
 * "no account system" is not "no access control": the session exists so that
 * a random page cannot drive this server.
 */
export class Session {
  constructor() {
    this.id = randomBytes(32).toString("base64url");
    this.csrf = randomBytes(32).toString("base64url");
    this.createdAt = Date.now();
  }
}

export class SessionStore {
  #sessions = new Map();

  issue() {
    const s = new Session();
    this.#sessions.set(s.id, s);
    return s;
  }

  get(id) {
    return id ? (this.#sessions.get(id) ?? null) : null;
  }

  get size() {
    return this.#sessions.size;
  }
}

export const SESSION_COOKIE = "el_session";

export function parseCookies(header) {
  const out = new Map();
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out.set(k, decodeURIComponent(v));
  }
  return out;
}

export function sessionCookie(value, port, { secure = false } = {}) {
  const bits = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    // Strict, not Lax: this app never needs a cookie on a cross-site top-level
    // navigation, and Lax would let one ride along.
    "SameSite=Strict",
  ];
  if (port !== 80) bits.push(`Port=${port}`);
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

/**
 * CSRF: the header must echo the token bound to the caller's session.
 * Compared in constant time so a wrong token cannot be probed byte by byte.
 */
export function assertCsrf(req, session) {
  if (SAFE_METHODS.has(req.method)) return;

  const provided = req.headers["x-csrf-token"];
  if (typeof provided !== "string" || !provided) {
    throw new RequestRejected(403, "CSRF_MISSING", "no X-CSRF-Token header");
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(session.csrf);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new RequestRejected(403, "CSRF_REJECTED", "token mismatch");
  }
}

/** Every mutating request needs a live session. */
export function assertSession(sessions, req) {
  const cookies = parseCookies(req.headers.cookie);
  const session = sessions.get(cookies.get(SESSION_COOKIE));
  if (!session) {
    throw new RequestRejected(401, "SESSION_REQUIRED", "no valid session");
  }
  return session;
}

/* --------------------------------------------------------------- guard -- */

/**
 * Single entry point used by every API route, in the order the threats
 * appear: is it aimed at us, is it from us, does it belong to a session.
 */
export function guard({ req, port, sessions }) {
  assertHost(req, port);
  assertOrigin(req, port);
  const session = assertSession(sessions, req);
  assertCsrf(req, session);
  return session;
}
