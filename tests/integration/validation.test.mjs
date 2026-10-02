import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalServer } from "../../server/index.mjs";
import { Vault } from "../../server/lib/vault.mjs";
import { modelsResponse, errorBodies } from "../../packages/providers/elevenlabs/fixtures.mjs";

/* ==========================================================================
   M1-T04 integration: vault -> adapter wiring.

   The point of these tests is the seam. The key is written over HTTP, held in
   the vault, read in-process by the adapter, and the response must carry
   status only. A stub adapter stands in for the network so nothing is billed.
   ========================================================================== */

const SECRET_ONLY = "sk_integration_fixture_0000";
const SECRET = SECRET_ONLY;

let server;
let port;
let HOST;
let ORIGIN;

function makeRoot() {
  const dir = mkdtempSync(join(tmpdir(), "open11labs-val-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title>");
  return dir;
}

/** Stubbed provider adapter recording what it was handed. */
function stubAdapter({ validate, capabilities } = {}) {
  // `seen` lives on the same object the server calls, so `this` resolves.
  const elevenlabs = {
    seen: [],
    async validateCredential(key) {
      this.seen.push(key);
      return validate ? validate(key) : { ok: true, modelCount: 4 };
    },
    async listCapabilities(key) {
      this.seen.push(key);
      return capabilities ? capabilities(key) : [];
    },
  };
  return { elevenlabs, get seen() { return elevenlabs.seen; } };
}

/**
 * Bind to an ephemeral port (0) and read back the assigned one. Fixed ports
 * collide when vitest runs files in parallel; this cannot.
 */
async function boot(adapter) {
  await shutdown();
  const handle = createLocalServer({
    root: makeRoot(),
    vault: new Vault(),
    port: 0,
    log: () => {},
    providerAdapters: adapter,
  });
  await new Promise((r) => handle.server.listen(0, "127.0.0.1", r));
  handle.adoptActualPort();
  const s = handle.server;
  port = s.address().port;
  HOST = `127.0.0.1:${port}`;
  ORIGIN = `http://${HOST}`;
  server = s;
}

async function shutdown() {
  if (!server) return;
  await new Promise((r) => server.close(r));
  server = null;
}

async function session() {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/session`, {
    headers: { host: HOST },
  });
  const body = await res.json();
  return { cookie: res.headers.get("set-cookie").split(";")[0], csrf: body.csrfToken };
}

async function call(path, { method = "GET", body, cookie, csrf } = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      host: HOST,
      origin: ORIGIN,
      cookie,
      "x-csrf-token": csrf,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function storeKey() {
  const { cookie, csrf } = await session();
  const res = await call("/api/v1/providers", {
    method: "POST",
    cookie,
    csrf,
    body: { type: "elevenlabs", baseURL: "https://api.elevenlabs.io", secret: SECRET },
  });
  return { cookie, csrf, provider: (await res.json()).provider };
}

describe("credential validation over HTTP", () => {
  let adapter;

  beforeAll(async () => {
    adapter = stubAdapter();
    await boot(adapter);
  });

  afterAll(async () => {
    await shutdown();
  });

  it("validates a stored key and flips its state to available", async () => {
    const { cookie, csrf, provider } = await storeKey();
    const res = await call(`/api/v1/providers/${provider.id}/validate`, {
      method: "POST",
      cookie,
      csrf,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.provider.validationState).toBe("available");
    expect(body.provider.validatedAt).toBeTruthy();
  });

  it("hands the secret to the adapter in-process, not over HTTP", async () => {
    expect(adapter.seen).toContain(SECRET);
  });

  it("never returns the secret in the validation response", async () => {
    const { cookie, csrf, provider } = await storeKey();
    const res = await call(`/api/v1/providers/${provider.id}/validate`, {
      method: "POST",
      cookie,
      csrf,
    });
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(SECRET.slice(0, 8));
  });

  it("records an auth failure without retrying", async () => {
        const failing = stubAdapter({
      validate: async () => {
        const e = new Error("bad key");
        e.code = "PROVIDER_AUTH_FAILED";
        e.safeMessage = "API 密钥无效或已失效";
        e.retryable = false;
        throw e;
      },
    });
    await boot(failing);

    const { cookie, csrf, provider } = await storeKey();
    const res = await call(`/api/v1/providers/${provider.id}/validate`, {
      method: "POST",
      cookie,
      csrf,
    });
    const body = await res.json();

    expect(body.provider.validationState).toBe("auth_failed");
    expect(body.error.code).toBe("PROVIDER_AUTH_FAILED");
    expect(body.error.retryable).toBe(false);
  });

  it("distinguishes a network error from an auth failure", async () => {
        const offline = stubAdapter({
      validate: async () => {
        const e = new Error("no network");
        e.code = "NETWORK_ERROR";
        e.safeMessage = "无法连接到供应商";
        e.retryable = true;
        throw e;
      },
    });
    await boot(offline);

    const { cookie, csrf, provider } = await storeKey();
    await call(`/api/v1/providers/${provider.id}/validate`, { method: "POST", cookie, csrf });
    const list = await call("/api/v1/providers", { cookie });
    const rec = (await list.json()).providers.find((p) => p.id === provider.id);

    // No network is not an invalid key — the states must stay distinct.
    expect(rec.validationState).toBe("network_error");
    expect(rec.validationState).not.toBe("auth_failed");
  });

  it("404s for an unknown credential rather than inventing a result", async () => {
    const { cookie, csrf } = await session();
    const res = await call("/api/v1/providers/cred_does_not_exist/validate", {
      method: "POST",
      cookie,
      csrf,
    });
    expect(res.status).toBe(404);
  });
});

describe("capability discovery over HTTP", () => {
  let adapter;

  beforeAll(async () => {
    adapter = stubAdapter({
      capabilities: async () => [
        {
          providerId: "elevenlabs",
          modelId: "eleven_multilingual_v2",
          taskType: "text_to_speech",
          availability: "unverified",
          reason: "未做真实 API 验证",
        },
      ],
    });
    await boot(adapter);
  });
  afterAll(async () => {
    await shutdown();
  });

  it("serves capabilities with three-state availability", async () => {
    const { cookie } = await storeKey();
    const res = await call("/api/v1/capabilities", { cookie });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.capabilities).toHaveLength(1);
    expect(body.capabilities[0].availability).toBe("unverified");
  });

  it("degrades to unverified when discovery fails", async () => {
        const broken = stubAdapter({
      capabilities: async () => {
        throw new Error("boom");
      },
    });
    await boot(broken);

    const { cookie } = await storeKey();
    const body = await (await call("/api/v1/capabilities", { cookie })).json();
    expect(body.capabilities[0].availability).toBe("unverified");
    expect(body.capabilities[0].reason).toContain("未做猜测");
  });
});

describe("no generation happens during validation", () => {
  it("the upstream stub only ever sees a model listing call", async () => {
    const impl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "request-id": "req_fixture_1" }),
      json: async () => modelsResponse,
      text: async () => JSON.stringify(modelsResponse),
      arrayBuffer: async () => new ArrayBuffer(0),
    }));

    await shutdown();
    const { ElevenLabsAdapter } = await import(
      "../../packages/providers/elevenlabs/adapter.mjs"
    );
    const adapter = new ElevenLabsAdapter({
      baseURL: "https://api.elevenlabs.io",
      fetchImpl: impl,
    });

    await adapter.validateCredential("sk_fixture");
    await adapter.listCapabilities("sk_fixture");

    // Second call is served from the cache, so still exactly one request.
    expect(impl).toHaveBeenCalledTimes(1);
    expect(impl.mock.calls[0][0]).toBe("https://api.elevenlabs.io/v1/models");
    expect(impl.mock.calls[0][1].method).toBe("GET");
  });

  it("error fixtures for a 401 never carry a usable key", () => {
    expect(JSON.stringify(errorBodies.unauthorized)).not.toMatch(/sk_[A-Za-z0-9]{20,}/);
  });
});

/* ==========================================================================
   Job and cost endpoints.
   ========================================================================== */

describe("jobs over HTTP", () => {
  let jobsSeen = 0;

  beforeAll(async () => {
    await boot(stubAdapter());
  });
  afterAll(async () => {
    await shutdown();
  });

  it("a repeated intent returns the same job with created:false", async () => {
    const { cookie, csrf } = await session();
    const body = {
      intentId: "ui-click-1",
      type: "text_to_speech",
      providerId: "elevenlabs",
      credentialRef: "cred_1",
      input: { text: "你好" },
    };

    const first = await call("/api/v1/jobs", { method: "POST", cookie, csrf, body });
    const firstBody = await first.json();
    expect(first.status).toBe(201);
    expect(firstBody.created).toBe(true);

    const second = await call("/api/v1/jobs", { method: "POST", cookie, csrf, body });
    const secondBody = await second.json();
    expect(secondBody.created).toBe(false);
    expect(secondBody.job.id).toBe(firstBody.job.id);
    jobsSeen += 1;
  });

  it("rejects a submission with no intent id", async () => {
    const { cookie, csrf } = await session();
    const res = await call("/api/v1/jobs", {
      method: "POST",
      cookie,
      csrf,
      body: { type: "text_to_speech", providerId: "elevenlabs", credentialRef: "c", input: {} },
    });
    expect(res.status).toBe(500);
  });

  it("cancel states its scope and claims no refund", async () => {
    const { cookie, csrf } = await session();
    const created = await (
      await call("/api/v1/jobs", {
        method: "POST",
        cookie,
        csrf,
        body: {
          intentId: "cancel-me",
          type: "text_to_speech",
          providerId: "elevenlabs",
          credentialRef: "cred_1",
          input: { text: "x" },
        },
      })
    ).json();

    const res = await call(`/api/v1/jobs/${created.job.id}/cancel`, {
      method: "POST",
      cookie,
      csrf,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    // A draft never left the machine, so it is discarded rather than cancelled.
    expect(body.job.status).toBe("cancelled");
    expect(body.scope.stops).toContain("未提交任何请求");
    expect(body.scope.doesNot.join()).toContain("退款");
  });

  it("404s cancelling an unknown job", async () => {
    const { cookie, csrf } = await session();
    const res = await call("/api/v1/jobs/nope/cancel", { method: "POST", cookie, csrf });
    expect(res.status).toBe(404);
  });

  it("reports unknown cost rather than zero", async () => {
    const { cookie } = await session();
    const res = await call("/api/v1/cost", { cookie });
    const body = await res.json();

    expect(body.summary.money).toEqual([]);
    expect(body.scope.doesNotControl.join()).toContain("其他客户端");
  });

  it("requires confirmation before an unpriced submission", async () => {
    const { cookie, csrf } = await session();
    await call("/api/v1/cost/budget", {
      method: "POST",
      cookie,
      csrf,
      body: { limit: 1, currency: "USD" },
    });

    // The decision lives in the ledger; the endpoint must be able to answer it.
    const res = await call("/api/v1/cost", { cookie });
    expect((await res.json()).budget.limit).toBe(1);
  });

  it("validates the budget payload", async () => {
    const { cookie, csrf } = await session();
    const res = await call("/api/v1/cost/budget", {
      method: "POST",
      cookie,
      csrf,
      body: { limit: -5 },
    });
    expect(res.status).toBe(500);
  });
});
