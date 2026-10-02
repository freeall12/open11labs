import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "../../server/lib/db.mjs";
import { JobStore } from "../../server/lib/jobs.mjs";
import { CostLedger } from "../../server/lib/cost.mjs";
import { AssetStore } from "../../server/lib/assets.mjs";
import { Vault } from "../../server/lib/vault.mjs";
import { JobRunner } from "../../server/lib/runner.mjs";

/* ==========================================================================
   Asynchronous jobs (image / video).

   The remote answers `{id, status:"pending"}` and the result is polled. The
   failure modes that cost money or produce a wrong result are:
     - a restart re-generating instead of resuming the poll
     - an unrecognised status being read as "done"
     - a download failure being reported as "the generation failed"
     - a completed job with no artifact address being marked succeeded
   Each of those gets its own test.
   ========================================================================== */

let dir;
let db;
let jobs;
let cost;
let assets;
let vault;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let calls;

function makeVault() {
  const v = new Vault();
  v.put({
    type: "elevenlabs",
    baseURL: "https://api.elevenlabs.io",
    secret: "sk-async-fixture-0001",
  });
  return v;
}

function runner(impl) {
  calls = [];
  return new JobRunner({
    jobs,
    assets,
    cost,
    vault,
    adapters: {
      elevenlabs: {
        async submitAsync(input) {
          calls.push(["submit", input]);
          return impl.submit(input);
        },
        async pollStatus(input) {
          calls.push(["poll", input]);
          return impl.poll(input);
        },
        async fetchArtifact(input) {
          calls.push(["fetch", input]);
          return impl.fetch ? impl.fetch(input) : { bytes: PNG, contentType: "image/png" };
        },
      },
    },
  });
}

function newImageJob(intentId = "img-1") {
  return jobs.createOrGet({
    intentId,
    type: "image_generation",
    providerId: "elevenlabs",
    modelId: "seedream",
    credentialRef: vault.list()[0].id,
    input: { prompt: "一只猫" },
  }).job;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "open11labs-async-"));
  db = openDb(join(dir, "meta.db"));
  jobs = new JobStore({ db });
  cost = new CostLedger({ db });
  assets = new AssetStore({ db, root: dir });
  vault = makeVault();
});

afterEach(() => db.close());

/* -------------------------------------------------------------- submit -- */

describe("async submit", () => {
  it("stores the remote id and stays running", async () => {
    const job = newImageJob();
    const out = await runner({
      submit: async () => ({ remoteId: "rem_123", state: "running", requestId: "req_a" }),
    }).run(job.id);

    expect(out.ok).toBe(true);
    expect(out.pendingRemote).toBe("rem_123");
    expect(out.job.status).toBe("running");
    // The id that a restart would resume from.
    expect(jobs.get(job.id).requestId).toBe("rem_123");
  });

  it("does not mark an async job succeeded before the poll", async () => {
    const job = newImageJob();
    const out = await runner({
      submit: async () => ({ remoteId: "rem_1", state: "running" }),
    }).run(job.id);

    expect(out.job.status).not.toBe("succeeded");
    expect(jobs.canSubmit(out.job).ok).toBe(false);
  });
});

/* --------------------------------------------------------------- poll -- */

describe("polling", () => {
  async function submitted() {
    const job = newImageJob();
    const r = runner({
      submit: async () => ({ remoteId: "rem_1", state: "running" }),
      poll: async () => ({ state: "running" }),
    });
    await r.run(job.id);
    return job.id;
  }

  it("keeps polling while the remote is still working", async () => {
    const id = await submitted();
    const out = await runner({ poll: async () => ({ state: "running" }) }).poll(id);

    expect(out.stillRunning).toBe(true);
    expect(jobs.get(id).status).toBe("running");
  });

  it("treats an unrecognised remote status as still running, not done", async () => {
    const id = await submitted();
    const out = await runner({
      poll: async () => ({ state: "unknown" }),
    }).poll(id);

    expect(out.ok).toBe(false);
    // The dangerous outcome would be status === "succeeded".
    expect(jobs.get(id).status).toBe("running");
  });

  it("refuses to poll without a remote id", async () => {
    const job = newImageJob();
    jobs.transition(job.id, "queued");
    jobs.transition(job.id, "submitting");
    jobs.transition(job.id, "running");
    // no requestId persisted

    const out = await runner({ poll: async () => ({ state: "completed" }) }).poll(job.id);
    expect(out.reason).toContain("远端任务 id");
  });

  it("refuses to poll a job that is not running", async () => {
    const job = newImageJob();
    const out = await runner({ poll: async () => ({ state: "completed" }) }).poll(job.id);
    expect(out.ok).toBe(false);
  });

  it("a poll failure does not change the job", async () => {
    const id = await submitted();
    const out = await runner({
      poll: async () => {
        const e = new Error("boom");
        e.safeMessage = "查询失败";
        throw e;
      },
    }).poll(id);

    expect(out.pollError).toBe(true);
    expect(jobs.get(id).status).toBe("running");
  });
});

/* --------------------------------------------------------- completion -- */

describe("completion", () => {
  async function submitted() {
    const job = newImageJob();
    await runner({
      submit: async () => ({ remoteId: "rem_ok", state: "running" }),
    }).run(job.id);
    return job.id;
  }

  it("imports the artifact and succeeds", async () => {
    const id = await submitted();
    const out = await runner({
      poll: async () => ({
        state: "completed",
        artifactUrl: "https://provider.invalid/out.png",
      }),
    }).poll(id);

    expect(out.ok).toBe(true);
    expect(jobs.get(id).status).toBe("succeeded");
    expect(assets.get(out.asset.id).mediaType).toBe("image/png");
  });

  it("does not mark succeeded when the remote has no artifact address", async () => {
    const id = await submitted();
    const out = await runner({
      poll: async () => ({ state: "completed", artifactUrl: null }),
    }).poll(id);

    expect(out.ok).toBe(false);
    expect(jobs.get(id).status).toBe("unknown_submission");
  });

  it("keeps 'remote succeeded, local import failed' as two separate facts", async () => {
    const id = await submitted();
    const out = await runner({
      poll: async () => ({
        state: "completed",
        artifactUrl: "https://provider.invalid/out.png",
      }),
      fetch: async () => {
        throw new Error("download failed");
      },
    }).poll(id);

    expect(out.ok).toBe(false);
    expect(out.remoteSucceeded).toBe(true);
    const job = jobs.get(id);
    expect(job.error.code).toBe("ASSET_IMPORT_FAILED");
    expect(job.error.submissionCertainty).toBe("accepted");
    // The message must point at re-downloading, not regenerating.
    expect(job.error.safeMessage).toContain("无需重新生成");
  });

  it("records a remote failure without claiming it was free", async () => {
    const id = await submitted();
    await runner({
      poll: async () => ({ state: "failed", errorMessage: "内容策略拒绝" }),
    }).poll(id);

    const job = jobs.get(id);
    expect(job.status).toBe("failed");
    const entries = cost.forJob(id);
    expect(entries[0].state).toBe("unknown");
    expect(entries[0].amount).toBeNull();
  });
});

/* ------------------------------------------------------------ restart -- */

describe("restart resumes the poll", () => {
  it("a running async job is reconciled to unknown, not regenerated", async () => {
    const job = newImageJob();
    jobs.recordRequestId(job.id, "rem_survives");
    jobs.transition(job.id, "queued");
    jobs.transition(job.id, "submitting");
    jobs.transition(job.id, "running");

    jobs.reconcileAfterRestart();

    const after = jobs.get(job.id);
    expect(after.status).toBe("unknown_submission");
    // The remote id survives, so the generation can be resolved upstream.
    expect(after.requestId).toBe("rem_survives");
    expect(after.error.providerRequestId).toBe("rem_survives");
    // It is not resubmitted.
    expect(jobs.canSubmit(after).ok).toBe(false);
  });
});
