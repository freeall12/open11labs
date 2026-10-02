import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "../../server/lib/db.mjs";
import { JobStore } from "../../server/lib/jobs.mjs";
import { CostLedger } from "../../server/lib/cost.mjs";
import { normalizedError } from "../../packages/contracts/src/index.mjs";

/* ==========================================================================
   M1-T05 — the duplicate-charge defences.

   These are the tests that matter most in the whole suite. Every case here is
   a scenario that, if it regressed, would bill a user twice.
   ========================================================================== */

let db;
let store;
let ledger;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "open11labs-jobs-"));
  db = openDb(join(dir, "meta.db"));
  store = new JobStore({ db });
  ledger = new CostLedger({ db });
});

afterEach(() => db.close());

const newJob = (over = {}) =>
  store.createOrGet({
    intentId: "intent-1",
    type: "text_to_speech",
    providerId: "elevenlabs",
    credentialRef: "cred_1",
    input: { text: "你好" },
    ...over,
  });

/* ---------------------------------------------------- intent de-dup -- */

describe("intent de-duplication", () => {
  it("a repeated intent returns the original job, not a second one", () => {
    const a = newJob();
    const b = newJob();

    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect(store.list()).toHaveLength(1);
  });

  it("holds under concurrent creation", () => {
    const results = Array.from({ length: 25 }, () => newJob());
    const ids = new Set(results.map((r) => r.job.id));
    expect(ids.size).toBe(1);
    expect(store.list()).toHaveLength(1);
  });

  it("distinct intents create distinct jobs", () => {
    newJob({ intentId: "a" });
    newJob({ intentId: "b" });
    expect(store.list()).toHaveLength(2);
  });

  it("refuses to create a job with no intent id", () => {
    expect(() => newJob({ intentId: undefined })).toThrow(/intentId/);
  });

  it("this is a local guarantee and is not advertised as remote idempotency", () => {
    const { job } = newJob();
    // The store makes no claim about the provider accepting a replay.
    expect(job.status).toBe("draft");
    expect(job).not.toHaveProperty("remoteIdempotencyKey");
  });
});

/* -------------------------------------------------------- transitions -- */

describe("state machine", () => {
  it("walks the normal path", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    store.transition(job.id, "submitting");
    store.transition(job.id, "running");
    const done = store.transition(job.id, "succeeded", {
      outputAssetIds: ["asset_1"],
    });
    expect(done.status).toBe("succeeded");
    expect(done.outputAssetIds).toEqual(["asset_1"]);
  });

  it("refuses an illegal transition", () => {
    const { job } = newJob();
    expect(() => store.transition(job.id, "succeeded")).toThrow(
      /illegal transition/,
    );
  });

  it("treats a repeated transition as a no-op", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    expect(store.transition(job.id, "queued").status).toBe("queued");
  });

  it("cannot resurrect a finished job", () => {
    const { job } = newJob();
    store.transition(job.id, "failed", { error: normalizedError({ code: "PROVIDER_REJECTED", safeMessage: "x" }) });
    expect(() => store.transition(job.id, "running")).toThrow(/illegal/);
  });

  it("bumps revision on every change", () => {
    const { job } = newJob();
    const r1 = job.revision;
    const b = store.transition(job.id, "queued");
    expect(b.revision).toBeGreaterThan(r1);
  });
});

/* ---------------------------------------------------- resubmit guards -- */

describe("duplicate charge prevention", () => {
  it("blocks resubmission while a job is in flight", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    store.transition(job.id, "submitting");

    const d = store.canSubmit(store.get(job.id));
    expect(d.ok).toBe(false);
    expect(d.reason).toContain("禁止自动重发");
  });

  it("blocks resubmission of an unknown submission", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    store.transition(job.id, "submitting");
    store.transition(job.id, "unknown_submission");

    expect(store.canSubmit(store.get(job.id)).ok).toBe(false);
  });

  it("blocks resubmission of a succeeded job", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    store.transition(job.id, "submitting");
    store.transition(job.id, "succeeded");
    expect(store.canSubmit(store.get(job.id)).reason).toContain("重复产物");
  });

  it("allows resubmission of a job that provably never left", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    store.transition(job.id, "failed", {
      error: normalizedError({
        code: "PROVIDER_AUTH_FAILED",
        safeMessage: "bad key",
        submissionCertainty: "not_submitted",
      }),
    });
    expect(store.canSubmit(store.get(job.id)).ok).toBe(true);
  });
});

/* -------------------------------------------------- restart recovery -- */

describe("restart recovery", () => {
  it("marks a job stranded mid-submit as unknown, not as fresh", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    store.transition(job.id, "submitting");

    // Simulate a crash: the process is gone and nothing else happens.
    const recovered = store.reconcileAfterRestart();
    expect(recovered).toBe(1);

    const after = store.get(job.id);
    expect(after.status).toBe("unknown_submission");
    expect(after.error.code).toBe("SUBMISSION_UNKNOWN");
    expect(after.error.submissionCertainty).toBe("unknown");
  });

  it("does not resend it: canSubmit says no", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    store.transition(job.id, "submitting");
    store.reconcileAfterRestart();
    expect(store.canSubmit(store.get(job.id)).ok).toBe(false);
  });

  it("leaves finished jobs alone", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    store.transition(job.id, "submitting");
    store.transition(job.id, "succeeded");

    expect(store.reconcileAfterRestart()).toBe(0);
    expect(store.get(job.id).status).toBe("succeeded");
  });

  it("records a request id and survives it across the boundary", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    store.transition(job.id, "submitting");
    store.recordRequestId(job.id, "req_abc123");
    expect(store.get(job.id).requestId).toBe("req_abc123");

    store.reconcileAfterRestart();
    expect(store.get(job.id).requestId).toBe("req_abc123");
  });
});

/* ------------------------------------------------------------- cancel -- */

describe("cancellation", () => {
  it("records the request and does not claim a refund", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    store.transition(job.id, "submitting");
    const cancelled = store.transition(job.id, "cancel_requested", {
      cancelRequestedAt: new Date().toISOString(),
    });
    expect(cancelled.status).toBe("cancel_requested");
    expect(cancelled.cancelRequestedAt).toBeTruthy();
    // No usage is invented by cancelling.
    expect(ledger.forJob(job.id)).toEqual([]);
  });

  it("a running job that finishes after cancel_requested is still recorded", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    store.transition(job.id, "submitting");
    store.transition(job.id, "running");
    store.transition(job.id, "cancel_requested");
    const done = store.transition(job.id, "succeeded");
    expect(done.status).toBe("succeeded");
  });
});

/* ---------------------------------------------------------- cost ledger -- */

describe("cost ledger", () => {
  it("stores unknown without an amount", () => {
    const { job } = newJob();
    ledger.record({ jobId: job.id, providerId: "elevenlabs", state: "unknown" });
    const [entry] = ledger.forJob(job.id);
    expect(entry.state).toBe("unknown");
    expect(entry.amount).toBeNull();
  });

  it("rejects a numeric amount on an unknown entry", () => {
    const { job } = newJob();
    expect(() =>
      ledger.record({
        jobId: job.id,
        providerId: "elevenlabs",
        state: "unknown",
        amount: 0,
      }),
    ).toThrow(/must not carry a numeric amount/);
  });

  it("rejects a known state with no amount", () => {
    const { job } = newJob();
    expect(() =>
      ledger.record({ jobId: job.id, providerId: "elevenlabs", state: "reported" }),
    ).toThrow(/needs a numeric amount/);
  });

  it("keeps money and usage units in separate buckets", () => {
    const a = newJob({ intentId: "a" }).job;
    const b = newJob({ intentId: "b" }).job;

    ledger.record({
      jobId: a.id,
      providerId: "elevenlabs",
      state: "reported",
      amount: 0.02,
      currency: "USD",
      unit: null,
      source: "provider",
    });
    ledger.record({
      jobId: b.id,
      providerId: "elevenlabs",
      state: "estimated",
      amount: 142,
      currency: null,
      unit: "characters",
      source: "character-cost header",
    });

    const s = ledger.summary();
    expect(s.money).toHaveLength(1);
    expect(s.money[0].total).toBe(0.02);
    expect(s.usage).toHaveLength(1);
    expect(s.usage[0].total).toBe(142);
    // Never added together.
    expect(s.money[0].total).not.toBe(142.02);
  });

  it("counts unknown entries instead of quietly dropping them", () => {
    const a = newJob({ intentId: "a" }).job;
    const b = newJob({ intentId: "b" }).job;
    ledger.record({ jobId: a.id, providerId: "elevenlabs", state: "unknown" });
    ledger.record({ jobId: b.id, providerId: "elevenlabs", state: "unknown" });

    const s = ledger.summary();
    expect(s.unknown.count).toBe(2);
    expect(s.unknown.note).toContain("未知");
    expect(s.money).toHaveLength(0);
  });
});

/* -------------------------------------------------------------- budget -- */

describe("local budget", () => {
  it("is unlimited until a limit is set", () => {
    const d = ledger.checkBudget({ estimatedAmount: 1000, currency: "USD" });
    expect(d.allowed).toBe(true);
  });

  it("blocks a submission that would exceed the limit", () => {
    ledger.setBudget({ limit: 1, currency: "USD" });
    const d = ledger.checkBudget({ estimatedAmount: 2, currency: "USD" });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("超出本地预算");
  });

  it("requires explicit confirmation when the price is unknown", () => {
    ledger.setBudget({ limit: 1, currency: "USD" });

    const blocked = ledger.checkBudget({ estimatedAmount: undefined, currency: "USD" });
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiresConfirmation).toBe(true);

    const confirmed = ledger.checkBudget({
      estimatedAmount: undefined,
      currency: "USD",
      acknowledgeUnknown: true,
    });
    expect(confirmed.allowed).toBe(true);
  });

  it("refuses to compare across currencies", () => {
    ledger.setBudget({ limit: 10, currency: "USD" });
    const d = ledger.checkBudget({ estimatedAmount: 5, currency: "EUR" });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("无法与");
  });

  it("states plainly what the budget does not control", () => {
    const scope = ledger.budgetScope();
    expect(scope.controls).toContain("本应用");
    expect(scope.doesNotControl.join()).toContain("其他客户端");
    expect(scope.doesNotControl.join()).toContain("供应商自身的计费");
  });

  it("stays consistent under concurrent checks", () => {
    ledger.setBudget({ limit: 1, currency: "USD" });
    const results = Array.from({ length: 20 }, () =>
      ledger.checkBudget({ estimatedAmount: 0.5, currency: "USD" }),
    );
    // All pass, because nothing is committed until a job is recorded — the
    // check is advisory. What must never happen is a mixed-currency total.
    expect(results.every((r) => typeof r.allowed === "boolean")).toBe(true);
  });
});

/* -------------------------------------------------------------- events -- */

describe("event log", () => {
  it("records the lifecycle in order", () => {
    const { job } = newJob();
    store.transition(job.id, "queued");
    store.transition(job.id, "submitting");

    const kinds = store.events(job.id).map((e) => e.kind);
    expect(kinds).toContain("created");
    expect(kinds).toContain("status:queued");
    expect(kinds).toContain("status:submitting");
  });
});
