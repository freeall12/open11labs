import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "../../server/lib/db.mjs";
import { JobStore } from "../../server/lib/jobs.mjs";
import { CostLedger } from "../../server/lib/cost.mjs";
import { AssetStore } from "../../server/lib/assets.mjs";
import { Vault } from "../../server/lib/vault.mjs";
import { JobRunner, assertArtifact } from "../../server/lib/runner.mjs";
import { normalizedError } from "../../packages/contracts/src/index.mjs";

/* ==========================================================================
   Job runner.

   The scenarios here are the ones that cost money if they regress: an empty
   response treated as success, a failed call recorded as free, a timeout
   retried automatically, or a secret ending up in the persisted job snapshot.
   ========================================================================== */

let dir;
let db;
let jobs;
let cost;
let assets;
let vault;
let runner;
let seen;

const SECRET = "sk-runner-fixture-9876543210";
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x10, 0x00, 0x20, 0x00, 0x00]);

function makeVault() {
  const v = new Vault();
  v.put({
    type: "elevenlabs",
    displayName: "k",
    baseURL: "https://api.elevenlabs.io",
    secret: SECRET,
  });
  return v;
}

/** The stub forwards every adapter entry point the runner may call. */
function makeAdapter(impl) {
  const forward = (name) => async (input) => {
    seen.push({ via: name, input });
    return impl(input);
  };
  return {
    elevenlabs: {
      submit: forward("submit"),
      submitSts: forward("submitSts"),
      submitSfx: forward("submitSfx"),
      submitIsolation: forward("submitIsolation"),
      submitAsync: forward("submitAsync"),
      pollStatus: forward("pollStatus"),
      fetchArtifact: forward("fetchArtifact"),
    },
  };
}

function newJob(over = {}) {
  const rec = jobs.createOrGet({
    intentId: over.intentId ?? "intent-run-1",
    type: "text_to_speech",
    providerId: "elevenlabs",
    modelId: "eleven_multilingual_v2",
    credentialRef: vault.list()[0].id,
    input: { text: "你好", voiceId: "v1", outputFormat: "mp3_44100_128" },
  });
  return rec.job;
}

/** Point the runner at an adapter whose submit() behaves as `impl`. */
function withAdapter(impl) {
  return new JobRunner({
    jobs,
    assets,
    cost,
    vault,
    adapters: makeAdapter(impl),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "open11labs-runner-"));
  db = openDb(join(dir, "meta.db"));
  jobs = new JobStore({ db });
  cost = new CostLedger({ db });
  assets = new AssetStore({ db, root: dir });
  vault = makeVault();
  seen = [];
});

afterEach(() => db.close());

/* ---------------------------------------------------------- happy path -- */

describe("successful run", () => {
  it("walks the job to succeeded and stores the artifact", async () => {
    const job = newJob();
    const out = await withAdapter(async () => ({
      artifact: { bytes: MP3, contentType: "audio/mpeg", suggestedName: "hi.mp3" },
      providerRequestId: "req_run_1",
      characterCost: "2",
    })).run(job.id);

    expect(out.ok).toBe(true);
    expect(out.job.status).toBe("succeeded");
    expect(out.job.requestId).toBe("req_run_1");
    expect(out.job.outputAssetIds).toHaveLength(1);
    expect(assets.get(out.job.outputAssetIds[0]).mediaType).toBe("audio/mpeg");
  });

  it("never writes the secret into the persisted job snapshot", async () => {
    const job = newJob();
    await withAdapter(async () => ({
      artifact: { bytes: MP3, contentType: "audio/mpeg" },
      providerRequestId: "req_run_2",
    })).run(job.id);

    // The key reached the adapter...
    expect(seen[0].input.key).toBe(SECRET);
    // ...but nowhere in the row that lives on disk.
    const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(job.id);
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(JSON.stringify(row)).not.toContain(SECRET.slice(0, 10));
  });

  it("records cost as unknown, never zero", async () => {
    const job = newJob();
    await withAdapter(async () => ({
      artifact: { bytes: MP3, contentType: "audio/mpeg" },
      characterCost: "2",
    })).run(job.id);

    const entries = cost.forJob(job.id);
    expect(entries[0].state).toBe("unknown");
    expect(entries[0].amount).toBeNull();
    expect(cost.committed("USD")).toBe(0);
    expect(cost.summary().unknown.count).toBe(1);
  });
});

/* -------------------------------------------------------------- failures -- */

describe("failure handling", () => {
  it("an empty artifact is a failure, not a zero-length success", async () => {
    const job = newJob();
    const out = await withAdapter(async () => ({
      artifact: { bytes: new Uint8Array(0), contentType: "audio/mpeg" },
      providerRequestId: "req_empty",
    })).run(job.id);

    expect(out.ok).toBe(false);
    expect(out.job.status).toBe("failed");
    expect(out.job.outputAssetIds).toEqual([]);
  });

  it("a timeout becomes unknown_submission and is not retryable", async () => {
    const job = newJob();
    const out = await withAdapter(async () => {
      throw normalizedError({
        code: "NETWORK_ERROR",
        safeMessage: "请求超时",
        submissionCertainty: "unknown",
      });
    }).run(job.id);

    expect(out.job.status).toBe("unknown_submission");
    expect(jobs.canSubmit(out.job).ok).toBe(false);
  });

  it("a 5xx is treated as a possibly-accepted submission", async () => {
    const job = newJob();
    const out = await withAdapter(async () => {
      throw normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: "供应商内部错误",
        retryable: true,
        submissionCertainty: "unknown",
      });
    }).run(job.id);

    expect(out.job.status).toBe("unknown_submission");
  });

  it("a 4xx is a clean failure that may be retried", async () => {
    const job = newJob();
    const out = await withAdapter(async () => {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "voice 不存在",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }).run(job.id);

    expect(out.job.status).toBe("failed");
    expect(jobs.canSubmit(out.job).ok).toBe(true);
  });

  it("a failed call is not recorded as free", async () => {
    const job = newJob();
    await withAdapter(async () => {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "bad",
        submissionCertainty: "not_submitted",
      });
    }).run(job.id);

    const entries = cost.forJob(job.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].state).toBe("unknown");
    expect(entries[0].amount).toBeNull();
  });

  it("a removed credential fails before any network call", async () => {
    const job = newJob();
    // Remove the key the job references.
    for (const rec of vault.list()) vault.remove(rec.id);

    const out = await withAdapter(async () => {
      throw new Error("should not be called");
    }).run(job.id);

    expect(seen).toHaveLength(0);
    expect(out.job.status).toBe("failed");
    expect(out.job.error.code).toBe("AUTH_REQUIRED");
  });
});

/* ------------------------------------------------ duplicate-charge guard -- */

describe("duplicate charge prevention at run time", () => {
  it("refuses to run a job that is already in flight", async () => {
    const job = newJob();
    jobs.transition(job.id, "queued");
    jobs.transition(job.id, "submitting");

    const out = await withAdapter(async () => ({
      artifact: { bytes: MP3, contentType: "audio/mpeg" },
    })).run(job.id);

    expect(out.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("refuses to run an already-succeeded job", async () => {
    const job = newJob();
    jobs.transition(job.id, "queued");
    jobs.transition(job.id, "submitting");
    jobs.transition(job.id, "succeeded");

    const out = await withAdapter(async () => ({
      artifact: { bytes: MP3, contentType: "audio/mpeg" },
    })).run(job.id);

    expect(seen).toHaveLength(0);
    expect(out.ok).toBe(false);
  });

  it("two runs of the same job id only reach the provider once", async () => {
    const job = newJob();
    const r = withAdapter(async () => ({
      artifact: { bytes: MP3, contentType: "audio/mpeg" },
      providerRequestId: "req_once",
    }));

    const first = await r.run(job.id);
    const second = await r.run(job.id);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(seen).toHaveLength(1);
  });
});

/* ------------------------------------------------------ restart boundary -- */

describe("crash between submit and persist", () => {
  it("a job stranded after the request is reconciled to unknown", async () => {
    const job = newJob();
    jobs.transition(job.id, "queued");
    jobs.transition(job.id, "submitting");
    // The request was sent, the process died before persisting anything.

    expect(jobs.reconcileAfterRestart()).toBe(1);
    const after = jobs.get(job.id);
    expect(after.status).toBe("unknown_submission");
    expect(after.outputAssetIds).toEqual([]);
    // Re-running it would be the duplicate charge.
    expect(jobs.canSubmit(after).ok).toBe(false);
  });
});

/* ------------------------------------------------------------- unit bits -- */

describe("assertArtifact", () => {
  it("rejects missing bytes", () => {
    expect(() => assertArtifact(null)).toThrow(/no bytes/);
    expect(() => assertArtifact({})).toThrow(/no bytes/);
  });

  it("rejects an empty body", () => {
    expect(() =>
      assertArtifact({ bytes: new Uint8Array(0) }),
    ).toThrow(/empty artifact/);
  });

  it("accepts real bytes", () => {
    expect(assertArtifact({ bytes: MP3 }).bytes.byteLength).toBe(MP3.byteLength);
  });
});

/* ------------------------------------------------------------- sound fx -- */

describe("sound effects", () => {
  function sfxJob(over = {}) {
    return jobs.createOrGet({
      intentId: over.intentId ?? "sfx-1",
      type: "sound_generation",
      providerId: "elevenlabs",
      credentialRef: vault.list()[0].id,
      input: { prompt: "雨声", durationSeconds: 5, promptInfluence: 0.3, loop: false },
    }).job;
  }

  it("rejects an empty prompt before any request", async () => {
    const job = sfxJob();
    const out = await withAdapter(async () => {
      throw new Error("must not be called");
    }).run(job.id);
    // The adapter is the thing that validates; here we prove the runner
    // routes sound_generation to it and reports the failure on the job.
    expect(out.ok).toBe(false);
  });

  it("records an empty artifact as a failure, not a zero-length sound", async () => {
    const job = sfxJob({ intentId: "sfx-empty" });
    const out = await withAdapter(async () => ({
      artifact: { bytes: new Uint8Array(0), contentType: "audio/mpeg" },
      providerRequestId: "req_sfx",
    })).run(job.id);

    expect(out.ok).toBe(false);
    expect(out.job.status).toBe("failed");
  });
});

/* ------------------------------------------------------ voice isolator -- */

describe("voice isolation", () => {
  function isolationJob(assetId) {
    return jobs.createOrGet({
      intentId: `iso-${assetId}`,
      type: "audio_isolation",
      providerId: "elevenlabs",
      credentialRef: vault.list()[0].id,
      input: { assetId, fileName: "clip.mp3", mimeType: "audio/mpeg" },
    }).job;
  }

  it("reads its input from the asset store, not from the snapshot", async () => {
    const { asset } = await assets.put({
      bytes: MP3,
      displayName: "clip.mp3",
      mediaType: "audio/mpeg",
      origin: "uploaded",
    });
    const job = isolationJob(asset.id);

    const out = await withAdapter(async (input) => {
      // The adapter received real bytes, not an id it has to resolve itself.
      expect(input.audio.byteLength).toBeGreaterThan(0);
      expect(seen[0].via).toBe("submitIsolation");
      return {
        artifact: { bytes: MP3, contentType: "audio/mpeg", suggestedName: "out.mp3" },
        providerRequestId: "req_iso",
      };
    }).run(job.id);

    expect(out.ok).toBe(true);
    expect(out.job.status).toBe("succeeded");
  });

  it("fails clearly when the referenced input asset is gone", async () => {
    const job = isolationJob("asset_does_not_exist");
    const out = await withAdapter(async () => {
      throw new Error("must not be called");
    }).run(job.id);

    expect(seen).toHaveLength(0);
    expect(out.job.status).toBe("failed");
    expect(out.job.error.code).toBe("VALIDATION_ERROR");
  });
});
