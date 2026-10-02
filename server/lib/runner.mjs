/* ==========================================================================
   Job runner.

   This is the piece that actually talks to a provider. It is written so the
   ordering rules in docs/architecture/data.md hold even if the process dies
   mid-flight:

     1. persist the intent          — already durable, done at create time
     2. transition to `submitting`  — now the job is visibly in flight
     3. call the provider
     4. persist requestId           — the moment we can prove acceptance
     5. import the artifact
     6. transition to `succeeded`

   A crash between 3 and 4 leaves a job that `reconcileAfterRestart` turns into
   `unknown_submission`, never into a silent resend.

   Failure handling follows specs/BYOK.md:
     - a timeout or 5xx is `unknown`, not `failed` — the request may have landed
     - a 4xx is `failed` with the request provably not accepted
     - a failed call may still have been billed, so cost is recorded as
       reported/unknown, never as zero
   ========================================================================== */

import { filenameFor } from "./assets.mjs";
import { normalizedError } from "../../packages/contracts/src/index.mjs";

/** What a provider adapter must hand back for a successful synchronous job. */
export function assertArtifact(artifact) {
  if (!artifact || !(artifact.bytes instanceof Uint8Array)) {
    throw new TypeError("adapter returned no bytes");
  }
  if (artifact.bytes.byteLength === 0) {
    // An empty body is a failure, not a zero-length success.
    throw new TypeError("adapter returned an empty artifact");
  }
  return artifact;
}

export class JobRunner {
  #jobs;
  #assets;
  #cost;
  #vault;
  #adapters;
  #now;

  constructor({
    jobs,
    assets,
    cost,
    vault,
    adapters,
    now = () => new Date().toISOString(),
  }) {
    this.#jobs = jobs;
    this.#assets = assets;
    this.#cost = cost;
    this.#vault = vault;
    this.#adapters = adapters;
    this.#now = now;
  }

  /**
   * Run one job. Never throws for a provider problem — the outcome is always
   * recorded on the job, because a job that failed silently is worse than one
   * that failed loudly.
   *
   * @param {string} jobId
   * @returns {Promise<{ ok: boolean, job: object, reason?: string }>}
   */
  async run(jobId) {
    const job = this.#jobs.get(jobId);
    if (!job) return { ok: false, job: null, reason: "unknown job" };

    // Refuse before spending anything: this is the duplicate-charge guard.
    const guard = this.#jobs.canSubmit(job);
    if (!guard.ok) {
      return { ok: false, job, reason: guard.reason };
    }

    const adapter = this.#adapters[job.providerId];
    if (!adapter) {
      return this.#fail(job, {
        code: "CAPABILITY_UNAVAILABLE",
        safeMessage: `未注册的 Provider：${job.providerId}`,
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }

    // The secret is resolved here, at the moment of dispatch, from the
    // credentialRef. It is never written into the job snapshot, because that
    // snapshot is persisted to disk and would otherwise put a key in SQLite.
    let key;
    try {
      key = this.#vault.useSecret(job.credentialRef);
    } catch {
      return this.#fail(job, {
        code: "AUTH_REQUIRED",
        safeMessage: "引用的密钥已不存在，请重新配置 Provider",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }

    this.#jobs.transition(jobId, "queued");
    this.#jobs.transition(jobId, "submitting");

    try {
      const out = await this.#dispatch(adapter, job, key);

      // Asynchronous first: an async submit has no artifact yet, and
      // assertArtifact would reject it as a failure.
      if (out.async) {
        this.#jobs.transition(jobId, "running");
        // The remote id is what a poll — or a restart — will resume from.
        this.#jobs.recordRequestId(jobId, out.remoteId);
        return {
          ok: true,
          job: this.#jobs.get(jobId),
          pendingRemote: out.remoteId,
        };
      }

      const artifact = assertArtifact(out.artifact);

      // Prove acceptance before anything else: this id is what a later query
      // or reconciliation would use.
      if (out.providerRequestId) {
        this.#jobs.recordRequestId(jobId, out.providerRequestId);
      }

      this.#jobs.transition(jobId, "running");

      const imported = await this.#assets.put({
        bytes: artifact.bytes,
        displayName: artifact.suggestedName ?? filenameFor(artifact.contentType, `job-${jobId}`),
        mediaType: artifact.contentType,
        origin: "generated",
        sourceJobId: jobId,
        // Provenance is recorded, not invented.
        licenseSource: "用户自有 Provider 生成的产物",
      });

      // Character cost is a metering signal. Without a verified price it is
      // recorded as unknown, NOT converted into money and NOT recorded as 0.
      this.#cost.record({
        jobId,
        providerId: job.providerId,
        state: "unknown",
        source: out.characterCost
          ? `character-cost=${out.characterCost}`
          : "no metering header",
      });

      const done = this.#jobs.transition(jobId, "succeeded", {
        outputAssetIds: [imported.asset.id],
        usage: { state: "unknown", characterCost: out.characterCost ?? null },
      });

      return { ok: true, job: done, asset: imported.asset };
    } catch (err) {
      return this.#classifyFailure(jobId, err);
    }
  }

  /**
   * Poll an async job that is already running.
   *
   * Uses the stored remote id, so a restart resumes polling rather than
   * starting a new generation. An unrecognised remote status leaves the job
   * running and reports what was seen, rather than declaring it finished.
   *
   * @param {string} jobId
   */
  async poll(jobId) {
    const job = this.#jobs.get(jobId);
    if (!job) return { ok: false, job: null, reason: "unknown job" };
    if (job.status !== "running" && job.status !== "cancel_requested") {
      return { ok: false, job, reason: `任务处于 ${job.status}，不进行轮询` };
    }
    if (!job.requestId) {
      return { ok: false, job, reason: "缺少远端任务 id，无法安全轮询" };
    }

    const adapter = this.#adapters[job.providerId];
    if (!adapter?.pollStatus) {
      return { ok: false, job, reason: "该 Provider 未实现轮询" };
    }

    let key;
    try {
      key = this.#vault.useSecret(job.credentialRef);
    } catch {
      return this.#fail(job, {
        code: "AUTH_REQUIRED",
        safeMessage: "引用的密钥已不存在，无法继续轮询",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }

    let out;
    try {
      out = await adapter.pollStatus({ key, remoteId: job.requestId });
    } catch (err) {
      // A failed poll says nothing about the generation itself.
      return {
        ok: false,
        job,
        reason: err?.safeMessage ?? "轮询失败",
        pollError: true,
      };
    }

    if (out.state === "running") {
      return { ok: false, job, reason: "远端仍在处理", stillRunning: true };
    }

    if (out.state === "unknown") {
      // Not an error, and definitely not a success.
      return { ok: false, job, reason: "远端返回了未识别的状态，保持运行中待确认" };
    }

    if (out.state === "failed") {
      const failed = this.#jobs.transition(jobId, "failed", {
        error: {
          code: "PROVIDER_REJECTED",
          safeMessage: out.errorMessage ?? "远端任务失败",
          retryable: false,
          submissionCertainty: "accepted",
          providerRequestId: job.requestId,
        },
      });
      this.#cost.record({
        jobId,
        providerId: job.providerId,
        state: "unknown",
        source: "远端任务失败，实际费用未知",
      });
      return { ok: false, job: failed, reason: out.errorMessage ?? "远端任务失败" };
    }

    // completed — fetch the artifact through the adapter so the URL is
    // resolved server-side with the key, never by the browser.
    if (!out.artifactUrl) {
      const stuck = this.#jobs.transition(jobId, "unknown_submission", {
        error: {
          code: "SUBMISSION_UNKNOWN",
          safeMessage: "远端称任务完成，但未返回可取回的产物地址",
          retryable: false,
          submissionCertainty: "unknown",
          providerRequestId: job.requestId,
        },
      });
      return { ok: false, job: stuck, reason: "远端称完成但无产物地址" };
    }

    return this.#ingest(job, adapter, key, out.artifactUrl);
  }

  /** Download a finished remote artifact into the local asset store. */
  async #ingest(job, adapter, key, artifactUrl) {
    let artifact;
    try {
      artifact = assertArtifact(
        await adapter.fetchArtifact({ key, url: artifactUrl }),
      );
    } catch (err) {
      // The remote generation succeeded; only the local import failed. Those
      // are two separate facts and the UI must be able to show both.
      const partial = this.#jobs.transition(job.id, "failed", {
        error: {
          code: "ASSET_IMPORT_FAILED",
          safeMessage: "远端已生成成功，但产物下载或导入失败，可重新下载同一结果，无需重新生成",
          retryable: true,
          submissionCertainty: "accepted",
          providerRequestId: job.requestId,
        },
      });
      return {
        ok: false,
        job: partial,
        reason: "远端成功，本地导入失败",
        remoteSucceeded: true,
      };
    }

    const imported = await this.#assets.put({
      bytes: artifact.bytes,
      displayName: artifact.suggestedName ?? filenameFor(artifact.contentType, `job-${job.id}`),
      mediaType: artifact.contentType,
      origin: "generated",
      sourceJobId: job.id,
      licenseSource: "用户自有 Provider 生成的产物",
    });

    this.#cost.record({
      jobId: job.id,
      providerId: job.providerId,
      state: "unknown",
      source: "异步任务完成，价格未核验",
    });

    const done = this.#jobs.transition(job.id, "succeeded", {
      outputAssetIds: [imported.asset.id],
    });
    return { ok: true, job: done, asset: imported.asset };
  }

  async #dispatch(adapter, job, key) {
    switch (job.type) {
      case "audio_isolation": {
        const bytes = this.#assets.read(job.input.assetId);
        if (!bytes) {
          throw normalizedError({
            code: "VALIDATION_ERROR",
            safeMessage: "引用的输入音频已不存在，请重新上传",
            retryable: false,
            submissionCertainty: "not_submitted",
          });
        }
        return adapter.submitIsolation({
          key,
          audio: bytes,
          fileName: job.input.fileName,
          inputMime: job.input.mimeType,
        });
      }
      case "sound_generation":
        return adapter.submitSfx({
          key,
          prompt: job.input.prompt,
          durationSeconds: job.input.durationSeconds,
          promptInfluence: job.input.promptInfluence,
          loop: job.input.loop,
          modelId: job.modelId ?? undefined,
        });
      case "speech_to_speech": {
        // The input arrives as a stored asset, not inline bytes, so the job
        // snapshot never carries audio.
        const bytes = this.#assets.read(job.input.assetId);
        if (!bytes) {
          throw normalizedError({
            code: "VALIDATION_ERROR",
            safeMessage: "引用的输入音频已不存在，请重新上传",
            retryable: false,
            submissionCertainty: "not_submitted",
          });
        }
        return adapter.submitSts({
          key,
          voiceId: job.input.voiceId,
          audio: bytes,
          fileName: job.input.fileName,
          modelId: job.modelId ?? undefined,
          params: job.input.params,
        });
      }
      case "text_to_speech":
        return adapter.submit({
          key,
          voiceId: job.input.voiceId,
          text: job.input.text,
          modelId: job.modelId ?? undefined,
          outputFormat: job.input.outputFormat,
          params: job.input.params,
        });
      case "image_generation":
      case "video_generation": {
        // Answers immediately with a remote id; the caller polls afterwards.
        const out = await adapter.submitAsync({
          key,
          prompt: job.input.prompt,
          modelId: job.modelId ?? undefined,
          imageUrl: job.input.imageUrl,
          durationSeconds: job.input.durationSeconds,
        });
        return { async: true, ...out };
      }
      default:
        throw normalizedError({
          code: "CAPABILITY_UNAVAILABLE",
          safeMessage: `未实现的任务类型：${job.type}`,
          retryable: false,
          submissionCertainty: "not_submitted",
        });
    }
  }

  /**
   * The distinction that matters: could the provider have accepted this?
   * `unknown` keeps the job out of any automatic retry path; `not_submitted`
   * makes a retry safe.
   */
  #classifyFailure(jobId, err) {
    const code = err?.code ?? "INTERNAL";
    const certainty = err?.submissionCertainty ?? "not_submitted";

    if (certainty === "unknown") {
      const job = this.#jobs.transition(jobId, "unknown_submission", {
        error: {
          code,
          safeMessage: `${err?.safeMessage ?? "提交结果未知"}；请先向供应商查询确认，不要直接重试`,
          retryable: false,
          submissionCertainty: "unknown",
          providerRequestId: err?.providerRequestId ?? null,
        },
      });
      return { ok: false, job, reason: "submission unknown" };
    }

    return this.#fail(jobId, {
      code,
      safeMessage: err?.safeMessage ?? "提交失败",
      // A 4xx is not worth retrying as-is; a rate limit is.
      retryable: err?.retryable === true,
      submissionCertainty: "not_submitted",
      providerRequestId: err?.providerRequestId ?? null,
    });
  }

  #fail(job, error) {
    const jobId = typeof job === "string" ? job : job.id;
    const failed = this.#jobs.transition(jobId, "failed", { error });
    // The attempt may still have been billed; record it as unknown so the
    // ledger never shows a failure as free.
    this.#cost.record({
      jobId,
      providerId: failed.providerId,
      state: "unknown",
      source: `失败后费用未知（${error.code}）`,
    });
    return { ok: false, job: failed, reason: error.safeMessage };
  }
}
