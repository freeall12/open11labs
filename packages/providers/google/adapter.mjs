/* ==========================================================================
   Google Gemini provider adapter (chat only).

   Auth is the registry's `query` style: the key travels as `?key=…`, which is
   the shape Google's own API accepts. A query key is the leakiest of the three
   auth styles, because URLs end up in proxy logs — so the request URL built
   here is passed straight to `fetch`, is never logged, never stored, and never
   reaches a `safeMessage`. The adapter re-checks the host against the registry
   on every call before the key is attached.

   Evidence, and its limits. The route was confirmed to exist by an
   unauthenticated read-only probe on 2026-10-03:

       GET https://generativelanguage.googleapis.com/v1beta/models -> 403
       {"error":{"code":403,"message":"Method doesn't allow unregistered
        callers …","status":"PERMISSION_DENIED"}}

   A 403 rather than a 404 is what distinguishes a real route from an invented
   one. What the probe does NOT establish is the shape of a successful body, so
   everything parsed below is defensive and every capability is declared
   `unverified`. No request with a real key has been made from this repository,
   and none may be: there is no test key and no budget authorisation.

   Model names come from the provider's own catalogue. `supportedGenerationMethods`
   is used the way the provider states it — a model that does not list
   `generateContent` is reported `unavailable` with that reason, not silently
   offered and then failed at submit time.
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

export const PROVIDER_ID = "google";

const LABEL = "Google Gemini";

/** Local request-shaping default, not a claim about any model's limit. */
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export class GoogleAdapter {
  #baseURL;
  #fetchImpl;
  #timeoutMs;
  #lastModelPayload = null;

  constructor({ baseURL = "https://generativelanguage.googleapis.com/v1beta", fetchImpl, timeoutMs = 120_000 } = {}) {
    this.#baseURL = baseURL;
    this.#fetchImpl = fetchImpl ?? globalThis.fetch;
    this.#timeoutMs = timeoutMs;
  }

  /**
   * The catalogue names a model as `models/<id>`; the generate call needs the
   * bare id in the path. A caller may pass either form, so normalise rather
   * than reject — and never produce an id that is not in the catalogue.
   *
   * @param {string} model
   */
  #modelPath(model) {
    const id = model.trim().replace(/^models\//, "");
    return `/v1beta/models/${encodeURIComponent(id)}`;
  }

  async #request({ method, path, key, body, expect = "json" }) {
    const { url, headers } = buildRequest({
      baseURL: this.#baseURL,
      path,
      auth: providerById(PROVIDER_ID)?.auth ?? "query",
      key,
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
        submissionCertainty: "unknown",
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw await httpErrorFrom(res, { label: LABEL, secret: key });
    }

    if (expect === "text") {
      return { data: await res.text().catch(() => ""), requestId: requestIdFrom(res) };
    }
    return { data: await res.json().catch(() => ({})), requestId: requestIdFrom(res) };
  }

  /* -------------------------------------------------------- interface -- */

  /**
   * Credential validation: `GET /v1beta/models` is a read-only listing. It
   * generates nothing, costs nothing, and returns no account or billing data.
   *
   * @param {string} key
   */
  async validateCredential(key) {
    const { data, requestId } = await this.#request({ method: "GET", path: "/v1beta/models", key });
    this.#lastModelPayload = data;
    return {
      ok: true,
      modelCount: Array.isArray(data?.models) ? data.models.length : null,
      // Observed behaviour: this host returns no request-id header, so this is
      // null rather than a fabricated id.
      providerRequestId: requestId,
    };
  }

  /**
   * @param {string} key
   * @returns {Promise<Array<{id: string, source: string, generateContent: boolean|null}>>}
   */
  async listModels(key) {
    let payload = this.#lastModelPayload;
    if (!payload) {
      ({ data: payload } = await this.#request({ method: "GET", path: "/v1beta/models", key }));
    }
    const models = Array.isArray(payload?.models) ? payload.models : null;
    if (!models) {
      throw normalizedError({
        code: "CAPABILITY_UNAVAILABLE",
        safeMessage: "模型列表响应结构与预期不符，未做猜测映射；请手动填写模型 ID",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }
    return models
      .filter((m) => typeof m?.name === "string" && m.name.length > 0)
      .map((m) => ({
        id: m.name.replace(/^models\//, ""),
        source: "provider_list",
        // null means the catalogue did not say; that is different from "no".
        generateContent: Array.isArray(m.supportedGenerationMethods)
          ? m.supportedGenerationMethods.includes("generateContent")
          : null,
      }));
  }

  /**
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
        // Three-state, used honestly: a model the catalogue says cannot do this
        // is `unavailable`; everything else is `unverified`, never `available`.
        availability: m.generateContent === false ? "unavailable" : "unverified",
        reason:
          m.generateContent === false
            ? "该模型在供应商目录中未列出 generateContent 方法"
            : "未做真实 API 验证；上下文上限、价格与配额待核验",
        supportsStreaming: false,
        supportsCancel: false,
        supportsStatusQuery: false,
        supportsIdempotency: false,
      }),
    );
  }

  /**
   * Chat completion — the whole implemented surface of the platform.
   *
   * @param {{ key: string, messages: Array<{role: string, content: string}>,
   *           model?: string, temperature?: number, maxTokens?: number,
   *           system?: string }} input
   */
  async submit({ key, messages, model, temperature, maxTokens, system }) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw normalizedError({
        code: "CAPABILITY_UNAVAILABLE",
        safeMessage: `${LABEL} 在本应用只实现了对话能力；语音、图像与视频请使用其他平台`,
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }
    if (typeof model !== "string" || model.trim().length === 0) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "必须选择模型 ID（可从本地模型列表中选择，或手动填写）",
        retryable: false,
        submissionCertainty: "not_submitted",
        fieldErrors: { modelId: "必填" },
      });
    }

    // Roles differ by vendor: Gemini names the assistant turn "model" and takes
    // the system prompt in its own field, not as a message.
    const contents = messages.map((m) => ({
      role: m?.role === "assistant" || m?.role === "model" ? "model" : "user",
      parts: [{ text: String(m?.content ?? "") }],
    }));

    /** @type {Record<string, unknown>} */
    const body = { contents };
    if (typeof system === "string" && system) {
      body.systemInstruction = { parts: [{ text: system }] };
    }
    /** @type {Record<string, unknown>} */
    const generationConfig = {
      maxOutputTokens:
        Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_OUTPUT_TOKENS,
    };
    if (typeof temperature === "number") generationConfig.temperature = temperature;
    body.generationConfig = generationConfig;

    const { data, requestId } = await this.#request({
      method: "POST",
      path: `${this.#modelPath(model)}:generateContent`,
      key,
      body,
    });

    const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : null;
    const text = Array.isArray(parts)
      ? parts
          .map((p) => (typeof p?.text === "string" ? p.text : ""))
          .join("")
      : "";
    if (!text) {
      // No candidate, or a candidate with no text, is a refusal — including
      // the case where the provider stopped for a safety reason. The reason
      // text is generic on purpose: the raw body is not returned.
      throw normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: candidate
          ? `${LABEL} 未返回文本内容（finishReason=${String(candidate.finishReason ?? "?")}）`
          : `${LABEL} 未返回候选结果`,
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
      // null, not a guess: this host sends no request-id header.
      providerRequestId: requestId,
      usageSummary: formatUsage(data?.usageMetadata),
    };
  }

  /**
   * Cost. No verified price exists for any model in this repository, so the
   * entry is `unknown` with a null amount — never 0.
   */
  estimateCost({ jobId }) {
    return usageEntry({ jobId, providerId: PROVIDER_ID, state: "unknown" });
  }

  /**
   * @param {{status: number, body?: unknown, requestId?: string|null}} raw
   */
  normalizeError(raw) {
    if (raw?.status === 400) {
      // Google's 400 covers both "bad key" and "bad request", so the reason
      // stays general rather than guessing which one it was.
      return normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: `${LABEL} 不接受该请求（400），请检查 API 密钥与请求参数`,
        retryable: false,
        submissionCertainty: "not_submitted",
        providerRequestId: raw?.requestId ?? null,
      });
    }
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

/** Metering provenance, or null when the provider sent no usage block. */
function formatUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const u = /** @type {any} */ (usage);
  const prompt = u.promptTokenCount;
  const candidates = u.candidatesTokenCount;
  if (!Number.isFinite(prompt) && !Number.isFinite(candidates)) return null;
  return `tokens in=${prompt ?? "?"} out=${candidates ?? "?"}（未换算金额）`;
}

/**
 * Factory used by the server's resolver. The key is passed per request rather
 * than bound here, so a long-lived adapter never holds a secret.
 */
export function createGoogleAdapter({ baseURL } = {}) {
  return new GoogleAdapter({ baseURL });
}
