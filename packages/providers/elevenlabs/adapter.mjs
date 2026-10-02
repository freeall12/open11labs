/* ==========================================================================
   ElevenLabs provider adapter.

   Auth: `xi-api-key` header (API-02). No browser session token, no private
   app endpoint, no site-internal call.

   Validation is `GET /v1/models`. That endpoint was confirmed to exist by an
   unauthenticated probe (401, not 404) and is a read-only capability query:
   it costs nothing, generates nothing, and returns no account, billing or
   subscription data — which is exactly what specs/BYOK.md requires of a
   validation step.

   The shapes parsed below are marked UNVERIFIED because no authenticated
   request has been made. They are defensive: an unexpected shape produces a
   capability list marked `unverified` rather than a confident wrong answer.
   ========================================================================== */

import {
  capability,
  normalizedError,
  usageEntry,
  ERROR_CODES,
} from "../../contracts/src/index.mjs";

export const PROVIDER_ID = "elevenlabs";

const MODEL_TASKS = {
  tts: "text_to_speech",
  transcription: "speech_to_text",
  voice_changer: "speech_to_speech",
  sound_generation: "sound_generation",
  music: "sound_generation",
  image: "image_generation",
  video: "video_generation",
  dialogue: "text_to_dialogue",
};

export class ElevenLabsAdapter {
  /** @type {{ baseURL: string, fetchImpl?: typeof fetch, timeoutMs?: number }} */
  #config;

  /** Cached `GET /v1/models` payload, so capability listing does not refetch. */
  #lastModelPayload = null;

  constructor({ baseURL = "https://api.elevenlabs.io", fetchImpl, timeoutMs = 30_000 } = {}) {
    this.#config = { baseURL, fetchImpl: fetchImpl ?? globalThis.fetch, timeoutMs };
  }

  #url(path) {
    return new URL(path, this.#config.baseURL).toString();
  }

  /**
   * Every upstream call goes through here so timeout handling and error
   * normalisation live in exactly one place. The key is passed per call and
   * never stored on the adapter.
   */
  async #request({ method, path, key, body, headers = {}, expect = "json" }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);

    let res;
    try {
      res = await this.#config.fetchImpl(this.#url(path), {
        method,
        signal: controller.signal,
        headers: {
          "xi-api-key": key,
          accept: expect === "binary" ? "*/*" : "application/json",
          ...(body && !headers["content-type"] ? { "content-type": body.type } : {}),
          ...headers,
        },
        body: body && body.type === "string" ? undefined : body,
      });
    } catch (err) {
      const aborted = err?.name === "AbortError";
      throw normalizedError({
        code: "NETWORK_ERROR",
        safeMessage: aborted
          ? "请求超时，无法确认是否已被接收"
          : "无法连接到供应商",
        retryable: !aborted,
        // A timeout after the bytes left is precisely the unknown case.
        submissionCertainty: "unknown",
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw await this.#normalizeHttpError(res);
    }

    if (expect === "binary") {
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
        requestId: res.headers.get("request-id"),
        characterCost: res.headers.get("character-cost"),
      };
    }
    return {
      data: await res.json().catch(() => ({})),
      requestId: res.headers.get("request-id"),
      characterCost: res.headers.get("character-cost"),
    };
  }

  async #normalizeHttpError(res) {
    const requestId = res.headers.get("request-id");

    // Read a small amount of body for field errors, then discard it: the
    // safeMessage below never contains the raw payload.
    let detail = null;
    try {
      const text = await res.text();
      if (text && text.length < 4096) detail = JSON.parse(text);
    } catch {
      /* body is optional */
    }

    const message =
      (detail && (detail.detail?.message || detail.detail || detail.message)) ||
      res.statusText ||
    `HTTP ${res.status}`;

    if (res.status === 401 || res.status === 403) {
      return normalizedError({
        code: "PROVIDER_AUTH_FAILED",
        safeMessage:
          res.status === 401
            ? "API 密钥无效或已失效"
            : "密钥有效但缺少该能力的权限",
        retryable: false,
        submissionCertainty: "not_submitted",
        providerRequestId: requestId,
      });
    }
    if (res.status === 429) {
      return normalizedError({
        code: "RATE_LIMITED",
        safeMessage: "被供应商限流",
        retryable: true,
        submissionCertainty: "not_submitted",
        providerRequestId: requestId,
        fieldErrors: {
          retryAfter: res.headers.get("retry-after") ?? "unknown",
        },
      });
    }
    if (res.status === 422 || res.status === 400) {
      return normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: `请求参数不被接受：${String(message).slice(0, 200)}`,
        retryable: false,
        submissionCertainty: "not_submitted",
        providerRequestId: requestId,
      });
    }
    if (res.status === 404) {
      return normalizedError({
        code: "CAPABILITY_UNAVAILABLE",
        safeMessage: "该模型或端点对当前密钥不可用",
        retryable: false,
        submissionCertainty: "not_submitted",
        providerRequestId: requestId,
      });
    }
    if (res.status >= 500) {
      return normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: "供应商内部错误",
        retryable: true,
        // A 5xx can arrive after the work was accepted; do not claim otherwise.
        submissionCertainty: "unknown",
        providerRequestId: requestId,
      });
    }
    return normalizedError({
      code: "PROVIDER_REJECTED",
      safeMessage: `供应商返回 HTTP ${res.status}`,
      retryable: false,
      submissionCertainty: "not_submitted",
      providerRequestId: requestId,
    });
  }

  /* -------------------------------------------------------- interface -- */

  /**
   * Credential validation. Costs nothing, generates nothing, and returns no
   * account data. It also doubles as a capability probe, which is why the
   * response is cached onto the adapter.
   *
   * @param {string} key
   */
  async validateCredential(key) {
    const { data, requestId } = await this.#request({
      method: "GET",
      path: "/v1/models",
      key,
    });

    this.#lastModelPayload = data;
    return {
      ok: true,
      modelCount: Array.isArray(data) ? data.length : null,
      providerRequestId: requestId,
    };
  }

  /**
   * Model list mapped to capabilities.
   *
   * The upstream field names are inferred, not observed, so every entry is
   * `unverified` until an authenticated run confirms the shape. Reporting
   * `available` on a guess is the failure mode specs/BYOK.md calls out.
   *
   * @param {string} key
   */
  async listCapabilities(key) {
    let payload = this.#lastModelPayload;
    if (!payload) {
      ({ data: payload } = await this.#request({
        method: "GET",
        path: "/v1/models",
        key,
      }));
    }

    const models = Array.isArray(payload) ? payload : payload?.models;
    if (!Array.isArray(models)) {
      return [
        capability({
          providerId: PROVIDER_ID,
          modelId: "unknown",
          taskType: "text_to_speech",
          availability: "unverified",
          reason: "模型列表响应结构与预期不符，未做猜测映射",
        }),
      ];
    }

    return models.map((m) => {
      const taskType = MODEL_TASKS[m?.category] ?? "text_to_speech";
      return capability({
        providerId: PROVIDER_ID,
        modelId: String(m?.model_id ?? m?.id ?? "unknown"),
        displayName: String(m?.name ?? m?.model_id ?? "unknown"),
        taskType,
        // Unverified: bounds, pricing and cancellation support all still need
        // an authenticated run before they can be called available.
        availability: "unverified",
        reason: "未做真实 API 验证；上限、价格与取消能力待核验",
        supportsStreaming: false,
        supportsCancel: false,
        supportsStatusQuery: false,
        supportsIdempotency: false,
      });
    });
  }

  /**
   * Text to speech — the first end-to-end BYOK path (API-02).
   *
   * @param {{ key: string, voiceId: string, text: string,
   *           modelId?: string, outputFormat?: string }} input
   */
  async submit({ key, voiceId, text, modelId, outputFormat = "mp3_44100_128" }) {
    if (!voiceId) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "必须选择音色",
        retryable: false,
      });
    }
    if (!text?.trim()) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "输入文本不能为空",
        retryable: false,
      });
    }

    const payload = {
      text,
      model_id: modelId ?? "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    };

    const out = await this.#request({
      method: "POST",
      path: `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      key,
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json", accept: "audio/mpeg" },
      expect: "binary",
    });

    return {
      artifact: {
        bytes: out.bytes,
        contentType: out.contentType,
        suggestedName: `${voiceId}-${Date.now()}.mp3`,
      },
      providerRequestId: out.requestId,
      // Character cost is a metering signal, not a price. It is recorded as
      // usage; it is never converted into money here.
      characterCost: out.characterCost,
    };
  }

  /** Synchronous TTS has nothing to poll. */
  async getStatus() {
    throw normalizedError({
      code: "CAPABILITY_UNAVAILABLE",
      safeMessage: "该能力为同步返回，没有可查询的任务状态",
      retryable: false,
    });
  }

  async cancel() {
    throw normalizedError({
      code: "CAPABILITY_UNAVAILABLE",
      safeMessage: "供应商未提供该能力的取消接口；取消仅能停止本地等待",
      retryable: false,
    });
  }

  async getArtifact() {
    throw normalizedError({
      code: "CAPABILITY_UNAVAILABLE",
      safeMessage: "同步能力在提交时直接返回产物",
      retryable: false,
    });
  }

  /**
   * Cost. No price has been verified for any model, so every entry is
   * `unknown` with a null amount. A verified price would need a dated source;
   * see docs/architecture/providers.md.
   */
  estimateCost({ jobId }) {
    return usageEntry({ jobId, providerId: PROVIDER_ID, state: "unknown" });
  }

  /**
   * Mapper for callers that already hold a raw response.
   * @param {{status: number, body?: unknown, requestId?: string|null}} raw
   */
  normalizeError(raw) {
    if (raw.status === 401 || raw.status === 403) {
      return normalizedError({
        code: "PROVIDER_AUTH_FAILED",
        safeMessage: "API 密钥无效或缺少权限",
        retryable: false,
        submissionCertainty: "not_submitted",
        providerRequestId: raw.requestId ?? null,
      });
    }
    if (raw.status === 429) {
      return normalizedError({
        code: "RATE_LIMITED",
        safeMessage: "被供应商限流",
        retryable: true,
        submissionCertainty: "not_submitted",
        providerRequestId: raw.requestId ?? null,
      });
    }
    if (raw.status === 422 || raw.status === 400) {
      return normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "请求参数不被接受",
        retryable: false,
        submissionCertainty: "not_submitted",
        providerRequestId: raw.requestId ?? null,
      });
    }
    return normalizedError({
      code: "PROVIDER_REJECTED",
      safeMessage: `供应商返回 HTTP ${raw.status}`,
      retryable: raw.status >= 500,
      submissionCertainty: raw.status >= 500 ? "unknown" : "not_submitted",
      providerRequestId: raw.requestId ?? null,
    });
  }
}

export const elevenlabs = new ElevenLabsAdapter();
export { ERROR_CODES };
