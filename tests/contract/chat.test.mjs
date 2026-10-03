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
   Chat jobs.

   A chat turn is billed work like any other, so it goes through the same job
   lifecycle. What is specific to it:
     - the whole message array must reach the provider, and nothing else
       (no file, no credential, no publish path)
     - the model id must be the one the user picked, not a placeholder
     - an empty reply is a failure, not a successful blank turn
   ========================================================================== */

let dir;
let db;
let jobs;
let cost;
let assets;
let vault;
let calls;
let credId;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "open11labs-chat-"));
  db = openDb(join(dir, "meta.db"));
  jobs = new JobStore({ db });
  cost = new CostLedger({ db });
  assets = new AssetStore({ db, root: dir });
  vault = new Vault();
  vault.put({
    type: "openai-local",
    baseURL: "http://127.0.0.1:11434",
    secret: "no-auth-required",
    selfHosted: true,
  });
  credId = vault.list()[0].id;
  calls = [];
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* best effort */
  }
});

// Mirrors the server: the adapter is resolved from the credential, not from a
// frozen type map, so a key added while the process runs is usable at once.
function makeRunner(impl) {
  const r = new JobRunner({ jobs, assets, cost, vault, adapters: {} });
  r.setAdapterResolver((credentialRef) =>
    credentialRef === credId
      ? {
          async submit(input) {
            calls.push(input);
            return impl(input);
          },
        }
      : null,
  );
  return r;
}

const REPLY = new TextEncoder().encode("这是一段回复。");

function seedTurn(index = 0, messages = [{ role: "user", content: "写一句开场白" }]) {
  return jobs.createOrGet({
    intentId: `chat:${credId}:qwen2.5:${index}`,
    type: "chat",
    providerId: credId,
    modelId: "qwen2.5",
    credentialRef: credId,
    input: { messages, temperature: 0.7 },
  });
}

describe("chat job", () => {
  it("passes the messages, model and temperature, and nothing more", async () => {
    const messages = [
      { role: "user", content: "第一句" },
      { role: "assistant", content: "回答" },
      { role: "user", content: "第二句" },
    ];
    const { job } = seedTurn(0, messages);
    const runner = makeRunner(async () => ({
      artifact: { bytes: REPLY, contentType: "text/plain; charset=utf-8" },
    }));

    const out = await runner.run(job.id);

    expect(out.job.status).toBe("succeeded");
    expect(calls).toHaveLength(1);
    expect(calls[0].messages).toEqual(messages);
    expect(calls[0].model).toBe("qwen2.5");
    expect(calls[0].temperature).toBe(0.7);
    // The agent boundary: no file handles, no credentials, no shell.
    expect(Object.keys(calls[0]).sort()).toEqual(["key", "maxTokens", "messages", "model", "temperature"]);
  });

  it("stores the reply as a text asset with a .txt name", async () => {
    const { job } = seedTurn();
    const runner = makeRunner(async () => ({
      artifact: { bytes: REPLY, contentType: "text/plain; charset=utf-8" },
    }));

    const out = await runner.run(job.id);
    const assetId = out.job.outputAssetIds[0];
    const asset = assets.get(assetId);

    expect(asset.displayName).toMatch(/\.txt$/);
    expect(new TextDecoder().decode(assets.read(assetId))).toBe("这是一段回复。");
  });

  it("fails an empty reply instead of storing a blank turn", async () => {
    const { job } = seedTurn();
    const runner = makeRunner(async () => ({
      artifact: { bytes: new Uint8Array(), contentType: "text/plain" },
    }));

    const out = await runner.run(job.id);

    expect(out.job.status).toBe("failed");
    expect(out.job.outputAssetIds).toEqual([]);
  });

  it("deduplicates a repeated turn so a double click is not billed twice", async () => {
    const first = seedTurn(0);
    const second = seedTurn(0);

    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);

    const runner = makeRunner(async () => ({
      artifact: { bytes: REPLY, contentType: "text/plain" },
    }));
    await runner.run(first.job.id);
    expect(calls).toHaveLength(1);
  });

  it("records the local call as zero cost, with a stated source", async () => {
    const { job } = seedTurn();
    const runner = makeRunner(async () => ({
      artifact: { bytes: REPLY, contentType: "text/plain" },
    }));
    await runner.run(job.id);

    const entries = cost.forJob(job.id);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      // A local model is free to call and still must say why it costs zero,
      // rather than presenting a bare 0 as if it were a price.
      expect(e.source).toBeTruthy();
    }
  });
});
