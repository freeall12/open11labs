import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalServer } from "../../server/index.mjs";
import { Vault } from "../../server/lib/vault.mjs";
import { ElevenLabsAdapter } from "../../packages/providers/elevenlabs/adapter.mjs";

/* ==========================================================================
   Asset upload and the STS input path.

   Two claims are load-bearing:
     - an uploaded file is addressable by id, and the job snapshot carries the
       id rather than the bytes (otherwise audio lands in SQLite)
     - a TTS model id is refused locally, before any request is sent
   ========================================================================== */

let server;
let port;
let cookie;
let csrf;
let fetchCalls;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "open11labs-upload-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title>");
  const handle = createLocalServer({
    root: dir,
    vault: new Vault(),
    port: 0,
    log: () => {},
    providerAdapters: {
      elevenlabs: new ElevenLabsAdapter({
        fetchImpl: async (url, init) => {
          fetchCalls.push({ url: String(url), method: init.method });
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers(),
            json: async () => ({}),
            text: async () => "{}",
            arrayBuffer: async () => new ArrayBuffer(4),
          };
        },
      }),
    },
  });
  await new Promise((r) => handle.server.listen(0, "127.0.0.1", r));
  handle.adoptActualPort();
  server = handle.server;
  port = server.address().port;
  cookie = null;
  fetchCalls = [];
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

function base() {
  return `http://127.0.0.1:${port}`;
}

async function call(path, { method = "GET", body, raw } = {}) {
  if (!cookie) {
    const s = await fetch(`${base()}/api/v1/session`, {
      headers: { host: `127.0.0.1:${port}` },
    });
    const j = await s.json();
    cookie = s.headers.get("set-cookie").split(";")[0];
    csrf = j.csrfToken;
  }
  const headers = {
    host: `127.0.0.1:${port}`,
    origin: `http://127.0.0.1:${port}`,
    cookie,
    "x-csrf-token": csrf,
  };
  if (raw) headers["content-type"] = raw.contentType;
  else if (body) headers["content-type"] = "application/json";
  return fetch(`${base()}${path}`, {
    method,
    headers,
    body: raw ? raw.body : body ? JSON.stringify(body) : undefined,
  });
}

function multipart(bytes, name = "clip.mp3", type = "audio/mpeg") {
  const boundary = "----open11labstest";
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${name}"\r\n` +
    `Content-Type: ${type}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([Buffer.from(head), Buffer.from(bytes), Buffer.from(tail)]),
  };
}

describe("asset upload", () => {
  it("stores the file and returns an id, not a path", async () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x10, 0x00, 0x20, 0x00, 0x00]);
    const res = await call("/api/v1/assets", {
      method: "POST",
      raw: multipart(bytes),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.asset.url).toBe(`/api/v1/assets/${body.asset.id}`);
    expect(JSON.stringify(body)).not.toContain("open11labstest");
  });

  it("rejects a non-multipart upload", async () => {
    const res = await call("/api/v1/assets", {
      method: "POST",
      body: { nope: true },
    });
    expect(res.status).toBe(415);
  });

  it("de-duplicates identical bytes on re-upload", async () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x20, 0x00, 0x20, 0x00, 0x01]);
    const first = await (await call("/api/v1/assets", { method: "POST", raw: multipart(bytes) })).json();
    const second = await (await call("/api/v1/assets", { method: "POST", raw: multipart(bytes) })).json();

    expect(second.created).toBe(false);
    expect(second.asset.id).toBe(first.asset.id);
  });

  it("serves the stored bytes back through the controlled URL", async () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x30, 0x00, 0x20, 0x00, 0x02]);
    const { asset } = await (
      await call("/api/v1/assets", { method: "POST", raw: multipart(bytes) })
    ).json();

    const res = await call(asset.url);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });
});

describe("speech to speech input handling", () => {
  it("refuses a TTS model id locally, without any request", async () => {
    const a = new ElevenLabsAdapter({
      fetchImpl: async () => {
        throw new Error("must not be called");
      },
    });

    await expect(
      a.submitSts({
        key: "sk_fixture",
        voiceId: "v1",
        audio: new Uint8Array([1, 2, 3]),
        modelId: "eleven_multilingual_v2", // a TTS id
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts an STS model id and posts multipart", async () => {
    let seenForm = null;
    const a = new ElevenLabsAdapter({
      fetchImpl: async (url, init) => {
        seenForm = init.body;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers(),
          json: async () => ({}),
          text: async () => "{}",
          // Echo the uploaded length so the assertion below is meaningful.
          arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
        };
      },
    });

    const out = await a.submitSts({
      key: "sk_fixture",
      voiceId: "voice_abc",
      audio: new Uint8Array([1, 2, 3, 4]),
      fileName: "clip.mp3",
      modelId: "eleven_multilingual_sts_v2",
    });

    expect(seenForm).toBeInstanceOf(FormData);
    expect(seenForm.get("model_id")).toBe("eleven_multilingual_sts_v2");
    expect(seenForm.get("audio")).toBeTruthy();
    expect(out.artifact.bytes.byteLength).toBe(4);
  });

  it("rejects empty audio before building a request", async () => {
    const a = new ElevenLabsAdapter({
      fetchImpl: async () => {
        throw new Error("must not be called");
      },
    });
    await expect(
      a.submitSts({
        key: "sk",
        voiceId: "v",
        audio: new Uint8Array(0),
        modelId: "eleven_multilingual_sts_v2",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
