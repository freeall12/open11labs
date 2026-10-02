import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalServer } from "../../server/index.mjs";
import { Vault } from "../../server/lib/vault.mjs";

/* ==========================================================================
   QA gap-fill: server API breadth.

   Coverage target: every route in server/index.mjs that the existing
   suites never exercise over HTTP:
     - GET /api/v1/vault, GET /api/v1/tools                (local health/tools)
     - POST /api/v1/providers/:id/rotate, DELETE/GET unknown provider
     - GET /api/v1/jobs (list), GET /api/v1/jobs/:id/events
     - POST /api/v1/jobs/:id/run  + re-run conflict (409)
     - POST /api/v1/jobs/:id/poll (running / draft / unknown job)
     - GET /api/v1/assets/:id/probe (wav / non-audio / unknown id)
     - GET+POST /api/v1/folders
     - projects list / PUT save (200 + 409 conflict) / DELETE unknown / variants
     - POST /api/v1/backup + /api/v1/backup/validate (valid + rejected)
     - 404 NO_SUCH_ENDPOINT, 400 BAD_JSON, 413 BODY_TOO_LARGE

   Why the existing tests do not cover this: contract/*.test.mjs test the
   store/runner/vault classes directly, and integration/{security,validation,
   upload,voices,client}.test.mjs each cover one endpoint family (providers,
   jobs-create/cancel, cost, assets-upload, voices). Nobody asserts the
   remaining routes answer at all, let alone with the right status codes.
   The server is a real listener on loopback with an ephemeral port, same as
   security.test.mjs; the provider adapter is a stub so nothing leaves the
   machine and no key is involved.
   ========================================================================== */

let server;
let PORT;
let HOST;
let ORIGIN;
let dataDir;

const SECRET = "sk-qa-breadth-fixture-0001";

/** Stub hosted adapter: synchronous TTS artifact + async image submit/poll. */
const stubAdapter = {
  async validateCredential() {
    return { ok: true, modelCount: 1 };
  },
  async listCapabilities() {
    return [];
  },
  async submit() {
    return {
      artifact: {
        bytes: new Uint8Array([0x49, 0x44, 0x33, 0x01, 0x02, 0x03]),
        contentType: "audio/mpeg",
        suggestedName: "qa-breadth.mp3",
      },
      providerRequestId: "req_qa_breadth",
    };
  },
  async submitAsync() {
    return { remoteId: "rem_qa_1", state: "running" };
  },
  async pollStatus() {
    return { state: "running" };
  },
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "open11labs-qa-breadth-"));
  writeFileSync(join(dataDir, "index.html"), "<!doctype html><title>t</title>");
  const handle = createLocalServer({
    root: dataDir,
    vault: new Vault(),
    port: 0,
    dataDir,
    log: () => {},
    providerAdapters: { elevenlabs: stubAdapter },
  });
  await new Promise((r) => handle.server.listen(0, "127.0.0.1", r));
  handle.adoptActualPort();
  server = handle.server;
  PORT = server.address().port;
  HOST = `127.0.0.1:${PORT}`;
  ORIGIN = `http://${HOST}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

let cookie;
let csrf;

async function call(path, { method = "GET", body, raw } = {}) {
  if (!cookie) {
    const s = await fetch(`http://127.0.0.1:${PORT}/api/v1/session`, {
      headers: { host: HOST },
    });
    const j = await s.json();
    cookie = s.headers.get("set-cookie").split(";")[0];
    csrf = j.csrfToken;
  }
  const headers = {
    host: HOST,
    origin: ORIGIN,
    cookie,
    "x-csrf-token": csrf,
  };
  if (raw) headers["content-type"] = raw.contentType;
  else if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers,
    body: raw ? raw.body : body === undefined ? undefined : JSON.stringify(body),
  });
}

function multipart(bytes, name = "clip.wav", type = "audio/wav") {
  const boundary = "----qabreadth";
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${name}"\r\n` +
    `Content-Type: ${type}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([Buffer.from(head), bytes, Buffer.from(tail)]),
  };
}

/** A structurally valid 16-bit PCM WAV (same construction as media fixtures). */
function makeWav({ seconds = 1, sampleRate = 8000 } = {}) {
  const frames = seconds * sampleRate;
  const dataBytes = frames * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const ascii = (off, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);
  for (let f = 0; f < frames; f++) {
    v.setInt16(44 + f * 2, Math.round(Math.sin((f / sampleRate) * 440 * 2 * Math.PI) * 20000), true);
  }
  return new Uint8Array(buf);
}

async function addProvider() {
  const res = await call("/api/v1/providers", {
    method: "POST",
    body: {
      type: "elevenlabs",
      displayName: "qa-breadth",
      baseURL: "https://api.elevenlabs.io",
      secret: SECRET,
    },
  });
  return (await res.json()).provider;
}

async function createJob(over = {}) {
  const provider = over.provider ?? (await addProvider());
  const res = await call("/api/v1/jobs", {
    method: "POST",
    body: {
      intentId: over.intentId ?? `qa-breadth-${Math.random().toString(36).slice(2)}`,
      type: over.type ?? "text_to_speech",
      providerId: "elevenlabs",
      modelId: over.modelId ?? null,
      credentialRef: provider.id,
      input: over.input ?? { text: "你好" },
    },
  });
  return (await res.json()).job;
}

/* ------------------------------------------------------- health & tools -- */

describe("vault health and local tools endpoints", () => {
  it("GET /api/v1/vault reports writeOnly and the live count", async () => {
    const before = await (await call("/api/v1/vault")).json();
    expect(before.writeOnly).toBe(true);
    await addProvider();
    const after = await (await call("/api/v1/vault")).json();
    expect(after.count).toBe(before.count + 1);
    // The health endpoint must not become a side channel for secret material.
    expect(JSON.stringify(after)).not.toContain(SECRET);
  });

  it("GET /api/v1/tools probes availability instead of assuming it", async () => {
    const body = await (await call("/api/v1/tools")).json();
    expect(Array.isArray(body.tools)).toBe(true);
    const ytdlp = body.tools.find((t) => t.id === "yt-dlp");
    expect(ytdlp).toBeTruthy();
    expect(typeof ytdlp.available).toBe("boolean");
    expect(ytdlp.install).toContain("yt-dlp");
  });
});

/* ------------------------------------------------------- provider edges -- */

describe("provider rotate and unknown-id edges", () => {
  it("POST /providers/:id/rotate keeps the id and never echoes the secret", async () => {
    const rec = await addProvider();
    const next = "sk-qa-rotated-9876543210";
    const res = await call(`/api/v1/providers/${rec.id}/rotate`, {
      method: "POST",
      body: { secret: next },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.provider.id).toBe(rec.id);
    expect(body.provider.rotatedAt).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(next);
  });

  it("GET an unknown provider 404s with NOT_FOUND", async () => {
    const res = await call("/api/v1/providers/cred_missing");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("DELETE an unknown provider answers 404 with removed:false", async () => {
    const res = await call("/api/v1/providers/cred_missing", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect((await res.json()).removed).toBe(false);
  });
});

/* ------------------------------------------------------------ jobs HTTP -- */

describe("job list, events, run and poll over HTTP", () => {
  it("GET /api/v1/jobs lists created jobs", async () => {
    const job = await createJob({ intentId: "qa-list-1" });
    const body = await (await call("/api/v1/jobs")).json();
    expect(body.jobs.some((j) => j.id === job.id)).toBe(true);
  });

  it("GET /api/v1/jobs/:id/events records the creation", async () => {
    const job = await createJob({ intentId: "qa-events-1" });
    const body = await (await call(`/api/v1/jobs/${job.id}/events`)).json();
    expect(body.events.map((e) => e.kind)).toContain("created");
  });

  it("POST /jobs/:id/run executes a TTS job and stores the artifact", async () => {
    const job = await createJob({ intentId: "qa-run-1" });
    const res = await call(`/api/v1/jobs/${job.id}/run`, { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.job.status).toBe("succeeded");
    expect(body.asset.url).toBe(`/api/v1/assets/${body.asset.id}`);
    expect(body.job.requestId).toBe("req_qa_breadth");
  });

  it("re-running a succeeded job is refused with 409, never re-billed", async () => {
    const job = await createJob({ intentId: "qa-run-2" });
    await call(`/api/v1/jobs/${job.id}/run`, { method: "POST" });
    const second = await call(`/api/v1/jobs/${job.id}/run`, { method: "POST" });
    const body = await second.json();

    expect(second.status).toBe(409);
    expect(body.reason).toBeTruthy();
    expect(body.asset ?? null).toBeNull();
  });

  it("POST /jobs/:id/poll reports stillRunning for an in-flight async job", async () => {
    const job = await createJob({
      intentId: "qa-poll-1",
      type: "image_generation",
      modelId: "seedream",
      input: { prompt: "一只猫" },
    });
    const run = await call(`/api/v1/jobs/${job.id}/run`, { method: "POST" });
    const runBody = await run.json();
    expect(runBody.job.status).toBe("running");
    expect(runBody.asset ?? null).toBeNull();

    const res = await call(`/api/v1/jobs/${job.id}/poll`, { method: "POST" });
    const body = await res.json();
    expect(res.status).toBe(202);
    expect(body.stillRunning).toBe(true);
  });

  it("polling a draft job answers 202 with the reason it will not poll", async () => {
    const job = await createJob({ intentId: "qa-poll-2" });
    const body = await (await call(`/api/v1/jobs/${job.id}/poll`, { method: "POST" })).json();
    expect(body.stillRunning).toBe(false);
    expect(body.reason).toContain("draft");
  });

  it("polling an unknown job answers 202 with job:null, not a 500", async () => {
    const res = await call("/api/v1/jobs/nope/poll", { method: "POST" });
    const body = await res.json();
    expect(res.status).toBe(202);
    expect(body.job).toBeNull();
    expect(body.reason).toBeTruthy();
  });
});

/* ----------------------------------------------------- asset probe HTTP -- */

describe("local media probe endpoint", () => {
  it("probes an uploaded WAV locally: duration, waveform, computedBy", async () => {
    const up = await call("/api/v1/assets", {
      method: "POST",
      raw: multipart(makeWav({ seconds: 1 })),
    });
    const { asset } = await up.json();

    const res = await call(`/api/v1/assets/${asset.id}/probe`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.supported).toBe(true);
    expect(body.format).toBe("wav");
    expect(body.durationSeconds).toBeCloseTo(1, 1);
    expect(Array.isArray(body.waveform)).toBe(true);
    expect(body.computedBy).toBe("local");
  });

  it("a non-audio asset is reported as unsupported, not decoded wrongly", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { asset } = await (
      await call("/api/v1/assets", {
        method: "POST",
        raw: multipart(png, "pic.png", "image/png"),
      })
    ).json();

    const body = await (await call(`/api/v1/assets/${asset.id}/probe`)).json();
    expect(body.supported).toBe(false);
    expect(body.reason).toContain("音频");
  });

  it("probing an unknown asset 404s", async () => {
    const res = await call("/api/v1/assets/asset_missing/probe");
    expect(res.status).toBe(404);
  });
});

/* ------------------------------------------------- projects + folders  -- */

describe("projects and folders HTTP surface", () => {
  it("folders: create then list", async () => {
    const created = await call("/api/v1/folders", {
      method: "POST",
      body: { name: "qa 文件夹" },
    });
    expect(created.status).toBe(201);
    const { folder } = await created.json();

    const list = await (await call("/api/v1/folders")).json();
    expect(list.folders.some((f) => f.id === folder.id && f.name === "qa 文件夹")).toBe(true);
  });

  it("projects: list contains a created project", async () => {
    const { project } = await (
      await call("/api/v1/projects", {
        method: "POST",
        body: { kind: "tts", name: "qa 工程" },
      })
    ).json();

    const list = await (await call("/api/v1/projects")).json();
    expect(list.projects.some((p) => p.id === project.id)).toBe(true);
    expect(project.revision).toBe(1);
  });

  it("PUT save with the current revision bumps it", async () => {
    const { project } = await (
      await call("/api/v1/projects", { method: "POST", body: { kind: "tts", name: "v1" } })
    ).json();

    const res = await call(`/api/v1/projects/${project.id}`, {
      method: "PUT",
      body: { expectedRevision: 1, name: "v2", content: { text: "更新" } },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.project.revision).toBe(2);
    expect(body.project.name).toBe("v2");
  });

  it("PUT save with a stale revision is a 409 conflict, not an overwrite", async () => {
    const { project } = await (
      await call("/api/v1/projects", { method: "POST", body: { kind: "tts", name: "conflict" } })
    ).json();

    const res = await call(`/api/v1/projects/${project.id}`, {
      method: "PUT",
      body: { expectedRevision: 99, name: "stale" },
    });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("REVISION_CONFLICT");
    expect(body.error.expectedRevision).toBe(99);
    expect(body.error.actualRevision).toBe(1);
  });

  it("DELETE an unknown project 404s with removed:false", async () => {
    const res = await call("/api/v1/projects/nope", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect((await res.json()).removed).toBe(false);
  });

  it("POST /projects/:id/variants derives a child and leaves the original alone", async () => {
    const { project } = await (
      await call("/api/v1/projects", {
        method: "POST",
        body: { kind: "tts", name: "母本", content: { variables: { text: "原" } } },
      })
    ).json();

    const res = await call(`/api/v1/projects/${project.id}/variants`, {
      method: "POST",
      body: { name: "变体", variables: { text: "新" } },
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.project.id).not.toBe(project.id);
    expect(body.project.content.derivedFrom.id).toBe(project.id);
    expect(body.project.content.derivedFrom.changed).toContain("text");
    expect(body.project.content.variables.text).toBe("新");

    const after = await (await call("/api/v1/projects")).json();
    const original = after.projects.find((p) => p.id === project.id);
    expect(original.content.variables.text).toBe("原");
  });
});

/* --------------------------------------------------------------- backup -- */

describe("backup export and validation endpoints", () => {
  it("POST /api/v1/backup writes a bundle into the data dir and returns its hash", async () => {
    const res = await call("/api/v1/backup", { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.bundle.format).toBe("open11labs-backup");

    const exportsDir = join(dataDir, "exports");
    expect(existsSync(exportsDir)).toBe(true);
    expect(readdirSync(exportsDir).length).toBeGreaterThan(0);
    // The on-disk bundle must not carry the credential either.
    expect(JSON.stringify(body.bundle)).not.toContain(SECRET);
  });

  it("POST /api/v1/backup/validate accepts the bundle it just exported", async () => {
    const { bundle } = await (
      await call("/api/v1/backup", { method: "POST" })
    ).json();

    const res = await call("/api/v1/backup/validate", { method: "POST", body: bundle });
    const checked = await res.json();
    expect(res.status).toBe(200);
    expect(checked.valid).toBe(true);
    expect(checked.counts.projects).toBeGreaterThan(0);
  });

  it("a bundle with an unsupported version is rejected with 400", async () => {
    const { bundle } = await (
      await call("/api/v1/backup", { method: "POST" })
    ).json();

    const res = await call("/api/v1/backup/validate", {
      method: "POST",
      body: { ...bundle, version: 999 },
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.valid).toBe(false);
    expect(body.error.safeMessage).toContain("version");
  });
});

/* ------------------------------------------------------- protocol edges -- */

describe("protocol-level rejections", () => {
  it("an unknown /api/v1 path answers 404 NO_SUCH_ENDPOINT", async () => {
    const res = await call("/api/v1/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NO_SUCH_ENDPOINT");
  });

  it("a malformed JSON body answers 400 BAD_JSON", async () => {
    const res = await call("/api/v1/projects", {
      method: "POST",
      raw: { contentType: "application/json", body: Buffer.from("{not json") },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_JSON");
  });

  it("a JSON body over the 1MB limit answers 413 BODY_TOO_LARGE", async () => {
    const big = { text: "x".repeat(1_200_000) };
    const res = await call("/api/v1/projects", { method: "POST", body: big });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("BODY_TOO_LARGE");
  });
});
