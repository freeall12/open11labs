/**
 * Shared contract between the local server, the provider adapters and the web
 * app. Plain ESM with JSDoc types so the server needs no build step while the
 * TypeScript app still gets types from the sibling `.d.ts`.
 *
 * Scope: creative generation only. Nothing here models the upstream account
 * system — there is no user, no subscription, no workspace and no entitlement.
 *
 * @module contracts
 */

export const CONTRACT_VERSION = 1;

/* ------------------------------------------------------------ vocabulary -- */

/**
 * Capability availability is deliberately three-state. "Not known" must never
 * collapse into "no", or the UI would invent a reason for a limitation nobody
 * has observed yet.
 */
export const AVAILABILITY = /** @type {const} */ ([
  "available",
  "unavailable",
  "unverified",
]);

/** Job lifecycle. `unknown_submission` is a first-class terminal-ish state. */
export const JOB_STATUS = /** @type {const} */ ([
  "draft",
  "queued",
  "submitting",
  "running",
  "succeeded",
  "failed",
  "unknown_submission",
  "cancel_requested",
  "cancelled",
]);

/**
 * Cost provenance. An unknown price is `unknown`; it is never coerced to 0,
 * because a failed or cancelled call can still be billed.
 */
export const COST_STATE = /** @type {const} */ ([
  "estimated",
  "reported",
  "reconciled",
  "unknown",
]);

/** How sure we are that a request reached the provider. */
export const SUBMISSION_CERTAINTY = /** @type {const} */ ([
  "not_submitted",
  "accepted",
  "unknown",
]);

export const ERROR_CODES = /** @type {const} */ ([
  "AUTH_REQUIRED",
  "PROVIDER_AUTH_FAILED",
  "CAPABILITY_UNAVAILABLE",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "SUBMISSION_UNKNOWN",
  "PROVIDER_REJECTED",
  "ASSET_IMPORT_FAILED",
  "STORAGE_FULL",
  "REVISION_CONFLICT",
  "NOT_FOUND",
  "NETWORK_ERROR",
  "INTERNAL",
]);

export const SUPPORTED_TASK_TYPES = /** @type {const} */ ([
  "text_to_speech",
  "speech_to_text",
  "speech_to_speech",
  "audio_isolation",
  "sound_generation",
  "image_generation",
  "video_generation",
  "text_to_dialogue",
]);

/* --------------------------------------------------------- constructors -- */

/**
 * @typedef {object} NormalizedError
 * @property {string} code
 * @property {string} safeMessage  Never contains secrets or raw provider bodies.
 * @property {boolean} retryable
 * @property {string} submissionCertainty
 * @property {string|null} providerRequestId
 * @property {Record<string,string>} fieldErrors
 */

/**
 * Build an error with defaults filled in, so call sites cannot forget the
 * fields that decide whether a retry is safe.
 *
 * @param {Partial<NormalizedError> & { code: string, safeMessage: string }} input
 * @returns {NormalizedError}
 */
export function normalizedError(input) {
  return {
    code: input.code,
    safeMessage: input.safeMessage,
    retryable: input.retryable ?? false,
    submissionCertainty: input.submissionCertainty ?? "not_submitted",
    providerRequestId: input.providerRequestId ?? null,
    fieldErrors: input.fieldErrors ?? {},
  };
}

/**
 * @typedef {object} UsageEntry
 * @property {string} jobId
 * @property {string} providerId
 * @property {string} state        One of COST_STATE.
 * @property {string|null} amount  null whenever state is "unknown".
 * @property {string|null} unit
 * @property {string|null} currency
 * @property {string|null} source   Where the number came from.
 * @property {string|null} asOf     ISO date the price was valid.
 */

/**
 * Cost for a job. With no verified price this returns `unknown` with a null
 * amount — never 0. `docs/architecture/security.md` calls out the case where
 * a failed call is still billed, so a zero here would be a lie.
 *
 * @param {{ state: string, amount?: number|null, unit?: string|null,
 *           currency?: string|null, source?: string|null, asOf?: string|null }} init
 * @returns {UsageEntry}
 */
export function usageEntry(init) {
  const unknown = init.state === "unknown";
  return {
    jobId: init.jobId,
    providerId: init.providerId,
    state: init.state,
    amount: unknown ? null : (init.amount ?? null),
    unit: unknown ? null : (init.unit ?? null),
    currency: unknown ? null : (init.currency ?? null),
    source: unknown ? "unverified" : (init.source ?? null),
    asOf: unknown ? null : (init.asOf ?? null),
  };
}

/**
 * @typedef {object} Capability
 * @property {string} providerId
 * @property {string} modelId        API identifier, never a display name.
 * @property {string} displayName
 * @property {string} taskType
 * @property {string} availability   One of AVAILABILITY.
 * @property {string|null} reason     Required when availability != available.
 * @property {Record<string,unknown>} inputSchema
 * @property {Record<string,unknown>} outputSchema
 * @property {string|null} unit
 * @property {{min:number|null, max:number|null}} bounds
 * @property {string|null} priceSource
 * @property {string|null} priceAsOf
 * @property {boolean} supportsCancel
 * @property {boolean} supportsStatusQuery
 * @property {boolean} supportsStreaming
 * @property {boolean} supportsIdempotency  Only true with documentation.
 */

/**
 * @param {Partial<Capability> & { providerId: string, modelId: string, taskType: string }} init
 * @returns {Capability}
 */
export function capability(init) {
  const availability = init.availability ?? "unverified";
  return {
    providerId: init.providerId,
    modelId: init.modelId,
    displayName: init.displayName ?? init.modelId,
    taskType: init.taskType,
    availability,
    reason: availability === "available" ? null : (init.reason ?? "未核验"),
    inputSchema: init.inputSchema ?? {},
    outputSchema: init.outputSchema ?? {},
    unit: init.unit ?? null,
    bounds: init.bounds ?? { min: null, max: null },
    priceSource: init.priceSource ?? null,
    priceAsOf: init.priceAsOf ?? null,
    supportsCancel: init.supportsCancel ?? false,
    supportsStatusQuery: init.supportsStatusQuery ?? false,
    supportsStreaming: init.supportsStreaming ?? false,
    supportsIdempotency: init.supportsIdempotency ?? false,
  };
}

/* -------------------------------------------------------------- guards -- */

function oneOf(set) {
  return (v) => set.includes(v);
}

/** Throws on a contract violation; used at every trust boundary. */
export function assertCapability(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("capability must be an object");
  }
  for (const k of ["providerId", "modelId", "taskType"]) {
    if (typeof value[k] !== "string" || !value[k]) {
      throw new TypeError(`capability.${k} must be a non-empty string`);
    }
  }
  if (!oneOf(AVAILABILITY)(value.availability)) {
    throw new TypeError(`capability.availability must be one of ${AVAILABILITY}`);
  }
  if (value.availability !== "available" && !value.reason) {
    throw new TypeError("a non-available capability must carry a reason");
  }
  return value;
}

export function assertJobStatus(value) {
  if (!oneOf(JOB_STATUS)(value)) {
    throw new TypeError(`job.status must be one of ${JOB_STATUS}`);
  }
  return value;
}

export function assertUsageEntry(value) {
  if (!oneOf(COST_STATE)(value.state)) {
    throw new TypeError(`usage.state must be one of ${COST_STATE}`);
  }
  if (value.state === "unknown" && typeof value.amount === "number") {
    throw new TypeError("an unknown cost must not carry a numeric amount");
  }
  return value;
}

export function assertNormalizedError(value) {
  if (!oneOf(ERROR_CODES)(value.code)) {
    throw new TypeError(`error.code must be one of ${ERROR_CODES}`);
  }
  if (!oneOf(SUBMISSION_CERTAINTY)(value.submissionCertainty)) {
    throw new TypeError(
      `error.submissionCertainty must be one of ${SUBMISSION_CERTAINTY}`,
    );
  }
  return value;
}

/**
 * Decide whether a job may be retried. The rule exists so no call site can
 * casually re-send a paid request whose outcome is unknown.
 *
 * @param {{status: string, error?: NormalizedError|null}} job
 * @returns {{ safe: boolean, why: string }}
 */
export function retryDecision(job) {
  if (job.status === "unknown_submission") {
    return { safe: false, why: "提交状态未知，必须先查询或人工确认" };
  }
  const err = job.error;
  if (!err) return { safe: false, why: "无错误信息" };
  if (err.submissionCertainty !== "not_submitted") {
    return { safe: false, why: "请求可能已被供应商接受，重试可能重复计费" };
  }
  if (err.code === "RATE_LIMITED") {
    return { safe: true, why: "限流且明确未被接受，可按 Retry-After 重试" };
  }
  if (err.code === "PROVIDER_AUTH_FAILED" || err.code === "AUTH_REQUIRED") {
    return { safe: false, why: "凭证问题，重试无意义" };
  }
  return {
    safe: err.retryable === true,
    why: err.retryable ? "可重试" : "不可重试",
  };
}
