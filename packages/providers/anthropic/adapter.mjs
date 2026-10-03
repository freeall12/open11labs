/* ==========================================================================
   Anthropic provider adapter (chat only).

   Auth is the registry's `x-api-key` style, plus the `anthropic-version` header
   the Messages API requires on every request.

   Evidence, and its limits. The route was confirmed to exist by an
   unauthenticated read-only probe on 2026-10-03:

       GET https://api.anthropic.com/v1/models   -> 401
       {"type":"error","error":{"type":"authentication_error",
        "message":"x-api-key header is required"},"request_id":"req_011…"}
       GET https://api.anthropic.com/v1/messages -> 405 (POST only)

   A 401 rather than a 404 is what distinguishes a real route from an invented
   one, and the error text names `x-api-key` as the expected header. What that
   probe does NOT establish is the shape of a successful body: no request with
   a real key has ever been made here, so every response shape parsed below is
   defensive and every capability is declared `unverified`. There is no test
   key and no budget authorisation for this repository, so none is asked for.

   Model names are never invented. `listModels` reads the provider's own
   catalogue and an unrecognised shape is reported as a reason, not patched
   into a guess.
   ========================================================================== */

import {
  capability,
  normalizedError,
  usageEntry,
} from "../../contracts/src/index.mjs";
import { allowedHostsFor, providerById } from "../registry.mjs";
import {
  buildRequest,
  httpErrorFrom,
  requestIdFrom,
  unsupported,
} from "../lib/transport.mjs";

export const PROVIDER_ID = "anthropic";

const LABEL = "Anthropic";

/**
 * The Messages API rejects a request with no `max_tokens`, and the chat page
 * does not send one. This is a LOCAL request-shaping default, not a claim about
 * any model limit; a caller that knows its own limit should pass `maxTokens`.
 */
const DEFAULT_MAX_TOKENS = 1024;

/**
 * The API version this request shape was written against. The API requires the
 * header; the value is a protocol constant, overridable so a future version can
 * be used without editing the adapter.
 */
const DEFAULT_API_VERSION = "2023-06-01";

export class AnthropicAdapter {
  #baseURL;
  #fetchImpl;
  #timeoutMs;
  #apiVersion;
  #lastModelPayload = null;

  constructor({
    baseURL = "https://api.anthropic.com/v1",
    fetchImpl,
    timeoutMs = 120_000,
    apiVersion = DEFAULT_API_VERSION,
  } = {}) {
    this.#baseURL = baseURL;
    this.#fetchImpl = fetchImpl ?? globalThis.fetch;
    this.#timeoutMs = timeoutMs;
    this.#apiVersion = apiVersion;
  }

  /**
   * One request path for every call, so timeout handling, the host check and
   * error normalisation cannot drift apart between methods. The key is passed
   * per call and never stored on the adapter.
   */
  async #request({ method, path, key, body, expect = "json" }) {
    const { url, headers } = buildRequest({
      baseURL: this.#baseURL,
      path,
      auth: providerById(PROVIDER_ID)?.auth ?? "x-api-key",
      key,
      // Read from the registry, never hardcoded here: the registry is the one
      // list a reviewer reads when deciding where a key may be sent.
      allowedHosts: allowedHostsFor(PROVIDER_ID),
      providerId: PROVIDER_ID,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    let res;
    try {
      res = await this.#fetchImpl(url, {
        method,
        signal: controller.signal,
        headers: {
          ...headers,
          "anthropic-version": this.#apiVersion,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const aborted = err?.name === "AbortError";
      throw normalizedError({
        code: "NETWORK_ERROR",
        safeMessage: aborted
          ? `请求 ${LABEL} 超时，无法确认是否已被接收`
          : `无法连接到 ${LABEL}（请检查网络与 baseURL 配置）`,
        retryable: !aborted,
        // A timeout after the request left is the unknown case, not a failure.
        submissionCertainty: "unknown",
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // The error body is read for a redacted message and then dropped; it is
      // never returned to the caller verbatim.
      throw await httpErrorFrom(res, { label: LABEL, secret: key });
    }

    if (expect === "text") {
      return {
        data: await res.text().catch(() => ""),
        requestId: requestIdFrom(res),
      };
    }
    return { data: await res.json().catch(() => ({})), requestId: requestIdFrom(res) };
  }

  /* -------------------------------------------------------- interface -- */

  /**
   * Credential validation. `GET /v1/models` is a read-only capability query:
   * it generates nothing, costs nothing, and returns no account, billing or
   * subscription data — which is what specs/BYOK.md requires of validation.
   *
   * @param {string} key
   */
  async validateCredential(key) {
    const { data, requestId } = await this.#request({ method: "GET", path: "/v1/models", key });
    this.#lastModelPayload = data;
    return {
      ok: true,
      modelCount: Array.isArray(data?.data) ? data.data.length : null,
      providerRequestId: requestId,
    };
  }

  /**
   * Model ids exactly as the provider names them.
   *
   * The server route for this has no reason channel, so an unrecognised shape
   * is raised as an error carrying the reason rather than returned as an empty
   * list that the UI would read as "this account has no models".
   *
   * @param {string} key
   */
  async listModels(key) {
    let payload = this.#lastModelPayload;
    if (!payload) {
      ({ data: payload } = await this.#request({ method: "GET", path: "/v1/models", key }));
    }
    const models = Array.isArray(payload?.data) ? payload.data : null;
    if (!models) {
      throw normalizedError({
        code: "CAPABILITY_UNAVAILABLE",
        safeMessage: "模型列表响应结构与预期不符，未做猜测映射；请手动填写模型 ID",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }
    return models
      .map((m) => (typeof m?.id === "string" ? m.id : null))
      .filter(Boolean)
      .map((id) => /** @type {{id: string, source: string}} */ ({ id, source: "provider_list" }));
  }

  /**
   * Every row stays `unverified`: a model appearing in the catalogue does not
   * prove this key may call it, and no price or bound has been confirmed.
   *
   * @param {string} key
   */
  async listCapabilities(key) {
    const models = await this.listModels(key);
    return models.map((m) =>
      capability({
        providerId: PROVIDER_ID,
        modelId: m.id,
        displayName: m.id,
        taskType: "chat",
        availability: "unverified",
        reason: "未做真实 API 验证；上下文上限、价格与可用性待核验",
        // Streaming exists upstream but this adapter does not implement it, so
        // it is declared false rather than inherited from a guess.
        supportsStreaming: false,
        supportsCancel: false,
        supportsStatusQuery: false,
        supportsIdempotency: false,
      }),
    );
  }

  /**
   * Chat completion. This is the whole implemented surface of the platform.
   *
   * @param {{ key: string, messages: Array<{role: string, content: string}>,
   *           model?: string, temperature?: number, maxTokens?: number,
   *           system?: string }} input
   */
  async submit({ key, messages, model, temperature, maxTokens, system }) {
    if (!Array.isArray(messages) || messages.length === 0) {
      // The runner routes every non-chat generation through this method too, so
      // a mis-selected platform must fail here with a reason rather than post a
      // malformed chat request.
      throw normalizedError({
        code: "CAPABILITY_UNAVAILABLE",
        safeMessage: `${LABEL} 在本应用只实现了对话能力；语音、图像与视频请使用其他平台`,
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }
    if (typeof model !== "string" || model.trim().length === 0) {
      // No default model. Naming one here would be a guess about what this
      // key can reach, and a wrong guess becomes an opaque upstream error.
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "必须选择模型 ID（可从本地模型列表中选择，或手动填写）",
        retryable: false,
        submissionCertainty: "not_submitted",
        fieldErrors: { modelId: "必填" },
      });
    }

    const payload = {
      model: model.trim(),
      max_tokens: Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS,
      messages: messages.map((m) => ({
        role: m?.role === "assistant" ? "assistant" : "user",
        content: String(m?.content ?? ""),
      })),
      stream: false,
    };
    if (typeof system === "string" && system) payload.system = system;
    if (typeof temperature === "number") payload.temperature = temperature;

    const { data, requestId } = await this.#request({
      method: "POST",
      path: "/v1/messages",
      key,
      body: payload,
    });

    // A reply is a list of content blocks. Only text blocks are rendered, and
    // a response with none is a refusal, not an empty successful answer.
    const blocks = Array.isArray(data?.content) ? data.content : null;
    const text = Array.isArray(blocks)
      ? blocks
          .filter((b) => b?.type === "text" && typeof b?.text === "string")
          .map((b) => b.text)
          .join("")
      : "";
    if (!text) {
      throw normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: `${LABEL} 返回了空的回复内容`,
        retryable: false,
        submissionCertainty: "accepted",
        providerRequestId: requestId,
      });
    }

    return {
      artifact: {
        bytes: new TextEncoder().encode(text),
        contentType: "text/plain; charset=utf-8",
        suggestedName: "reply.txt",
      },
      providerRequestId: requestId ?? data?.id ?? null,
      // Token counts are a metering signal, not a price. They are recorded as
      // provenance and never converted into money here.
      usageSummary: formatUsage(data?.usage),
    };
  }

  /**
   * Cost. No price for any model has been verified against a dated source, so
   * the entry is `unknown` with a null amount — never 0, because a failed or
   * cancelled call can still be billed.
   */
  estimateCost({ jobId }) {
    return usageEntry({ jobId, providerId: PROVIDER_ID, state: "unknown" });
  }

  /**
   * Mapper for callers holding a raw response.
   * @param {{status: number, body?: unknown, requestId?: string|null}} raw
   */
  normalizeError(raw) {
    if (raw?.status === 401 || raw?.status === 403) {
      return normalizedError({
        code: "PROVIDER_AUTH_FAILED",
        safeMessage: `${LABEL} 拒绝了该 API 密钥`,
        retryable: false,
        submissionCertainty: "not_submitted",
        providerRequestId: raw?.requestId ?? null,
      });
    }
    if (raw?.status === 429) {
      return normalizedError({
        code: "RATE_LIMITED",
        safeMessage: `被 ${LABEL} 限流`,
        retryable: true,
        submissionCertainty: "not_submitted",
        providerRequestId: raw?.requestId ?? null,
      });
    }
    if (raw?.status >= 500) {
      return normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: `${LABEL} 内部错误，请求可能已被接收，请先查询确认`,
        retryable: true,
        submissionCertainty: "unknown",
        providerRequestId: raw?.requestId ?? null,
      });
    }
    return normalizedError({
      code: "PROVIDER_REJECTED",
      safeMessage: `${LABEL} 返回 HTTP ${raw?.status ?? "?"}`,
      retryable: false,
      submissionCertainty: "not_submitted",
      providerRequestId: raw?.requestId ?? null,
    });
  }

  /* -- capabilities this platform does not implement -------------------- */

  async listVoices() {
    throw normalizedError({
      code: "CAPABILITY_UNAVAILABLE",
      safeMessage: `${LABEL} 不提供音色列表；音色相关能力请使用 ElevenLabs`,
      retryable: false,
      submissionCertainty: "not_submitted",
    });
  }

  pollStatus = unsupported("查询远端任务状态", LABEL, "对话为同步返回，没有可轮询的远端任务");
  cancel = unsupported("取消远端任务", LABEL, "取消只能停止本地等待，远端已生成的计费不受影响");
  fetchArtifact = unsupported("下载远端产物", LABEL, "对话内容随响应直接返回");
  submitAsync = unsupported("异步图像/视频生成", LABEL);
  submitStt = unsupported("语音转文字", LABEL);
  submitIsolation = unsupported("人声分离", LABEL);
  submitSts = unsupported("变声", LABEL);
  submitSfx = unsupported("音效生成", LABEL);
  submitDubbing = unsupported("配音", LABEL);
}

/** Human-readable metering provenance, or null when the provider sent none. */
function formatUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const input = /** @type {any} */ (usage).input_tokens;
  const output = /** @type {any} */ (usage).output_tokens;
  if (!Number.isFinite(input) && !Number.isFinite(output)) return null;
  return `tokens input=${input ?? "?"} output=${output ?? "?"}（未换算金额）`;
}

/**
 * Factory used by the server's resolver.
 *
 * The key is deliberately NOT accepted here. It is passed per request (as in
 * the ElevenLabs adapter) so a long-lived adapter object never holds a secret.
 */
export function createAnthropicAdapter({ baseURL } = {}) {
  return new AnthropicAdapter({ baseURL });
}
