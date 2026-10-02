import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "../../server/lib/db.mjs";
import { JobStore } from "../../server/lib/jobs.mjs";
import { CostLedger } from "../../server/lib/cost.mjs";
import { normalizedError } from "../../packages/contracts/src/index.mjs";

/* ==========================================================================
   M1-T05 restart durability.

   The unit tests exercise the state machine. This file checks the thing that
   actually matters after a crash: that the database is a real file, that state
   survives closing it, and that a job caught mid-submit comes back marked
   unknown instead of looking like fresh work.
   ========================================================================== */

let dir;
let dbPath;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "open11labs-restart-"));
  dbPath = join(dir, "meta.db");
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/** Open, use, and close — i.e. one "process lifetime". */
function withStore(fn) {
  const db = openDb(dbPath);
  try {
    return fn(new JobStore({ db }), new CostLedger({ db }));
  } finally {
    db.close();
  }
}

function submit({ intentId, text = "你好" }) {
  return withStore((store) => {
    const { job } = store.createOrGet({
      intentId,
      type: "text_to_speech",
      providerId: "elevenlabs",
      credentialRef: "cred_1",
      input: { text },
    });
    store.transition(job.id, "queued");
    store.transition(job.id, "submitting");
    return job.id;
  });
}

describe("durability across a restart", () => {
  it("a job reaches the disk before the request would leave", () => {
    const id = submit({ intentId: "intent-persist" });

    const job = withStore((store) => store.get(id));
    expect(job).not.toBeNull();
    expect(job.status).toBe("submitting");
    expect(job.input.text).toBe("你好");
  });

  it("a stranded submission comes back as unknown, not as re-sendable work", () => {
    const id = submit({ intentId: "intent-stranded" });

    // Second launch: this is what the server does on boot.
    withStore((store) => store.reconcileAfterRestart());

    const job = withStore((store) => store.get(id));
    expect(job.status).toBe("unknown_submission");
    expect(job.error.code).toBe("SUBMISSION_UNKNOWN");
    expect(job.error.submissionCertainty).toBe("unknown");

    // The decisive assertion: it must not be re-submitted.
    expect(withStore((store) => store.canSubmit(store.get(id))).ok).toBe(false);
  });

  it("intent de-duplication still holds after a restart", () => {
    const id = submit({ intentId: "intent-dedupe" });
    withStore((store) => store.reconcileAfterRestart());

    // The same client intent after a restart must resolve to the same job.
    const again = withStore((store) =>
      store.createOrGet({
        intentId: "intent-dedupe",
        type: "text_to_speech",
        providerId: "elevenlabs",
        credentialRef: "cred_1",
        input: { text: "你好" },
      }),
    );
    expect(again.created).toBe(false);
    expect(again.job.id).toBe(id);
  });

  it("the event log survives, so the history is auditable", () => {
    const id = submit({ intentId: "intent-events" });
    const kinds = withStore((store) => store.events(id).map((e) => e.kind));
    expect(kinds).toContain("created");
    expect(kinds).toContain("status:submitting");
  });

  it("a recorded request id is what a query would use, and it survives", () => {
    const id = withStore((store) => {
      const { job } = store.createOrGet({
        intentId: "intent-reqid",
        type: "text_to_speech",
        providerId: "elevenlabs",
        credentialRef: "cred_1",
        input: { text: "x" },
      });
      store.transition(job.id, "queued");
      store.transition(job.id, "submitting");
      store.recordRequestId(job.id, "req_persisted_1");
      return job.id;
    });

    withStore((store) => store.reconcileAfterRestart());
    const job = withStore((store) => store.get(id));

    expect(job.requestId).toBe("req_persisted_1");
    expect(job.status).toBe("unknown_submission");
    expect(job.error.providerRequestId).toBe("req_persisted_1");
  });
});

describe("cost survives a restart", () => {
  it("an unknown cost stays unknown, never becomes zero", () => {
    const id = submit({ intentId: "intent-cost" });

    // Recorded through a separate ledger bound to the same file, so the
    // assertion is about durability rather than in-memory state.
    const db = openDb(dbPath);
    new CostLedger({ db }).record({
      jobId: id,
      providerId: "elevenlabs",
      state: "unknown",
    });
    db.close();

    const db2 = openDb(dbPath);
    const entries = new CostLedger({ db: db2 }).forJob(id);
    db2.close();

    expect(entries).toHaveLength(1);
    expect(entries[0].state).toBe("unknown");
    expect(entries[0].amount).toBeNull();
  });

  it("a budget set before a restart still applies after it", () => {
    const db = openDb(dbPath);
    new CostLedger({ db }).setBudget({ limit: 5, currency: "USD" });
    db.close();

    const db2 = openDb(dbPath);
    const ledger = new CostLedger({ db: db2 });
    const decision = ledger.checkBudget({ estimatedAmount: 99, currency: "USD" });
    db2.close();

    expect(decision.allowed).toBe(false);
  });
});

describe("a stranded job can be resolved, not silently retried", () => {
  it("an operator can mark it failed once they have checked upstream", () => {
    const id = submit({ intentId: "intent-resolve" });
    withStore((store) => store.reconcileAfterRestart());

    const after = withStore((store) => {
      const job = store.get(id);
      return store.transition(job.id, "failed", {
        error: normalizedError({
          code: "PROVIDER_REJECTED",
          safeMessage: "查询后确认供应商未接受该请求",
          retryable: false,
          submissionCertainty: "not_submitted",
        }),
      });
    });

    expect(after.status).toBe("failed");
    // Only now, having proven it was never accepted, may it be sent again.
    expect(withStore((store) => store.canSubmit(store.get(id))).ok).toBe(true);
  });
});
