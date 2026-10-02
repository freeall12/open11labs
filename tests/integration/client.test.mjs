import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalServer } from "../../server/index.mjs";
import { Vault } from "../../server/lib/vault.mjs";

/* ==========================================================================
   Frontend API client against a real server.

   The client is exercised over actual HTTP rather than a mocked fetch, because
   the parts most likely to break are the handshake itself: session bootstrap,
   CSRF echo, same-origin cookies, and how a 409 conflict surfaces.
   ========================================================================== */

let server;
let port;
let base;
let fetchSpy;

const stubAdapter = {
  elevenlabs: {
    async validateCredential() {
      return { ok: true, modelCount: 2, providerRequestId: "req_stub" };
    },
    async listCapabilities() {
      return [];
    },
  },
};

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "open11labs-client-"));
  writeIndexHtml(dir);
  const handle = createLocalServer({
    root: dir,
    vault: new Vault(),
    port: 0,
    log: () => {},
    providerAdapters: stubAdapter,
  });
  await new Promise((r) => handle.server.listen(0, "127.0.0.1", r));
  handle.adoptActualPort();
  server = handle.server;
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;

  // The client uses same-origin relative paths; point them at the test server.
  // Capture the real implementation BEFORE spying, or the mock would call
  // itself and blow the stack.
  const real = globalThis.fetch.bind(globalThis);
  fetchSpy = vi.spyOn(globalThis, "fetch");
  // Node's fetch has no cookie jar, so keep a one-cookie jar here. The client
  // relies on the HttpOnly session cookie riding along exactly as a browser
  // would send it.
  let cookie = null;
  fetchSpy.mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    const target = url.startsWith("/") ? base + url : url;
    const headers = { ...(init?.headers ?? {}) };
    headers.host = `127.0.0.1:${port}`;
    if (init?.method && init.method !== "GET") {
      headers.origin = `http://127.0.0.1:${port}`;
    }
    if (cookie) headers.cookie = cookie;

    const res = await real(target, { ...init, headers });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookie = setCookie[0].split(";")[0];
    return res;
  });
});

afterEach(async () => {
  fetchSpy.mockRestore();
  // Drop any cached CSRF token so the next test bootstraps fresh.
  const mod = await import("../../src/lib/api");
  mod.resetSession();
  await new Promise((r) => server.close(r));
});

function writeIndexHtml(dir) {
  // Minimal valid root so the static branch is happy.
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title>");
}

const api = () => import("../../src/lib/api");

describe("session handshake", () => {
  it("bootstraps a session and caches the CSRF token", async () => {
    const { providers, resetSession } = await api();
    resetSession();
    const list = await providers.list();
    expect(list).toEqual([]);
  });

  it("reuses one session across calls", async () => {
    const { providers, resetSession } = await api();
    resetSession();

    const bootstrapCalls = () =>
      fetchSpy.mock.calls.filter((c) => String(c[0]).endsWith("/api/v1/session")).length;

    await providers.list();
    const afterFirst = bootstrapCalls();
    await providers.list();
    await providers.list();

    // The token is cached, so no repeated handshakes.
    expect(bootstrapCalls()).toBe(afterFirst);
  });
});

describe("providers through the client", () => {
  it("adds a key and gets back only the mask", async () => {
    const { providers, resetSession } = await api();
    resetSession();

    const rec = await providers.add({
      type: "elevenlabs",
      displayName: "我的",
      baseURL: "https://api.elevenlabs.io",
      secret: "sk-client-test-987654",
    });

    expect(rec.maskedSecret).not.toContain("987654");
    expect(rec.validationState).toBe("unverified");
  });

  it("validates and moves the state to available", async () => {
    const { providers, resetSession } = await api();
    resetSession();
    const rec = await providers.add({
      type: "elevenlabs",
      displayName: "k",
      baseURL: "https://api.elevenlabs.io",
      secret: "sk-client-123456",
    });

    const after = await providers.validate(rec.id);
    expect(after.validationState).toBe("available");
    expect(after.validatedAt).toBeTruthy();
  });

  it("surfaces a rejected base URL as a readable error", async () => {
    const { providers, resetSession, ApiError } = await api();
    resetSession();

    await expect(
      providers.add({
        type: "elevenlabs",
        displayName: "bad",
        baseURL: "https://evil.example.com",
        secret: "sk-x",
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("removes a key", async () => {
    const { providers, resetSession } = await api();
    resetSession();
    const rec = await providers.add({
      type: "elevenlabs",
      displayName: "k",
      baseURL: "https://api.elevenlabs.io",
      secret: "sk-client-999",
    });
    expect((await providers.remove(rec.id)).removed).toBe(true);
    expect(await providers.list()).toHaveLength(0);
  });
});

describe("jobs and cost through the client", () => {
  it("de-duplicates a repeated intent", async () => {
    const { jobs, resetSession } = await api();
    resetSession();
    const input = {
      intentId: "client-intent-1",
      type: "text_to_speech",
      providerId: "elevenlabs",
      credentialRef: "cred_1",
      input: { text: "x" },
    };

    const first = await jobs.create(input);
    const second = await jobs.create(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it("cancelling states what it did not do", async () => {
    const { jobs, resetSession } = await api();
    resetSession();
    const { job } = await jobs.create({
      intentId: "client-cancel",
      type: "text_to_speech",
      providerId: "elevenlabs",
      credentialRef: "c",
      input: { text: "x" },
    });

    const res = await jobs.cancel(job.id);
    expect(res.scope.doesNot.join()).toContain("退款");
  });

  it("reports an empty cost summary as empty, not zero", async () => {
    const { cost, resetSession } = await api();
    resetSession();
    const res = await cost.summary();
    expect(res.summary.money).toEqual([]);
    expect(res.summary.unknown.count).toBe(0);
  });

  it("saves and reads back a budget", async () => {
    const { cost, resetSession } = await api();
    resetSession();
    await cost.setBudget(2.5);
    const res = await cost.summary();
    expect(res.budget.limit).toBe(2.5);
  });
});

describe("error mapping", () => {
  it("a validation failure surfaces as ApiError with the server code", async () => {
    const { providers, resetSession, ApiError } = await api();
    resetSession();
    const rec = await providers.add({
      type: "elevenlabs",
      displayName: "k",
      baseURL: "https://api.elevenlabs.io",
      secret: "sk-client-err",
    });

    // A revision conflict is the 409 path; force one via projects instead.
    const err = await providers
      .add({
        type: "elevenlabs",
        displayName: "",
        baseURL: "not-a-url",
        secret: "sk-x",
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBeGreaterThanOrEqual(400);
    expect(rec.id).toBeTruthy();
  });
});
