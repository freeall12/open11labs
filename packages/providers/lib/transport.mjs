/* ==========================================================================
   Shared transport for registry-driven provider adapters.

   Three platforms in packages/providers/registry.mjs are reachable over plain
   HTTPS with a key in one of three shapes — an Authorization bearer, a vendor
   header, or a query parameter. Each shape is a place a key can leak: a header
   shows up in a proxy log, a query parameter shows up in a URL. So the
   handling of all three lives here, in one reviewable place, instead of being
   re-implemented per adapter.

   The rules this module exists to hold:

     1. **The registry decides the host.** A base URL is only accepted if its
        host is on that platform's own `allowedHosts` list. The adapter re-checks
        on every request rather than trusting that the vault checked once at
        save time, because a request-time check is the one that still holds if
        a record is ever edited by another path.

     2. **The key never becomes a message.** Everything that reaches a human —
        `safeMessage`, a log line, a thrown Error — goes through `redact()`
        first. That covers the key itself plus the field-name patterns that
        carry it (`?key=`, `authorization:`, `x-api-key=`, URL userinfo).

     3. **An HTTP status does not decide the billing story.** A 4xx proves the
        request was refused, so it is `failed` / `not_submitted` and a retry is
        safe. A 5xx or a timeout may arrive *after* the work was accepted, so
        it is `unknown` — the job contract keeps those out of automatic retry.
   ========================================================================== */

import { normalizedError } from "../../contracts/src/index.mjs";

/** Auth shapes the registry may declare. */
export const AUTH_STYLES = /** @type {const} */ (["bearer", "x-api-key", "query"]);

/**
 * Refuse a URL whose host this platform is not registered for.
 *
 * @param {URL} url
 * @param {readonly string[]} allowedHosts
 * @param {string} providerId
 * @returns {URL} the same URL, for chaining
 */
export function assertProviderHost(url, allowedHosts, providerId) {
  if (!allowedHosts || allowedHosts.length === 0) {
    // A platform with an empty list is a self-hosted entry. Those do not go
    // through this module at all; reaching here means the registry and the
    // adapter disagree, which is a wiring bug rather than a user error.
    throw normalizedError({
      code: "CAPABILITY_UNAVAILABLE",
      safeMessage: `平台 ${providerId} 没有登记任何可用域名`,
      retryable: false,
      submissionCertainty: "not_submitted",
    });
  }
  if (url.protocol !== "https:") {
    throw normalizedError({
      code: "VALIDATION_ERROR",
      safeMessage: "供应商地址必须是 https",
      retryable: false,
      submissionCertainty: "not_submitted",
    });
  }
  if (url.username || url.password) {
    throw normalizedError({
      code: "VALIDATION_ERROR",
      safeMessage: "供应商地址不得内嵌用户名或密码",
      retryable: false,
      submissionCertainty: "not_submitted",
    });
  }
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) {
    // Naming the host is safe and useful: it is the value the user typed.
    throw normalizedError({
      code: "VALIDATION_ERROR",
      safeMessage: `平台 ${providerId} 未登记域名 ${host}`,
      retryable: false,
      submissionCertainty: "not_submitted",
    });
  }
  return url;
}

/**
 * Build the URL and headers for one upstream call, in the auth style the
 * registry declares for the platform.
 *
 * @param {{ baseURL: string, path: string, auth: string, key: string,
 *           allowedHosts: readonly string[], providerId: string }} input
 * @returns {{ url: URL, headers: Record<string, string> }}
 */
export function buildRequest({ baseURL, path, auth, key, allowedHosts, providerId }) {
  let url;
  try {
    // `path` is always absolute ("/v1/models"), so the base URL's own path
    // prefix is deliberately replaced rather than appended to.
    url = new URL(path, baseURL);
  } catch {
    throw normalizedError({
      code: "VALIDATION_ERROR",
      safeMessage: "供应商 baseURL 格式无效",
      retryable: false,
      submissionCertainty: "not_submitted",
    });
  }
  assertProviderHost(url, allowedHosts, providerId);

  /** @type {Record<string, string>} */
  const headers = { accept: "application/json" };
  if (!AUTH_STYLES.includes(auth)) {
    throw normalizedError({
      code: "INTERNAL",
      safeMessage: `未知的认证方式：${auth}`,
      retryable: false,
      submissionCertainty: "not_submitted",
    });
  }
  if (typeof key !== "string" || key.length === 0) {
    throw normalizedError({
      code: "AUTH_REQUIRED",
      safeMessage: "缺少 API 密钥",
      retryable: false,
      submissionCertainty: "not_submitted",
    });
  }

  if (auth === "bearer") {
    headers.authorization = `Bearer ${key}`;
  } else if (auth === "x-api-key") {
    headers["x-api-key"] = key;
  } else {
    // Query style. The key is in the URL from here on, so nothing downstream
    // may log or echo this URL: callers pass it straight to fetch.
    url.searchParams.set("key", key);
  }
  return { url, headers };
}

/**
 * Strip anything that could be a credential out of text bound for a human.
 *
 * `secret` is the exact key in use. The pattern rules exist because an
 * upstream body can echo a credential under a field name we do not control,
 * and because a caller may pass a message that embeds a URL.
 *
 * @param {unknown} text
 * @param {string} [secret]
 * @param {number} [limit]
 * @returns {string}
 */
export function redact(text, secret, limit = 200) {
  let out = String(text ?? "");
  if (secret) out = out.split(secret).join("[已脱敏]");
  out = out
    // ?key=… / &key=…
    .replace(/([?&]key=)[^&\s"'<>]+/gi, "$1[已脱敏]")
    // authorization: … / x-api-key= … / authorization: Bearer …
    .replace(
      /((?:authorization|api[-_]?key|x-api-key|xi-api-key|access[-_]?token|bearer)\s*[:=]\s*)("|')?(?:bearer\s+)?[^"'\s,;}]+/gi,
      "$1$2[已脱敏]",
    )
    // https://user:pass@host
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1[已脱敏]@");
  return out.slice(0, limit);
}

/**
 * Provider request id, whichever header this platform uses. Used so a job can
 * be traced upstream without a human pasting a log.
 *
 * @param {Response} res
 * @returns {string|null}
 */
export function requestIdFrom(res) {
  return (
    res.headers.get("request-id") ??
    res.headers.get("x-request-id") ??
    res.headers.get("x-goog-request-id") ??
    res.headers.get("x-amzn-requestid")
  );
}

/**
 * Pull a human-usable message out of an error body without keeping the body.
 *
 * The three shapes here are the ones actually observed from an unauthenticated
 * probe of each host (Anthropic `{"error":{"type","message"}}`, Google
 * `{"error":{"code","message","status"}}`, OpenAI-style `{"error":{"message"}}`).
 * Anything else yields null rather than a guess.
 */
function extractMessage(payload) {
  if (!payload || typeof payload !== "object") return null;
  const err = /** @type {any} */ (payload).error;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object" && typeof err.message === "string") return err.message;
  if (typeof payload.message === "string") return payload.message;
  const detail = /** @type {any} */ (payload).detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && typeof detail.message === "string") {
    return detail.message;
  }
  return null;
}

/**
 * Map a non-2xx response to the shared error contract.
 *
 * The status decides the *certainty*, and certainty is the whole point: a 4xx
 * was refused, so retrying is safe; a 5xx or a timeout may already have been
 * billed, so the job must not be resent.
 *
 * @param {Response} res
 * @param {{ label: string, secret?: string, requestId?: string|null }} info
 * @returns {Promise<import("../../contracts/src/index.mjs").NormalizedError>}
 */
export async function httpErrorFrom(res, { label, secret = "", requestId = null }) {
  const id = requestId ?? requestIdFrom(res);
  const status = res.status;

  let detail = null;
  try {
    const text = await res.text();
    if (text && text.length < 4096) detail = JSON.parse(text);
  } catch {
    // A non-JSON error body is normal. The status alone still carries the
    // decision, so the body is optional rather than required.
  }
  const detail_ = redact(extractMessage(detail) ?? res.statusText ?? `HTTP ${status}`, secret);

  if (status === 401 || status === 403) {
    return normalizedError({
      code: "PROVIDER_AUTH_FAILED",
      safeMessage:
        status === 401
          ? `${label} 拒绝了该 API 密钥（401）`
          : `${label} 认为该密钥缺少此能力的权限（403）`,
      retryable: false,
      submissionCertainty: "not_submitted",
      providerRequestId: id,
    });
  }
  if (status === 404) {
    return normalizedError({
      code: "CAPABILITY_UNAVAILABLE",
      safeMessage: `${label} 上没有该模型或路由（404）：${detail_}`,
      retryable: false,
      submissionCertainty: "not_submitted",
      providerRequestId: id,
    });
  }
  if (status === 408 || status === 504) {
    // The gateway gave up waiting. The request may have been received, so this
    // is the unknown case rather than a failure.
    return normalizedError({
      code: "SUBMISSION_UNKNOWN",
      safeMessage: `${label} 网关超时（${status}），无法确认请求是否已被接收`,
      retryable: false,
      submissionCertainty: "unknown",
      providerRequestId: id,
    });
  }
  if (status === 429) {
    return normalizedError({
      code: "RATE_LIMITED",
      safeMessage: `被 ${label} 限流，请按 Retry-After 等待`,
      retryable: true,
      // A rate limit is a refusal: nothing was accepted, so a retry is safe.
      submissionCertainty: "not_submitted",
      providerRequestId: id,
      fieldErrors: { retryAfter: res.headers.get("retry-after") ?? "unknown" },
    });
  }
  if (status >= 500) {
    return normalizedError({
      code: "PROVIDER_REJECTED",
      safeMessage: `${label} 内部错误（${status}），请求可能已被接收，请先查询确认`,
      retryable: true,
      submissionCertainty: "unknown",
      providerRequestId: id,
    });
  }
  if (status === 400 || status === 422) {
    return normalizedError({
      code: "VALIDATION_ERROR",
      safeMessage: `${label} 不接受该请求参数（${status}）：${detail_}`,
      retryable: false,
      submissionCertainty: "not_submitted",
      providerRequestId: id,
    });
  }
  return normalizedError({
    code: "PROVIDER_REJECTED",
    safeMessage: `${label} 返回 HTTP ${status}：${detail_}`,
    retryable: false,
    submissionCertainty: "not_submitted",
    providerRequestId: id,
  });
}

/**
 * Build a method that refuses a capability this platform does not implement.
 *
 * The alternative — omitting the method — turns a mis-selected provider into
 * `TypeError: adapter.submitStt is a function`, which surfaces to the user as
 * an opaque INTERNAL error. An explicit refusal names the platform and points
 * at the registry, which is the actionable part.
 *
 * @param {string} what      The capability, in the app's own words.
 * @param {string} label     The platform name.
 * @param {string} [hint]    What to do instead.
 */
export function unsupported(what, label, hint = "") {
  return async () => {
    throw normalizedError({
      code: "CAPABILITY_UNAVAILABLE",
      safeMessage: `${label} 未实现「${what}」能力。${hint}`.trim(),
      retryable: false,
      submissionCertainty: "not_submitted",
    });
  };
}
