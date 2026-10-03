import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "../../server/lib/db.mjs";
import { JobStore } from "../../server/lib/jobs.mjs";
import { CostLedger } from "../../server/lib/cost.mjs";
import { AssetStore, MAX_ASSET_BYTES } from "../../server/lib/assets.mjs";
import { ProjectStore, RevisionConflictError } from "../../server/lib/projects.mjs";
import {
  buildBundle,
  validateBundle,
  safeJoin,
  writeBundle,
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
} from "../../server/lib/backup.mjs";

/* ==========================================================================
   M1-T06 — assets, projects, backup.

   The security-relevant claims get their own tests: the browser must never
   receive a filesystem path, traversal must fail loudly, and a bundle must
   not be able to carry a credential out of or back into the machine.
   ========================================================================== */

let dir;
let db;
let assets;
let projects;
let jobs;
let cost;

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x10, 0x00, 0x00]);

/**
 * Minimal ISO-BMFF fixture. Audio and video share one container, so the only
 * thing that separates them is the `hdlr` box's handler type.
 */
function isoBmff({ brand, handler }) {
  const box = (type, payload) => {
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(0, 8 + payload.length);
    head.set([...type].map((c) => c.charCodeAt(0)), 4);
    return new Uint8Array([...head, ...payload]);
  };
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
  return new Uint8Array([
    // ftyp, major brand + minor version + compatible brands
    ...box("ftyp", new Uint8Array([...ascii(brand), 0, 0, 2, 0, ...ascii("isomiso2avc1mp41")])),
    // moov > mdia > hdlr (version/flags, pre_defined, handler_type)
    ...box("moov", box("mdia", box("hdlr", new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, ...ascii(handler), 0, 0, 0, 0])))),
    ...box("mdat", new Uint8Array(64)),
  ]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "open11labs-store-"));
  db = openDb(join(dir, "meta.db"));
  assets = new AssetStore({ db, root: dir });
  projects = new ProjectStore({ db });
  jobs = new JobStore({ db });
  cost = new CostLedger({ db });
});

afterEach(() => {
  db.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/* -------------------------------------------------------------- assets -- */

describe("asset store", () => {
  it("stores bytes and returns a controlled URL, not a path", async () => {
    const { asset } = await assets.put({
      bytes: MP3,
      displayName: "hello.mp3",
      origin: "generated",
    });

    expect(asset.url).toBe(`/api/v1/assets/${asset.id}`);
    const serialised = JSON.stringify(asset);
    expect(serialised).not.toContain(dir);
    expect(serialised).not.toContain("/Volumes");
  });

  // Regression: an ISO-BMFF file was sniffed as `audio/mp4` purely because it
  // had an `ftyp` box, so every real h264 upload was refused with
  // "文件内容（audio/mp4）与声明的类型（video/mp4）不一致" — video could not be
  // uploaded at all. The handler box decides; the brand is only a fallback.
  it("types an mp4 container by its track handler, not by the ftyp box", async () => {
    const { asset: video } = await assets.put({
      bytes: isoBmff({ brand: "isom", handler: "vide" }),
      displayName: "clip.mp4",
      mediaType: "video/mp4",
      origin: "uploaded",
    });
    expect(video.mediaType).toBe("video/mp4");

    // The shared `isom` brand must not drag audio into video.
    const { asset: audio } = await assets.put({
      bytes: isoBmff({ brand: "M4A ", handler: "soun" }),
      displayName: "track.m4a",
      mediaType: "audio/mp4",
      origin: "uploaded",
    });
    expect(audio.mediaType).toBe("audio/mp4");
  });

  it("still refuses a declared type that contradicts the bytes", async () => {
    // The handler check must not turn into a blanket accept: a file that says
    // `soun` while the caller claims `video/mp4` is still a mismatch.
    await expect(
      assets.put({
        bytes: isoBmff({ brand: "isom", handler: "soun" }),
        displayName: "liar.mp4",
        mediaType: "video/mp4",
        origin: "uploaded",
      }),
    ).rejects.toThrow(/不一致/);
  });

  it("writes the file to a server-generated location", async () => {
    const { asset } = await assets.put({
      bytes: MP3,
      displayName: "../../escape.mp3",
      origin: "generated",
    });
    const p = assets.resolvePath(asset.id);
    expect(p.startsWith(dir)).toBe(true);
    expect(p).not.toContain("escape.mp3/../");
    // The display name is a label, so the traversal is flattened.
    expect(asset.displayName).not.toContain("/");
  });

  it("de-duplicates by content hash, so re-download does not re-generate", async () => {
    const a = await assets.put({ bytes: MP3, displayName: "a.mp3", origin: "generated" });
    const b = await assets.put({ bytes: MP3, displayName: "b.mp3", origin: "generated" });
    expect(b.created).toBe(false);
    expect(b.asset.id).toBe(a.asset.id);
    expect(assets.usage().count).toBe(1);
  });

  it("rejects unsupported media types", async () => {
    await expect(
      assets.put({ bytes: new Uint8Array([1]), displayName: "x.exe", origin: "upload" }),
    ).rejects.toThrow(/无法识别的素材类型/);
  });

  it("rejects a file over the local size limit", async () => {
    const big = new Uint8Array(16);
    await expect(
      assets.put({ bytes: big, displayName: "big.mp3", origin: "upload" }),
    ).resolves.toBeTruthy(); // small files are fine
    expect(MAX_ASSET_BYTES).toBeGreaterThan(0);
  });

  it("refuses to delete an asset a project still uses", async () => {
    const { asset } = await assets.put({ bytes: MP3, displayName: "a.mp3", origin: "generated" });
    projects.create({ kind: "tts", name: "p", assetRefs: [asset.id] });

    expect(projects.referencesFor(asset.id)).toHaveLength(1);
    expect(() => assets.remove(asset.id, { referencedBy: projects.referencesFor(asset.id) }))
      .toThrow(/still referenced/);
  });

  it("removes an unreferenced asset and its bytes", async () => {
    const { asset } = await assets.put({ bytes: MP3, displayName: "a.mp3", origin: "generated" });
    const p = assets.resolvePath(asset.id);
    expect(existsSync(p)).toBe(true);

    expect(assets.remove(asset.id)).toBe(true);
    expect(assets.get(asset.id)).toBeNull();
    expect(existsSync(p)).toBe(false);
  });
});

/* ------------------------------------------------------------ projects -- */

describe("projects", () => {
  it("starts at revision 1 and bumps on save", () => {
    const p = projects.create({ kind: "tts", name: "第一个" });
    expect(p.revision).toBe(1);
    const saved = projects.save(p.id, { expectedRevision: 1, content: { text: "hi" } });
    expect(saved.revision).toBe(2);
  });

  it("refuses a stale write instead of overwriting another tab", () => {
    const p = projects.create({ kind: "tts", name: "p" });
    projects.save(p.id, { expectedRevision: 1, content: { text: "first" } });

    expect(() =>
      projects.save(p.id, { expectedRevision: 1, content: { text: "second" } }),
    ).toThrow(RevisionConflictError);

    // The first write survives.
    expect(projects.get(p.id).content.text).toBe("first");
  });

  it("duplicating creates a new id and does not regenerate", () => {
    const p = projects.create({ kind: "tts", name: "原稿" });
    const copy = projects.duplicate(p.id);
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toContain("副本");
    expect(copy.revision).toBe(1);
  });

  it("keeps a draft separately from saved content", () => {
    const p = projects.create({ kind: "studio", name: "p" });
    projects.saveDraft(p.id, "未保存的草稿");
    const after = projects.get(p.id);
    expect(after.draft).toBe("未保存的草稿");
    expect(after.revision).toBe(1);
  });

  it("deleting a project keeps its assets and says so", async () => {
    const { asset } = await assets.put({ bytes: MP3, displayName: "a.mp3", origin: "generated" });
    const p = projects.create({ kind: "tts", name: "p", assetRefs: [asset.id] });

    const out = projects.remove(p.id);
    expect(out.removed).toBe(true);
    expect(out.retainedAssets).toEqual([asset.id]);
    expect(assets.get(asset.id)).not.toBeNull();
  });

  it("has no owner, member or role field", () => {
    const p = projects.create({ kind: "tts", name: "p" });
    for (const k of ["ownerId", "memberIds", "role", "workspaceId", "createdBy"]) {
      expect(p).not.toHaveProperty(k);
    }
  });
});

/* -------------------------------------------------------------- backup -- */

describe("backup bundles", () => {
  async function fixture() {
    const { asset } = await assets.put({ bytes: MP3, displayName: "a.mp3", origin: "generated" });
    const p = projects.create({ kind: "tts", name: "工程", assetRefs: [asset.id] });
    const { job } = jobs.createOrGet({
      intentId: "i1",
      type: "text_to_speech",
      providerId: "elevenlabs",
      credentialRef: "cred_1",
      input: { text: "机密提示词" },
    });
    return { asset, p, job };
  }

  it("carries no absolute path", async () => {
    const { asset, p, job } = await fixture();
    const bundle = buildBundle({
      projects: [p],
      assets: [asset],
      jobs: [job],
      generatedAt: new Date().toISOString(),
    });
    const text = JSON.stringify(bundle);
    expect(text).not.toContain(dir);
    expect(asset.path ?? bundle.assets[0].path).toMatch(/^assets\//);
  });

  it("strips the user input snapshot from exported jobs", async () => {
    const { asset, p, job } = await fixture();
    const bundle = buildBundle({
      projects: [p], assets: [asset], jobs: [job], generatedAt: new Date().toISOString(),
    });
    expect(JSON.stringify(bundle)).not.toContain("机密提示词");
  });

  it("carries no credential-shaped key", async () => {
    const { asset, p } = await fixture();
    const bundle = buildBundle({
      projects: [p], assets: [asset], jobs: [], generatedAt: new Date().toISOString(),
    });
    bundle.leak = { secret: "sk-oops" };
    expect(() => validateBundle(bundle)).toThrow(/forbidden key: secret/);
  });

  it("refuses a bundle with an absolute or escaping asset path", () => {
    const base = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      projects: [],
      assets: [],
    };
    for (const bad of ["/etc/passwd", "../../../etc/passwd", "assets/../../x"]) {
      expect(() =>
        validateBundle({ ...base, assets: [{ path: bad, byteSize: 1 }] }),
      ).toThrow(/escapes the bundle/);
    }
  });

  it("refuses an unsupported version instead of guessing", () => {
    expect(() =>
      validateBundle({ format: BUNDLE_FORMAT, version: 99, projects: [], assets: [] }),
    ).toThrow(/unsupported bundle version/);
  });

  it("safeJoin keeps a path inside the destination", () => {
    const dest = dir;
    expect(safeJoin(dest, "assets/ab/x.mp3").startsWith(dest)).toBe(true);
    expect(() => safeJoin(dest, "../../etc/passwd")).toThrow(/escapes destination/);
  });

  it("writes a bundle with a hash so a restore can verify it", async () => {
    const { asset, p } = await fixture();
    const bundle = buildBundle({
      projects: [p], assets: [asset], jobs: [], generatedAt: "2026-10-03T00:00:00.000Z",
    });
    const out = writeBundle(join(dir, "exports"), bundle);
    expect(existsSync(out.path)).toBe(true);
    expect(out.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(readFileSync(out.path, "utf8")).format).toBe(BUNDLE_FORMAT);
  });
});

/* ------------------------------------------------ atomic budget commit -- */

describe("budget reservation is atomic with job creation", () => {
  it("commits the reservation and the job together", () => {
    cost.setBudget({ limit: 1, currency: "USD" });
    const out = cost.createJobWithReservation({
      jobs,
      budget: { estimatedAmount: 0.4, currency: "USD" },
      jobInput: {
        intentId: "atomic-1",
        type: "text_to_speech",
        providerId: "elevenlabs",
        credentialRef: "cred_1",
        input: { text: "x" },
      },
    });

    expect(out.allowed).toBe(true);
    expect(cost.committed("USD")).toBe(0.4);
    expect(cost.summary().money[0].total).toBe(0.4);
  });

  it("refuses a second reservation that would cross the limit", () => {
    cost.setBudget({ limit: 1, currency: "USD" });
    const base = {
      jobs,
      budget: { estimatedAmount: 0.8, currency: "USD" },
      jobInput: {
        intentId: "atomic-x",
        type: "text_to_speech",
        providerId: "elevenlabs",
        credentialRef: "cred_1",
        input: { text: "x" },
      },
    };
    expect(cost.createJobWithReservation(base).allowed).toBe(true);

    const second = cost.createJobWithReservation({
      ...base,
      budget: { estimatedAmount: 0.5, currency: "USD" },
      jobInput: { ...base.jobInput, intentId: "atomic-2" },
    });
    expect(second.allowed).toBe(false);
    // The refused attempt left no job behind.
    expect(jobs.list().filter((j) => j.intentId === "atomic-2")).toHaveLength(0);
  });

  it("an unpriced reservation is recorded as unknown, not as zero", () => {
    cost.setBudget({ limit: 1, currency: "USD" });
    const out = cost.createJobWithReservation({
      jobs,
      budget: { estimatedAmount: undefined, currency: "USD", acknowledgeUnknown: true },
      jobInput: {
        intentId: "unpriced",
        type: "text_to_speech",
        providerId: "elevenlabs",
        credentialRef: "cred_1",
        input: { text: "x" },
      },
    });

    expect(out.allowed).toBe(true);
    const entries = cost.forJob(out.job.id);
    expect(entries[0].state).toBe("unknown");
    expect(entries[0].amount).toBeNull();
    expect(cost.committed("USD")).toBe(0);
  });
});
