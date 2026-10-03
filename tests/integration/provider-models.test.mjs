import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalServer } from "../../server/index.mjs";
import { Vault } from "../../server/lib/vault.mjs";

/* ==========================================================================
   Model listing for a saved credential.

   The chat page needs a model id. Inventing one would produce a request that
   fails for a reason the user cannot see, so the server has to answer with
   either the provider's real list or a stated reason — never a default.
   ========================================================================== */

let server;
let port;
let base;
let vault;
let modelsImpl;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "open11labs-models-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title>");
  vault = new Vault();

  // A stand-in for the local adapter: same shape, no network.
  const adapter = {
    elevenlabs: {
      async validateCredential() {
        return { ok: true, modelCount: 1 };
      },
      async listCapabilities() {
        return [];
      },
    },
    "openai-local": {
      async validateCredential() {
        return { ok: true, modelCount: 2 };
      },
      async listCapabilities() {
        return [];
      },
      async listModels() {
        return modelsImpl();
      },
    },
  };

  const handle = createLocalServer({
    root: dir,
    vault,
    port: 0,
    log: () => {},
    providerAdapters: adapter,
  });
  await new Promise((r) => handle.server.listen(0, "127.0.0.1", r));
  handle.adoptActualPort();
  server = handle.server;
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

let cookie;
let csrf;

beforeEach(() => {
  cookie = null;
  csrf = null;
  modelsImpl = () => [{ id: "qwen2.5", source: "provider_list" }];
});

async function call(path, { method = "GET", body } = {}) {
  if (!cookie) {
    const s = await fetch(`${base}/api/v1/session`, {
      headers: { host: `127.0.0.1:${port}` },
    });
    const j = await s.json();
    cookie = s.headers.get("set-cookie").split(";")[0];
    csrf = j.csrfToken;
  }
  return fetch(`${base}${path}`, {
    method,
    headers: {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
      cookie,
      "x-csrf-token": csrf,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function addLocalProvider() {
  const res = await call("/api/v1/providers", {
    method: "POST",
    body: {
      type: "openai-local",
      displayName: "local",
      baseURL: "http://127.0.0.1:11434",
      secret: "no-auth-required",
      selfHosted: true,
    },
  });
  expect(res.status).toBe(201);
  return (await res.json()).provider;
}

describe("GET /api/v1/providers/:id/models", () => {
  it("returns the ids the provider published, tagged with their source", async () => {
    const p = await addLocalProvider();
    const res = await call(`/api/v1/providers/${p.id}/models`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toEqual([{ id: "qwen2.5", source: "provider_list" }]);
    expect(body.source).toBe("provider_list");
  });

  it("reports an empty list as an empty list, not as a failure", async () => {
    modelsImpl = () => [];
    const p = await addLocalProvider();
    const res = await call(`/api/v1/providers/${p.id}/models`);
    expect(res.status).toBe(200);
    expect((await res.json()).models).toEqual([]);
  });

  it("surfaces an upstream failure instead of an empty list", async () => {
    // The difference matters: "the server has no models" lets the user type a
    // name, while "we could not reach it" must not look like a fact.
    modelsImpl = () => {
      const e = new Error("unreachable");
      e.code = "NETWORK_ERROR";
      e.safeMessage = "无法连接本地服务：http://127.0.0.1:11434（服务是否已启动？）";
      throw e;
    };
    const p = await addLocalProvider();
    const res = await call(`/api/v1/providers/${p.id}/models`);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("NETWORK_ERROR");
    expect(body.models).toBeUndefined();
  });

  it("says unavailable for a provider type that has no model list", async () => {
    const res = await call("/api/v1/providers", {
      method: "POST",
      body: {
        type: "elevenlabs",
        displayName: "cloud",
        baseURL: "https://api.elevenlabs.io",
        secret: "sk-synthetic-not-real",
      },
    });
    const p = (await res.json()).provider;
    const r = await call(`/api/v1/providers/${p.id}/models`);
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("CAPABILITY_UNAVAILABLE");
  });

  it("404s an unknown credential rather than falling through to the id route", async () => {
    const res = await call("/api/v1/providers/does-not-exist/models");
    expect(res.status).toBe(404);
  });

  it("needs a session like every other read", async () => {
    const p = await addLocalProvider();
    cookie = null;
    csrf = null;
    const res = await fetch(`${base}/api/v1/providers/${p.id}/models`, {
      headers: { host: `127.0.0.1:${port}` },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
