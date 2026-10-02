import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalServer } from "../../server/index.mjs";
import { Vault } from "../../server/lib/vault.mjs";

/* ==========================================================================
   Voice catalogue.

   The payload has never been seen with a real credential, so the behaviour
   under test is the defensive one: an unrecognised shape must produce a
   reason and no fabricated voices, and a transport failure must surface as a
   failure rather than an empty picker that looks like "no voices exist".
   ========================================================================== */

let server;
let port;
let base;

const KNOWN_SHAPE = {
  voices: [
    {
      voice_id: "voice_synthetic_a",
      name: "Aria",
      category: "premade",
      preview_url: "https://example.invalid/preview-a.mp3",
      labels: { language: "en", gender: "female" },
    },
    {
      voice_id: "voice_synthetic_b",
      name: "Chen",
      category: "cloned",
      preview_url: "https://example.invalid/preview-b.mp3",
      labels: { language: "zh", gender: "male" },
    },
  ],
};

const UNKNOWN_SHAPE = { data: { items: [] } };

let listVoicesImpl;

const adapter = {
  elevenlabs: {
    async validateCredential() {
      return { ok: true, modelCount: 1 };
    },
    async listCapabilities() {
      return [];
    },
    async listVoices() {
      return listVoicesImpl();
    },
  },
};

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "open11labs-voices-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title>");
  const handle = createLocalServer({
    root: dir,
    vault: new Vault(),
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

/* The server is rebuilt per test, so a cached session from an earlier test is
   no longer valid. Clear it alongside the new server. */
beforeEach(() => {
  cookie = null;
  csrf = null;
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

async function addKey() {
  const res = await call("/api/v1/providers", {
    method: "POST",
    body: {
      type: "elevenlabs",
      baseURL: "https://api.elevenlabs.io",
      secret: "sk-voices-test-1234",
    },
  });
  return (await res.json()).provider;
}

describe("voice catalogue endpoint", () => {
  it("returns voices plus a reason slot", async () => {
    await addKey();
    listVoicesImpl = async () => ({ voices: KNOWN_SHAPE.voices, reason: null });

    const body = await (await call("/api/v1/voices")).json();
    expect(body.reason).toBeNull();
    expect(Array.isArray(body.voices)).toBe(true);
  });

  it("says so plainly when no provider is configured", async () => {
    listVoicesImpl = async () => ({ voices: [], reason: null });
    const body = await (await call("/api/v1/voices")).json();

    expect(body.voices).toEqual([]);
    expect(body.needsProvider).toBe(true);
  });

  it("reports an unrecognised payload instead of inventing voices", async () => {
    await addKey();
    listVoicesImpl = async () => ({ voices: [], reason: "音色列表响应结构未识别" });

    const body = await (await call("/api/v1/voices")).json();
    expect(body.voices).toEqual([]);
    expect(body.reason).toContain("未识别");
  });

  it("surfaces a transport failure as a reason, not a silent empty list", async () => {
    await addKey();
    listVoicesImpl = async () => {
      const e = new Error("nope");
      e.code = "PROVIDER_AUTH_FAILED";
      e.safeMessage = "API 密钥无效或已失效";
      throw e;
    };

    const res = await call("/api/v1/voices");
    const body = await res.json();

    expect(body.voices).toEqual([]);
    expect(body.reason).toContain("密钥");
    expect(body.error.code).toBe("PROVIDER_AUTH_FAILED");
  });
});

describe("adapter voice parsing", () => {
  it("maps a known shape and flags every entry unverified", async () => {
    const { ElevenLabsAdapter } = await import(
      "../../packages/providers/elevenlabs/adapter.mjs"
    );
    const calls = [];
    const a = new ElevenLabsAdapter({
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "request-id": "req_v1" }),
          json: async () => KNOWN_SHAPE,
          text: async () => JSON.stringify(KNOWN_SHAPE),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    });

    const out = await a.listVoices("sk_fixture");
    expect(out.voices).toHaveLength(2);
    expect(out.voices[0].voiceId).toBe("voice_synthetic_a");
    // Nothing about a real key has been observed, so nothing claims to work.
    expect(out.voices.every((v) => v.unverified)).toBe(true);
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/voices");
    expect(calls[0].init.method).toBe("GET");
  });

  it("drops entries with no usable id rather than emitting blanks", async () => {
    const { ElevenLabsAdapter } = await import(
      "../../packages/providers/elevenlabs/adapter.mjs"
    );
    const a = new ElevenLabsAdapter({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        json: async () => ({ voices: [{ name: "no id" }, { voice_id: "ok_1" }] }),
        text: async () => "{}",
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });

    const out = await a.listVoices("sk_fixture");
    expect(out.voices.map((v) => v.voiceId)).toEqual(["ok_1"]);
  });

  it("never fetches a preview url — it only records it", async () => {
    const { ElevenLabsAdapter } = await import(
      "../../packages/providers/elevenlabs/adapter.mjs"
    );
    const calls = [];
    const a = new ElevenLabsAdapter({
      fetchImpl: async (url) => {
        calls.push(String(url));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers(),
          json: async () => KNOWN_SHAPE,
          text: async () => "{}",
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    });

    await a.listVoices("sk_fixture");
    // Exactly one call, and it is the catalogue — not the preview media.
    expect(calls).toEqual(["https://api.elevenlabs.io/v1/voices"]);
  });
});
