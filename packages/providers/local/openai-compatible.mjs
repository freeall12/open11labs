/* ==========================================================================
   Local / self-hosted provider adapter (OpenAI-compatible).

   This is the "not locked to one vendor" half of the design: the same job and
   capability contracts work against a model server the user runs themselves
   (Ollama, LM Studio, vLLM, llama.cpp — anything speaking the OpenAI HTTP
   shape), with no API key and no data leaving the machine.

   It also covers local *speech* servers that expose the same routes, so a
   fully offline pipeline is possible.

   Two things it will never claim:
     - that a local model is equivalent to ElevenLabs' own. `specs/BYOK.md` is
       explicit that a local provider does not inherit proprietary quality.
     - that a capability exists before it has been observed. Everything starts
       `unverified`; the app does not assert parity.
   ========================================================================== */

import { capability, normalizedError, usageEntry } from "../../contracts/src/index.mjs";
import { redact } from "../lib/transport.mjs";

export const PROVIDER_ID = "openai-local";

/** Map our output-format ids onto the OpenAI speech `response_format` set. */
function formatOf(outputFormat) {
  const id = String(outputFormat ?? "").toLowerCase();
  for (const f of ["mp3", "opus", "aac", "flac", "wav", "pcm"]) {
    if (id.startsWith(f)) return { id: f, ext: f };
  }
  return { id: "mp3", ext: "mp3" };
}

export class LocalOpenAIAdapter {
  #baseURL;
  #apiKey;
  #fetchImpl;
  #timeoutMs;

  constructor({ baseURL, apiKey = "", fetchImpl, timeoutMs = 120_000 } = {}) {
    this.#baseURL = String(baseURL ?? "").replace(/\/+$/, "");
    // A local server usually needs no key; the field still exists so a
    // reverse-proxied one can require a bearer token.
    this.#apiKey = apiKey;
    this.#fetchImpl = fetchImpl ?? globalThis.fetch;
    this.#timeoutMs = timeoutMs;
  }

  #headers() {
    const h = { "content-type": "application/json" };
    if (this.#apiKey) h.authorization = `Bearer ${this.#apiKey}`;
    return h;
  }

  async #post(path, body) {
    const res = await this.#request(path, body);
    return res.json();
  }

  /** Shared POST: transport, timeouts and error mapping for every route. */
  async #request(path, body) {
    if (!this.#baseURL) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "本地 Provider 未配置 baseURL",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const res = await this.#fetchImpl(`${this.#baseURL}${path}`, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 401 || res.status === 403) {
          throw normalizedError({
            code: "PROVIDER_AUTH_FAILED",
            safeMessage: "本地服务拒绝了凭据（若无需密钥请留空）",
            retryable: false,
            submissionCertainty: "not_submitted",
          });
        }
        if (res.status === 404) {
          throw normalizedError({
            code: "CAPABILITY_UNAVAILABLE",
            safeMessage: `本地服务没有 ${path} 这条路由`,
            retryable: false,
            submissionCertainty: "not_submitted",
          });
        }
        throw normalizedError({
          code: "PROVIDER_REJECTED",
          // The upstream body is redacted, not truncated: a local gateway can
          // echo the Authorization header back, and a truncated raw body is
          // still a raw body.
          safeMessage: `本地服务返回 HTTP ${res.status}：${redact(text, this.#apiKey, 160)}`,
          retryable: res.status >= 500,
          submissionCertainty: "unknown",
        });
      }
      return res;
    } catch (err) {
      if (err?.code) throw err;
      const aborted = err?.name === "AbortError";
      throw normalizedError({
        code: "NETWORK_ERROR",
        safeMessage: aborted
          ? "本地服务响应超时（模型可能正在加载）"
          : `无法连接本地服务：${this.#baseURL}`,
        retryable: !aborted,
        // A local server that never answered leaves acceptance unproven.
        submissionCertainty: "unknown",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read the model list the local server actually serves. Naming a model that
   * was never observed would be a guess, so the UI offers only real ids.
   */
  async #getModels() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await this.#fetchImpl(`${this.#baseURL}/v1/models`, {
        headers: this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {},
        signal: controller.signal,
      });
      if (!res.ok) {
        throw normalizedError({
          code: "PROVIDER_AUTH_FAILED",
          safeMessage: `本地服务不可达或拒绝凭据（HTTP ${res.status}）`,
          retryable: false,
          submissionCertainty: "not_submitted",
        });
      }
      const body = await res.json().catch(() => ({}));
      return Array.isArray(body?.data) ? body.data : [];
    } catch (err) {
      if (err?.code) throw err;
      throw normalizedError({
        code: "NETWORK_ERROR",
        safeMessage: `无法连接本地服务：${this.#baseURL}（服务是否已启动？）`,
        retryable: true,
        submissionCertainty: "not_submitted",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Reachability and identity. `/v1/models` is a read-only listing, so it is
   * a legitimate no-generation validation.
   */
  async validateCredential() {
    const models = await this.#getModels();
    return { ok: true, modelCount: models.length, local: true };
  }

  /**
   * Model ids as the server reports them. Anything the server does not name is
   * left to the user to type — the app never invents a model name.
   */
  async listModels() {
    const raw = await this.#getModels();
    return raw
      .map((m) => (typeof m === "string" ? m : m?.id))
      .filter((id) => typeof id === "string" && id.length > 0)
      .map((id) => ({ id, source: "provider_list" }));
  }

  async listCapabilities() {
    const { modelCount } = await this.validateCredential();
    return [
      capability({
        providerId: PROVIDER_ID,
        modelId: "local-chat",
        displayName: "本地对话模型",
        taskType: "chat",
        // A local model is not equivalent to the hosted ones, and nothing has
        // been observed about its limits, so this stays unverified.
        availability: modelCount > 0 ? "unverified" : "unavailable",
        reason:
          modelCount > 0
            ? "本地模型的能力与上限未核验；本地模型不等同于供应商专有模型"
            : "本地服务未列出任何模型",
        supportsCancel: false,
        supportsStatusQuery: false,
        supportsStreaming: false,
        supportsIdempotency: false,
      }),
      capability({
        providerId: PROVIDER_ID,
        modelId: "local-tts",
        displayName: "本地语音合成",
        taskType: "text_to_speech",
        // Whether the local server actually serves /v1/audio/speech is only
        // known at submit time; the capability is advertised honestly as
        // unverified, never as equivalent to the hosted voices.
        availability: "unverified",
        reason: "本地语音服务是否可用取决于其是否提供 /v1/audio/speech；能力未核验",
        supportsCancel: false,
        supportsStatusQuery: false,
        supportsStreaming: false,
        supportsIdempotency: false,
      }),
    ];
  }

  /**
   * Chat completion. Used by the chat agent and by Flows LLM nodes.
   */
  async submit({ key: _key, messages, model, temperature, maxTokens }) {
    const data = await this.#post("/v1/chat/completions", {
      model: model ?? "local",
      messages,
      temperature: temperature ?? 0.7,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      stream: false,
    });

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: "本地服务返回了空回复",
        retryable: false,
        submissionCertainty: "accepted",
      });
    }

    return {
      artifact: {
        bytes: new TextEncoder().encode(content),
        contentType: "text/plain; charset=utf-8",
        suggestedName: "reply.txt",
      },
      providerRequestId: data?.id ?? null,
    };
  }

  /**
   * Text to speech against /v1/audio/speech. The response is raw audio bytes,
   * not JSON, so this does not go through #post. Used when the user routes
   * TTS to a self-hosted speech server — the fully-offline pipeline this
   * adapter's header promises.
   */
  async submitTextToSpeech({ key: _key, text, modelId, voiceId, outputFormat, params }) {
    const fmt = formatOf(outputFormat);
    const res = await this.#request("/v1/audio/speech", {
      model: modelId ?? "tts-1",
      input: text ?? "",
      voice: voiceId ?? "alloy",
      response_format: fmt.id,
      ...(typeof params?.speed === "number" ? { speed: params.speed } : {}),
    });

    const contentType = res.headers.get("content-type") ?? `audio/${fmt.id}`;
    if (/^application\/json/i.test(contentType)) {
      // A JSON body here is an error object that happened to return 2xx-shaped
      // metadata, never audio.
      const body = await res.text().catch(() => "");
      throw normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: `本地语音服务未返回音频（content-type: ${contentType}）：${redact(body, this.#apiKey, 160)}`,
        retryable: false,
        submissionCertainty: "unknown",
      });
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) {
      throw normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: "本地语音服务返回了空音频",
        retryable: false,
        submissionCertainty: "accepted",
      });
    }
    return {
      artifact: {
        bytes,
        contentType,
        suggestedName: `speech.${fmt.ext}`,
      },
      providerRequestId: res.headers.get("x-request-id") ?? null,
    };
  }

  async pollStatus() {
    throw normalizedError({
      code: "CAPABILITY_UNAVAILABLE",
      safeMessage: "本地对话为同步返回，没有可查询的任务状态",
      retryable: false,
    });
  }

  async cancel() {
    throw normalizedError({
      code: "CAPABILITY_UNAVAILABLE",
      safeMessage: "本地服务未提供取消接口",
      retryable: false,
    });
  }

  async fetchArtifact({ url }) {
    const res = await this.#fetchImpl(url);
    if (!res.ok) {
      throw normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: `本地服务产物下载失败（HTTP ${res.status}）`,
        retryable: true,
        submissionCertainty: "accepted",
      });
    }
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  /**
   * Cost. A local model consumes the user's own compute, not a metered API,
   * so there is no per-call price to report. That is not the same as "free
   * and unknowable" — it is a known-zero marginal fee with a real electricity
   * cost, and the UI says so rather than printing 0.
   */
  estimateCost({ jobId }) {
    return usageEntry({
      jobId,
      providerId: PROVIDER_ID,
      state: "estimated",
      amount: 0,
      unit: "api_calls",
      currency: "USD",
      source: "本地推理，无按次计费",
    });
  }

  async normalizeError(raw) {
    if (raw?.status === 404) {
      return normalizedError({
        code: "CAPABILITY_UNAVAILABLE",
        safeMessage: "本地服务没有这条路由",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }
    return normalizedError({
      code: "PROVIDER_REJECTED",
      safeMessage: `本地服务返回 HTTP ${raw?.status ?? "?"}`,
      retryable: false,
      submissionCertainty: "unknown",
    });
  }
}

export function createLocalAdapter({ baseURL, apiKey }) {
  return new LocalOpenAIAdapter({ baseURL, apiKey });
}
