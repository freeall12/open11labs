// @vitest-environment node
// Same cross-realm AbortSignal reason as local-tts-e2e: the adapter passes a
// Node AbortController signal to fetch, which a jsdom-realm signal rejects.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalServer } from "../../server/index.mjs";
import { Vault } from "../../server/lib/vault.mjs";
import { ElevenLabsAdapter } from "../../packages/providers/elevenlabs/adapter.mjs";

/* ==========================================================================
   Music generation (documented POST /v1/music/compose).

   The endpoint is paid-tier and has never been called with a real key —
   everything here pins the DOCUMENTED request shape so the unverified path
   cannot silently drift: prompt-or-composition_plan, music_length_ms,
   model_id, and nothing invented (variants/lyricsMode must NOT be forwarded).
   ========================================================================== */

function adapterWith(capture) {
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
  return new ElevenLabsAdapter({
    apiKey: "sk-music-fixture",
    fetchImpl: async (url, init) => {
      capture.push({ url: String(url), method: init?.method, body: init?.body });
      return new Response(mp3, {
        status: 200,
        headers: { "content-type": "audio/mpeg", "x-request-id": "req_music_1" },
      });
    },
  });
}

describe("ElevenLabsAdapter.submitMusic — documented request shape", () => {
  it("prompt path sends exactly the documented fields", async () => {
    const cap = [];
    const a = adapterWith(cap);
    const out = await a.submitMusic({
      key: "k",
      prompt: "轻快的电子开场曲",
      durationSeconds: 30,
      modelId: undefined,
    });
    const req = cap.at(-1);
    expect(req.url.endsWith("/v1/music/compose")).toBe(true);
    expect(req.method).toBe("POST");
    const body = JSON.parse(req.body);
    expect(body).toEqual({
      prompt: "轻快的电子开场曲",
      model_id: "music_v2_5",
      music_length_ms: 30000,
    });
    expect(body.variants).toBeUndefined();
    expect(out.artifact.contentType).toBe("audio/mpeg");
    expect(out.artifact.suggestedName.endsWith(".mp3")).toBe(true);
  });

  it("custom lyrics travel as the documented composition plan", async () => {
    const cap = [];
    const a = adapterWith(cap);
    await a.submitMusic({
      key: "k",
      prompt: "片尾曲",
      lyrics: "夜色温柔\n风穿过街口",
      includeLyrics: true,
      durationSeconds: 45,
    });
    const body = JSON.parse(cap.at(-1).body);
    expect(body.composition_plan).toEqual({
      chunks: [{ text: "夜色温柔\n风穿过街口", durationMs: 45000 }],
    });
    expect(body.music_length_ms).toBe(45000);
    expect(body.prompt).toBeUndefined();
  });

  it("lyrics without a duration are refused instead of guessed", async () => {
    const a = adapterWith([]);
    await expect(
      a.submitMusic({ key: "k", prompt: "x", lyrics: "词", includeLyrics: true, durationSeconds: null }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("omits music_length_ms when no duration was chosen", async () => {
    const cap = [];
    await adapterWith(cap).submitMusic({ key: "k", prompt: "自动时长" });
    const body = JSON.parse(cap.at(-1).body);
    expect(body).toEqual({ prompt: "自动时长", model_id: "music_v2_5" });
  });
});

/** Shared so the test body can assert what the runner forwarded. */
const musicStub = {
  async validateCredential() {
    return { ok: true, modelCount: 1 };
  },
  async listCapabilities() {
    return [];
  },
  calls: [],
  async submitMusic(input) {
    this.calls.push(input);
    return {
      artifact: {
        bytes: new Uint8Array([0x49, 0x44, 0x33, 0x01]),
        contentType: "audio/mpeg",
        suggestedName: "music-test.mp3",
      },
      providerRequestId: "req_m_1",
    };
  },
};

describe("music_generation through the real server", () => {
  let server;
  let PORT;
  let HOST;

  beforeAll(async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "o11-music-e2e-"));
    writeFileSync(join(dataDir, "index.html"), "<!doctype html><title>t</title>");
    const handle = createLocalServer({
      root: dataDir,
      vault: new Vault(),
      port: 0,
      dataDir,
      log: () => {},
      providerAdapters: { elevenlabs: musicStub },
    });
    await new Promise((r) => handle.server.listen(0, "127.0.0.1", r));
    handle.adoptActualPort();
    server = handle.server;
    PORT = server.address().port;
    HOST = `127.0.0.1:${PORT}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it("creates, runs and stores the artifact, forwarding page input", async () => {
    const boot = await fetch(`http://127.0.0.1:${PORT}/api/v1/session`, { headers: { host: HOST } });
    const bb = await boot.json();
    const cookie = boot.headers.get("set-cookie").split(";")[0];
    const H = {
      host: HOST,
      origin: `http://${HOST}`,
      cookie,
      "x-csrf-token": bb.csrfToken,
      "content-type": "application/json",
    };
    const reg = await fetch(`http://127.0.0.1:${PORT}/api/v1/providers`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        type: "elevenlabs",
        displayName: "音乐stub",
        secret: "sk-music-server-fixture",
        baseURL: "https://api.elevenlabs.io",
      }),
    });
    const provider = (await reg.json()).provider;
    await fetch(`http://127.0.0.1:${PORT}/api/v1/providers/${provider.id}/validate`, {
      method: "POST",
      headers: H,
    });

    const created = await fetch(`http://127.0.0.1:${PORT}/api/v1/jobs`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        intentId: `music:${provider.id}:e2e`,
        type: "music_generation",
        providerId: provider.id,
        credentialRef: provider.id,
        input: {
          prompt: "测试曲目",
          lyrics: null,
          includeLyrics: false,
          durationSeconds: 20,
          variants: 2,
          acknowledgeUnknownCost: true,
        },
      }),
    });
    const jobId = (await created.json()).job.id;
    const run = await fetch(`http://127.0.0.1:${PORT}/api/v1/jobs/${jobId}/run`, {
      method: "POST",
      headers: H,
    });
    const body = await run.json();
    expect(run.status).toBe(200);
    expect(body.job.status).toBe("succeeded");
    expect(body.asset?.displayName).toBe("music-test.mp3");

    // What the runner forwarded: page input mapped onto submitMusic, with the
    // undocumented variants field NOT carried into the adapter call.
    expect(musicStub.calls.at(-1)).toMatchObject({
      prompt: "测试曲目",
      includeLyrics: false,
      durationSeconds: 20,
    });
    expect(musicStub.calls.at(-1).variants).toBeUndefined();
  });
});
