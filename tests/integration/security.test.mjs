import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalServer, safeLog } from "../../server/index.mjs";
import { Vault, maskSecret, assertAllowedBaseURL } from "../../server/lib/vault.mjs";

/* ==========================================================================
   R7-AC02 — security negatives.

   Every case here must actually be refused. A negative that returns 200 is a
   failure of the test suite, not a tolerated gap.
   ========================================================================== */

const PORT = 5199;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** Captured log lines, so we can prove no secret was written. */
let logLines = [];

function makeRoot() {
  const dir = mkdtempSync(join(tmpdir(), "open11labs-web-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  return dir;
}

let server;
let base;

beforeAll(async () => {
  const root = makeRoot();
  const vault = new Vault();
  ({ server } = createLocalServer({
    root,
    vault,
    port: PORT,
    log: (entry) => logLines.push(entry),
  }));

  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${PORT}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Mint a session the legitimate way, returning cookie + csrf. */
async function session() {
  const res = await fetch(`${base}/api/v1/session`, { headers: { host: `127.0.0.1:${PORT}` } });
  const body = await res.json();
  const cookie = res.headers.get("set-cookie").split(";")[0];
  return { cookie, csrf: body.csrfToken };
}

/**
 * Raw request. `fetch` strips the Host header as a forbidden header name, so
 * any Host-based assertion made through fetch would silently test nothing.
 */
function raw(path, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: PORT, path, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function api(path, { method = "GET", body, cookie, csrf, origin = ORIGIN, host } = {}) {
  const headers = { host: host ?? `127.0.0.1:${PORT}` };
  if (origin !== null) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/* ------------------------------------------------------------------ host */

describe("Host validation (DNS rebinding)", () => {
  it("rejects a Host that is not this listener", async () => {
    const res = await raw("/api/v1/session", { headers: { host: "evil.example.com" } });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.text).error.code).toBe("HOST_REJECTED");
  });

  it("rejects a rebinding host that points at loopback by name", async () => {
    const res = await raw("/api/v1/session", {
      headers: { host: "localhost.attacker.test" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a Host on static assets too, not just the API", async () => {
    const res = await raw("/index.html", { headers: { host: "evil.example.com" } });
    expect(res.status).toBe(403);
  });

  it("serves static assets for our own host", async () => {
    const res = await api("/index.html");
    expect(res.status).toBe(200);
  });
});

/* ---------------------------------------------------------------- origin */

describe("Origin validation (cross-site request)", () => {
  it("refuses a mutating request with a foreign Origin", async () => {
    const { cookie, csrf } = await session();
    const res = await api("/api/v1/providers", {
      method: "POST",
      cookie,
      csrf,
      origin: "https://evil.example.com",
      body: { type: "elevenlabs", baseURL: "https://api.elevenlabs.io", secret: "sk-test" },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("ORIGIN_REJECTED");
  });

  it("refuses a mutating request with no Origin at all", async () => {
    const { cookie, csrf } = await session();
    const res = await api("/api/v1/providers", {
      method: "POST",
      cookie,
      csrf,
      origin: null,
      body: { type: "elevenlabs", baseURL: "https://api.elevenlabs.io", secret: "sk-test" },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("ORIGIN_MISSING");
  });

  it("never emits CORS headers", async () => {
    const res = await api("/api/v1/session");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

/* -------------------------------------------------------------- session */

describe("session and CSRF", () => {
  it("refuses an API call with no session", async () => {
    const res = await api("/api/v1/providers");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("SESSION_REQUIRED");
  });

  it("refuses a mutating call with a wrong CSRF token", async () => {
    const { cookie } = await session();
    const res = await api("/api/v1/providers", {
      method: "POST",
      cookie,
      csrf: "not-the-right-token",
      body: { type: "elevenlabs", baseURL: "https://api.elevenlabs.io", secret: "sk-x" },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_REJECTED");
  });

  it("refuses a mutating call with no CSRF header", async () => {
    const { cookie } = await session();
    const res = await api("/api/v1/providers", {
      method: "POST",
      cookie,
      body: { type: "elevenlabs", baseURL: "https://api.elevenlabs.io", secret: "sk-x" },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_MISSING");
  });

  it("sets the session cookie HttpOnly and SameSite=Strict", async () => {
    const res = await fetch(`${base}/api/v1/session`, {
      headers: { host: `127.0.0.1:${PORT}` },
    });
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });
});

/* ---------------------------------------------------------- secret leak */

describe("secrets never leave the vault", () => {
  const SECRET = "sk-super-secret-value-1234567890";

  async function createProvider() {
    const { cookie, csrf } = await session();
    const res = await api("/api/v1/providers", {
      method: "POST",
      cookie,
      csrf,
      body: {
        type: "elevenlabs",
        displayName: "my key",
        baseURL: "https://api.elevenlabs.io",
        secret: SECRET,
      },
    });
    expect(res.status).toBe(201);
    return (await res.json()).provider;
  }

  it("masks on create and never echoes the secret", async () => {
    const rec = await createProvider();
    expect(rec.maskedSecret).not.toContain(SECRET);
    expect(JSON.stringify(rec)).not.toContain(SECRET);
  });

  it("returns no secret on list or get", async () => {
    const rec = await createProvider();
    const { cookie } = await session();

    for (const path of ["/api/v1/providers", `/api/v1/providers/${rec.id}`]) {
      const res = await api(path, { cookie });
      const text = await res.text();
      expect(text).not.toContain(SECRET);
    }
  });

  it("writes no secret to the log", async () => {
    await createProvider();
    const dump = JSON.stringify(logLines);
    expect(dump).not.toContain(SECRET);
  });

  it("redacts secret-named fields passed to the logger", () => {
    const original = console.log;
    const lines = [];
    console.log = (line) => lines.push(line);
    try {
      safeLog({ event: "test", secret: "sk-abc", apiKey: "k" });
    } finally {
      console.log = original;
    }
    const line = lines.join("\n");
    expect(line).not.toContain("sk-abc");
    expect(line).toContain("[redacted]");
  });

  it("masks short and long secrets without leaking them", () => {
    expect(maskSecret("sk-abcdefghijklmnop")).toBe("sk-a••••••mnop");
    expect(maskSecret("short")).toBe("•••••");
  });
});

/* ------------------------------------------------------------ vault unit */

describe("vault lifecycle", () => {
  it("rotation keeps the credential id so assets keep working", () => {
    const v = new Vault();
    const rec = v.put({ type: "elevenlabs", baseURL: "https://api.elevenlabs.io", secret: "sk-one-12345678" });
    const rotated = v.rotate(rec.id, "sk-two-87654321");
    expect(rotated.id).toBe(rec.id);
    expect(rotated.validationState).toBe("unverified");
    expect(v.useSecret(rec.id)).toBe("sk-two-87654321");
  });

  it("removal drops the secret, not just the record", () => {
    const v = new Vault();
    const rec = v.put({ type: "elevenlabs", baseURL: "https://api.elevenlabs.io", secret: "sk-12345678" });
    expect(v.remove(rec.id)).toBe(true);
    expect(() => v.useSecret(rec.id)).toThrow();
  });

  it("exports no secret material when no master password is set", () => {
    const v = new Vault();
    v.put({ type: "elevenlabs", baseURL: "https://api.elevenlabs.io", secret: "sk-plaintext-1234" });
    const blob = v.exportForBackup();
    expect(blob.encrypted).toBe(false);
    expect(JSON.stringify(blob)).not.toContain("sk-plaintext-1234");
  });

  it("round-trips secrets through an encrypted backup", () => {
    const a = new Vault({ masterPassword: "correct horse" });
    a.put({ type: "elevenlabs", baseURL: "https://api.elevenlabs.io", secret: "sk-encrypted-1234" });
    const blob = a.exportForBackup();
    expect(blob.encrypted).toBe(true);
    expect(JSON.stringify(blob)).not.toContain("sk-encrypted-1234");

    const b = new Vault({ masterPassword: "correct horse" });
    b.importFromBackup(blob);
    expect(b.size).toBe(1);
    expect(b.useSecret([...b.list()][0].id)).toBe("sk-encrypted-1234");
  });

  it("refuses to restore an encrypted backup without the master password", () => {
    const a = new Vault({ masterPassword: "pw" });
    a.put({ type: "elevenlabs", baseURL: "https://api.elevenlabs.io", secret: "sk-12345678" });
    const blob = a.exportForBackup();
    expect(() => new Vault().importFromBackup(blob)).toThrow(/master password/);
  });
});

/* ---------------------------------------------------------- provider URL */

describe("provider baseURL allowlist (SSRF)", () => {
  it("accepts registered provider hosts", () => {
    expect(() => assertAllowedBaseURL("https://api.elevenlabs.io")).not.toThrow();
    expect(() => assertAllowedBaseURL("https://api.eu.elevenlabs.io")).not.toThrow();
  });

  it("rejects loopback, private ranges and link-local", () => {
    for (const host of [
      "http://127.0.0.1",
      "http://localhost",
      "http://10.0.0.5",
      "http://192.168.1.1",
      "http://169.254.169.254",
      "http://[::1]",
    ]) {
      expect(() => assertAllowedBaseURL(host)).toThrow();
    }
  });

  it("rejects non-https and credential-bearing URLs", () => {
    expect(() => assertAllowedBaseURL("http://api.elevenlabs.io")).toThrow(/https/);
    expect(() => assertAllowedBaseURL("https://user:pw@api.elevenlabs.io")).toThrow(/credential/);
  });

  it("rejects an unregistered host even over https", () => {
    expect(() => assertAllowedBaseURL("https://evil.example.com")).toThrow(/not registered/);
  });
});

/* ------------------------------------------------------- path traversal */

describe("static path traversal", () => {
  it("refuses a URL that escapes the web root", async () => {
    const res = await api("/../../etc/passwd");
    // Either the traversal is blocked outright, or it falls back to index.html.
    // It must never return the contents of a file outside the root.
    const text = await res.text();
    expect(text).not.toMatch(/root:/);
  });
});
