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

export const PROVIDER_ID = "openai-local";

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
          safeMessage: `本地服务返回 HTTP ${res.status}：${text.slice(0, 160)}`,
          retryable: res.status >= 500,
          submissionCertainty: "unknown",
        });
      }
      return res.json();
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
   * Reachability and identity. `/v1/models` is a read-only listing, so it is
   * a legitimate no-generation validation.
   */
  async validateCredential() {
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
      const models = Array.isArray(body?.data) ? body.data : [];
      return { ok: true, modelCount: models.length, local: true };
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
