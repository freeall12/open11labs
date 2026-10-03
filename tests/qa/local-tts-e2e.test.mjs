// @vitest-environment node
// The adapter under test passes its AbortController signal to Node's undici
// fetch; a jsdom-realm signal is rejected across realms (same class of bug as
// the cross-realm Uint8Array check the integrator fixed). This file drives
// no DOM, so it runs in the plain node environment.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalServer } from "../../server/index.mjs";
import { Vault } from "../../server/lib/vault.mjs";
import { startMockOpenAI } from "./helpers/mock-openai-server.mjs";

/* ==========================================================================
   D-02 regression: local (self-hosted, OpenAI-compatible) TTS end to end.

   Before the fix, the runner dispatched text_to_speech to the local
   adapter's chat-only submit(): /v1/audio/speech was never called and a
   text "reply" was recorded as a successful audio artifact. This test runs
   the whole chain — provider registration, job create, run, artifact bytes —
   against a real loopback server plus a mock speech endpoint. Nothing leaves
   the machine and no real key is involved.
   ========================================================================== */

let server;
let PORT;
let HOST;
let mock;

beforeAll(async () => {
  mock = await startMockOpenAI({ port: 0 });
  const dataDir = mkdtempSync(join(tmpdir(), "o11-local-tts-e2e-"));
  writeFileSync(join(dataDir, "index.html"), "<!doctype html><title>t</title>");
  const handle = createLocalServer({
    root: dataDir,
    vault: new Vault(),
    port: 0,
    dataDir,
    log: () => {},
  });
  await new Promise((r) => handle.server.listen(0, "127.0.0.1", r));
  handle.adoptActualPort();
  server = handle.server;
  PORT = server.address().port;
  HOST = `127.0.0.1:${PORT}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await mock.close();
});

let cookie;
let csrf;

async function call(path, { method = "GET", body } = {}) {
  const headers = { host: HOST, origin: `http://${HOST}`, cookie, "x-csrf-token": csrf };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

describe("local provider TTS end to end (D-02 regression)", () => {
  it("routes a TTS job to /v1/audio/speech and stores real audio", async () => {
    const boot = await fetch(`http://127.0.0.1:${PORT}/api/v1/session`, { headers: { host: HOST } });
    const bootBody = await boot.json();
    cookie = boot.headers.get("set-cookie").split(";")[0];
    csrf = bootBody.csrfToken;

    // Register the self-hosted speech server. Loopback http needs the explicit
    // self-hosted opt-in; the secret is a placeholder for a keyless local box.
    const reg = await call("/api/v1/providers", {
      method: "POST",
      body: {
        type: "openai-local",
        displayName: "本地语音(测试)",
        secret: "local-e2e-placeholder",
        baseURL: `http://127.0.0.1:${mock.port}`,
        selfHosted: true,
      },
    });
    expect(reg.status).toBe(201);
    const provider = (await reg.json()).provider;

    // The runner refuses to submit through an unvalidated credential, so
    // confirm it against the mock's /v1/models first.
    const validate = await call(`/api/v1/providers/${provider.id}/validate`, { method: "POST" });
    expect(validate.status).toBe(200);
    expect((await validate.json()).provider.validationState).toBe("available");

    const created = await call("/api/v1/jobs", {
      method: "POST",
      body: {
        intentId: `e2e:local-tts:${provider.id}`,
        type: "text_to_speech",
        providerId: provider.id,
        credentialRef: provider.id,
        input: {
          text: "端到端",
          voiceId: "alloy",
          outputFormat: "mp3_44100_128",
          acknowledgeUnknownCost: true,
        },
      },
    });
    expect(created.status).toBe(201);
    const jobId = (await created.json()).job.id;

    const run = await call(`/api/v1/jobs/${jobId}/run`, { method: "POST" });
    expect(run.status).toBe(200);
    const runBody = await run.json();
    expect(runBody.job.status).toBe("succeeded");
    expect(runBody.asset).toBeTruthy();

    // The speech endpoint was hit exactly once; the chat endpoint never was.
    expect(mock.seen.speech).toBe(1);
    expect(mock.seen.chat).toBe(0);
    const speechReq = mock.requests.find((r) => r.includes("/v1/audio/speech"));
    expect(speechReq).toBeTruthy();

    // The stored artifact is the WAV the mock produced, not a text "reply".
    const file = await call(`/api/v1/assets/${runBody.asset.id}`);
    expect(file.status).toBe(200);
    const buf = Buffer.from(await file.arrayBuffer());
    expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(buf.length).toBeGreaterThan(44);
  });
});
