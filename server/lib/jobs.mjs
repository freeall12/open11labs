/* ==========================================================================
   Job store.

   The rules this exists to enforce, from specs/BYOK.md and
   docs/architecture/contracts.md:

     1. One client intent creates one local job, ever. A repeat returns the
        original job. This is a *local* guarantee only — it is never reported
        to the user as remote idempotency, because the provider does not offer
        it.
     2. The intent is persisted *before* the request leaves, and the remote
        requestId is persisted *after* it comes back. A crash in between
        therefore leaves a job that can be recognised as possibly-submitted,
        and it is marked `unknown_submission` rather than silently re-sent.
     3. An unknown submission is never auto-retried.
     4. Cancel stops local waiting; it is not a refund, and it is not a
        guarantee that the provider stopped work.
   ========================================================================== */

import { randomUUID } from "node:crypto";
import { normalizedError } from "../../packages/contracts/src/index.mjs";

/** Legal transitions. Anything absent here is refused. */
const TRANSITIONS = {
  // A draft never left the machine, so cancelling it is a local discard.
  draft: ["queued", "failed", "cancelled"],
  queued: ["submitting", "cancel_requested", "failed", "cancelled"],
  // Cancel is legal while the request is in flight. Where it lands afterwards
  // depends on what can be proven: cancelled if it provably never left,
  // unknown_submission if acceptance cannot be ruled out, or running/succeeded
  // if it got through regardless.
  submitting: [
    "running",
    "succeeded",
    "failed",
    "unknown_submission",
    "cancel_requested",
  ],
  running: ["succeeded", "failed", "unknown_submission", "cancel_requested"],
  cancel_requested: [
    "cancelled",
    "succeeded",
    "failed",
    "unknown_submission",
    "running",
  ],
  succeeded: [],
  failed: [],
  unknown_submission: ["succeeded", "failed", "cancelled"],
  cancelled: [],
};

/** Statuses from which a fresh paid submission must never be auto-issued. */
const NO_AUTO_RESUBMIT = new Set(["submitting", "running", "unknown_submission"]);

export class JobStore {
  #db;
  #now;

  /** @param {{ db: ReturnType<import('./db.mjs').openDb>, now?: () => string }} opts */
  constructor({ db, now = () => new Date().toISOString() }) {
    this.#db = db;
    this.#now = now;
  }

  /**
   * Create a job for a client intent, or return the one that already exists.
   * The UNIQUE index makes the insert the atomic step: a concurrent second
   * call loses the race and reads back the winner.
   */
  createOrGet({ intentId, type, providerId, modelId, credentialRef, input }) {
    if (!intentId) throw new TypeError("intentId is required for de-duplication");

    const existing = this.#db
      .prepare("SELECT * FROM jobs WHERE intent_id = ?")
      .get(intentId);
    if (existing) return { job: hydrate(existing), created: false };

    const id = randomUUID();
    const at = this.#now();

    try {
      this.#db
        .prepare(
          `INSERT INTO jobs
             (id, intent_id, type, provider_id, model_id, credential_ref,
              input_snapshot, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          intentId,
          type,
          providerId,
          modelId ?? null,
          credentialRef,
          JSON.stringify(input ?? {}),
          "draft",
          at,
          at,
        );
    } catch (err) {
      // Lost the race against a concurrent identical intent: return theirs.
      if (String(err?.message ?? "").includes("UNIQUE")) {
        const row = this.#db
          .prepare("SELECT * FROM jobs WHERE intent_id = ?")
          .get(intentId);
        return { job: hydrate(row), created: false };
      }
      throw err;
    }

    this.#event(id, "created", { intentId });
    return { job: this.get(id), created: true };
  }

  get(id) {
    const row = this.#db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    return row ? hydrate(row) : null;
  }

  list({ limit = 100 } = {}) {
    return this.#db
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
      .all(limit)
      .map(hydrate);
  }

  /**
   * Apply a state change. Refuses transitions that are not in the table, so a
   * late-arriving callback cannot resurrect a finished job.
   */
  transition(id, to, patch = {}) {
    const job = this.get(id);
    if (!job) throw new ReferenceError(`unknown job: ${id}`);

    if (job.status === to) return job; // idempotent no-op

    const allowed = TRANSITIONS[job.status] ?? [];
    if (!allowed.includes(to)) {
      throw new Error(
        `illegal transition ${job.status} -> ${to} for job ${id}`,
      );
    }

    this.#db
      .prepare(
        `UPDATE jobs
            SET status = ?, revision = revision + 1, updated_at = ?,
                request_id   = COALESCE(?, request_id),
                generation_id= COALESCE(?, generation_id),
                error_json   = COALESCE(?, error_json),
                usage_json   = COALESCE(?, usage_json),
                output_asset_ids = COALESCE(?, output_asset_ids),
                cancel_requested_at = COALESCE(?, cancel_requested_at)
          WHERE id = ?`,
      )
      .run(
        to,
        this.#now(),
        patch.requestId ?? null,
        patch.generationId ?? null,
        patch.error ? JSON.stringify(patch.error) : null,
        patch.usage ? JSON.stringify(patch.usage) : null,
        patch.outputAssetIds ? JSON.stringify(patch.outputAssetIds) : null,
        patch.cancelRequestedAt ?? null,
        id,
      );

    this.#event(id, `status:${to}`, patch);
    return this.get(id);
  }

  /** Attach the provider's request id the moment it is known. */
  recordRequestId(id, requestId) {
    this.#db
      .prepare("UPDATE jobs SET request_id = ?, updated_at = ? WHERE id = ?")
      .run(requestId, this.#now(), id);
    this.#event(id, "request_id", { requestId });
    return this.get(id);
  }

  events(id) {
    return this.#db
      .prepare("SELECT * FROM job_events WHERE job_id = ? ORDER BY seq")
      .all(id);
  }

  /* ----------------------------------------------------- safety checks -- */

  /**
   * May this job be submitted again? Used by the runner and by any UI retry
   * affordance, so the answer cannot differ between the two.
   */
  canSubmit(job) {
    if (NO_AUTO_RESUBMIT.has(job.status)) {
      return {
        ok: false,
        reason: `任务处于 ${job.status}，可能已被供应商接受，禁止自动重发`,
      };
    }
    if (job.status === "succeeded") {
      return { ok: false, reason: "任务已成功，重发会产生重复产物" };
    }
    return { ok: true, reason: null };
  }

  /**
   * Mark jobs that were mid-submission when the process stopped. Called once
   * on startup; without it a crash during submit would look like a fresh draft
   * and get re-sent.
   */
  reconcileAfterRestart() {
    const stranded = this.#db
      .prepare("SELECT id, status FROM jobs WHERE status IN ('submitting','running')")
      .all();

    for (const row of stranded) {
      // A job that already carries a requestId can be polled; one without
      // cannot be proven unsubmitted, so it is unknown either way.
      const job = this.get(row.id);
      const hasRequestId = Boolean(job.requestId);
      this.transition(row.id, "unknown_submission", {
        error: normalizedError({
          code: "SUBMISSION_UNKNOWN",
          safeMessage: hasRequestId
            ? "进程重启，任务状态需向供应商查询确认"
            : "进程在提交过程中中断，无法确认是否已被接受",
          retryable: false,
          submissionCertainty: "unknown",
          providerRequestId: job.requestId ?? null,
        }),
      });
    }
    return stranded.length;
  }

  #event(jobId, kind, payload) {
    this.#db
      .prepare(
        "INSERT INTO job_events (job_id, at, kind, payload) VALUES (?,?,?,?)",
      )
      .run(jobId, this.#now(), kind, JSON.stringify(payload ?? {}));
  }
}

function hydrate(row) {
  return {
    id: row.id,
    intentId: row.intent_id,
    type: row.type,
    providerId: row.provider_id,
    modelId: row.model_id,
    credentialRef: row.credential_ref,
    input: JSON.parse(row.input_snapshot),
    status: row.status,
    revision: row.revision,
    requestId: row.request_id,
    generationId: row.generation_id,
    outputAssetIds: JSON.parse(row.output_asset_ids || "[]"),
    error: row.error_json ? JSON.parse(row.error_json) : null,
    usage: row.usage_json ? JSON.parse(row.usage_json) : null,
    cancelRequestedAt: row.cancel_requested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
