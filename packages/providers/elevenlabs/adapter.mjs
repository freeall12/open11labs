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
import { redact } from "../lib/transport.mjs";

export const PROVIDER_ID = "elevenlabs";

/**
 * Speech-to-speech models only. The TTS ids are deliberately excluded: mixing
 * them produces a confusing upstream error instead of a clear local one.
 */
const STS_MODELS = ["eleven_multilingual_sts_v2", "eleven_voice_changer_v1"];

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
          // A FormData body must keep its own boundary, so no content-type is
          // set for it; a string body is already JSON.
          ...(body && typeof body === "string" && !headers["content-type"]
            ? { "content-type": "application/json" }
            : {}),
          ...headers,
        },
        body: body ?? undefined,
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
      throw await this.#normalizeHttpError(res, key);
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

  async #normalizeHttpError(res, key) {
    const requestId = res.headers.get("request-id");

    // Read a small amount of body for field errors, then discard it: the
    // safeMessage below never contains the raw payload. It is redacted against
    // the live key too, because an upstream error body is the one place a
    // provider could echo the credential back at us.
    let detail = null;
    try {
      const text = await res.text();
      if (text && text.length < 4096) detail = JSON.parse(text);
    } catch {
      /* body is optional */
    }

    const rawMessage =
      (detail && (detail.detail?.message || detail.detail || detail.message)) ||
      res.statusText ||
      `HTTP ${res.status}`;
    const message = redact(rawMessage, key, 200);

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
        safeMessage: `请求参数不被接受：${message}`,
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

    const fromModels = models.map((m) => {
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
    // Music composition is its own documented endpoint rather than part of the
    // /v1/models catalogue mapping, so it is advertised alongside, unverified.
    fromModels.push(
      capability({
        providerId: PROVIDER_ID,
        modelId: "music_v2_5",
        displayName: "Music v2.5",
        taskType: "music_generation",
        availability: "unverified",
        reason: "POST /v1/music/compose 已按公开文档实现；付费档位端点，未经真实调用核验",
        supportsStreaming: false,
        supportsCancel: false,
        supportsStatusQuery: false,
        supportsIdempotency: false,
      }),
    );
    return fromModels;
  }

  /**
   * Voice catalogue. Free, no generation, and it is how the TTS page can offer
   * a picker instead of a raw id box.
   *
   * The payload shape is UNVERIFIED: it has never been fetched with a real
   * credential. Parsing is defensive and an unrecognised shape yields an empty
   * list plus a reason, never a fabricated voice.
   *
   * @param {string} key
   */
  async listVoices(key) {
    const { data, requestId } = await this.#request({
      method: "GET",
      path: "/v1/voices",
      key,
    });

    const list = Array.isArray(data) ? data : data?.voices;
    if (!Array.isArray(list)) {
      return {
        voices: [],
        reason: "音色列表响应结构未识别，未做猜测映射",
        requestId,
      };
    }

    return {
      voices: list.map((v) => ({
        voiceId: String(v?.voice_id ?? v?.id ?? ""),
        name: String(v?.name ?? v?.voice_id ?? ""),
        category: v?.category ?? null,
        // The upstream preview path is a public URL shape; it is recorded, not
        // fetched here, so an unverified field can never cause a request.
        previewUrl: typeof v?.preview_url === "string" ? v.preview_url : null,
        labels: Array.isArray(v?.labels) ? v.labels : {},
        availableForTiers: v?.available_for_tiers ?? null,
        unverified: true,
      })).filter((v) => v.voiceId),
      reason: null,
      requestId,
    };
  }

  /**
   * Text to speech — the first end-to-end BYOK path (API-02).
   *
   * @param {{ key: string, voiceId: string, text: string,
   *           modelId?: string, outputFormat?: string }} input
   */
  async submitTextToSpeech(input) {
    return this.submit(input);
  }

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

  /**
   * Music composition — POST /v1/music/compose (documented; paid-tier).
   *
   * Only fields the public docs name are sent: `prompt` OR `composition_plan`,
   * `music_length_ms`, `model_id`. Custom lyrics travel as the documented
   * composition-plan chunk shape; page-side parameters with no public field
   * (variants, lyricsMode) stay in the local job record and are NOT forwarded.
   * No authenticated call has ever been made — this stays unverified.
   */
  async submitMusic({ key, prompt, lyrics, includeLyrics, durationSeconds, modelId }) {
    const model = modelId ?? "music_v2_5";
    const ms = typeof durationSeconds === "number" ? Math.round(durationSeconds * 1000) : null;

    let body;
    if (includeLyrics && lyrics?.trim()) {
      if (ms === null) {
        throw normalizedError({
          code: "VALIDATION_ERROR",
          safeMessage: "自定义歌词需要确定时长,才能构建文档定义的 composition plan",
          retryable: false,
          submissionCertainty: "not_submitted",
        });
      }
      body = {
        composition_plan: { chunks: [{ text: lyrics, durationMs: ms }] },
        model_id: model,
        music_length_ms: ms,
      };
    } else {
      if (!prompt?.trim()) {
        throw normalizedError({
          code: "VALIDATION_ERROR",
          safeMessage: "请输入音乐描述",
          retryable: false,
          submissionCertainty: "not_submitted",
        });
      }
      body = { prompt: prompt.trim(), model_id: model };
      if (ms !== null) body.music_length_ms = ms;
    }

    const out = await this.#request({
      method: "POST",
      path: "/v1/music/compose",
      key,
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", accept: "audio/mpeg" },
      expect: "binary",
    });

    return {
      artifact: {
        bytes: out.bytes,
        contentType: out.contentType ?? "audio/mpeg",
        suggestedName: `music-${Date.now()}.mp3`,
      },
      providerRequestId: out.requestId,
    };
  }

  /**
   * Image and video are asynchronous: the create call answers with
   * `{id, status:"pending"}` and the result has to be polled (API-07/08).
   *
   * The state mapping is written defensively because no authenticated response
   * has been seen. An unrecognised status becomes `unknown` rather than
   * `completed`, so a typo cannot be read as a finished job.
   */
  async submitAsync({
    key,
    prompt,
    modelId,
    imageUrl,
    durationSeconds,
    aspectRatio,
    resolution,
    sound,
    loop,
  }) {
    const payload = { prompt };
    if (modelId) payload.model_id = modelId;
    if (imageUrl) payload.image_url = imageUrl;
    if (typeof durationSeconds === "number") payload.duration_seconds = durationSeconds;
    // These three are sent only when the caller actually set them. The UI has
    // exposed 比例 / 分辨率 / 声音 controls, and dropping them on the floor made
    // those controls cosmetic. Whether the *upstream endpoint* honours them is
    // still unverified, so they are forwarded verbatim and never defaulted —
    // inventing a value here would make the control look real while changing
    // the output.
    if (aspectRatio) payload.aspect_ratio = aspectRatio;
    if (resolution) payload.resolution = resolution;
    if (typeof sound === "boolean") payload.generate_audio = sound;
    if (typeof loop === "boolean") payload.loop = loop;

    const { data, requestId } = await this.#request({
      method: "POST",
      path: "/v1/flows/image",
      key,
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });

    const remoteId = data?.id ?? data?.request_id ?? null;
    const status = String(data?.status ?? "").toLowerCase();

    if (!remoteId) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "供应商未返回任务 id，无法轮询",
        retryable: false,
        submissionCertainty: "unknown",
        providerRequestId: requestId,
      });
    }

    return {
      remoteId: String(remoteId),
      // Unknown statuses stay unknown; they never default to "done".
      state: mapRemoteStatus(status),
      requestId,
    };
  }

  /**
   * Poll an async task. `getArtifact` is only reachable once the remote says
   * the job is finished.
   */
  async pollStatus({ key, remoteId }) {
    const { data, requestId } = await this.#request({
      method: "GET",
      path: `/v1/flows/image/${encodeURIComponent(remoteId)}`,
      key,
    });

    const state = mapRemoteStatus(String(data?.status ?? "").toLowerCase());

    return {
      state,
      requestId,
      // The finished-artifact URL is recorded, never fetched on the caller's
      // behalf here — a second authenticated request is a separate decision.
      artifactUrl: state === "completed" && typeof data?.url === "string"
        ? data.url
        : null,
      errorMessage: state === "failed" ? String(data?.error ?? "供应商任务失败") : null,
    };
  }

  /**
   * Speech to speech — API-04, `POST /v1/speech-to-speech/:voice_id`, multipart.
   *
   * The model is constrained to the STS family on purpose. docs say the
   * multilingual STS id is not interchangeable with the TTS one, so a TTS
   * model id is rejected here rather than being forwarded and failing
   * opaquely upstream.
   */
  async submitSts({ key, voiceId, audio, fileName, modelId, params }) {
    if (!STS_MODELS.includes(modelId)) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: `变声器不支持模型 ${modelId}；请使用 ${STS_MODELS.join(" 或 ")}`,
        retryable: false,
        submissionCertainty: "not_submitted",
        fieldErrors: { modelId: `必须是 ${STS_MODELS.join(", ")}` },
      });
    }
    if (!voiceId) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "必须选择目标音色",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }
    if (!audio || !(audio instanceof Uint8Array) || audio.byteLength === 0) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "请先上传或录制音频",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }

    const form = new FormData();
    form.set("model_id", modelId);
    form.set("output_format", params?.outputFormat ?? "mp3_44100_128");
    if (typeof params?.stability === "number") {
      form.set("stability", String(params.stability));
    }
    if (typeof params?.similarity_boost === "number") {
      form.set("similarity_boost", String(params.similarity_boost));
    }
    if (typeof params?.style === "number") form.set("style", String(params.style));
    if (params?.remove_background_noise === undefined) {
      form.set("remove_background_noise", "false");
    } else {
      form.set("remove_background_noise", String(params.remove_background_noise));
    }
    // The filename is a label only; it is never used as a path.
    form.set(
      "audio",
      new Blob([audio], { type: params?.inputMime ?? "audio/mpeg" }),
      fileName ?? "input.mp3",
    );

    const out = await this.#request({
      method: "POST",
      path: `/v1/speech-to-speech/${encodeURIComponent(voiceId)}`,
      key,
      body: form,
      expect: "binary",
    });

    return {
      artifact: {
        bytes: out.bytes,
        contentType: out.contentType,
        suggestedName: `sts-${voiceId}-${Date.now()}.mp3`,
      },
      providerRequestId: out.requestId,
    };
  }

  /**
   * Sound effects — API-06, `POST /v1/sound-generation`.
   *
   * Duration, loop and encoding limits are account-plan dependent upstream, so
   * nothing is enforced locally beyond "is this a sane request". Inventing a
   * hard cap here would reject valid calls on one plan and allow invalid ones
   * on another; the real limit is enforced by the provider and surfaced as a
   * validation error.
   */
  async submitSfx({ key, prompt, durationSeconds, promptInfluence, loop, modelId }) {
    if (!prompt?.trim()) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "请输入音效描述",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }
    if (typeof durationSeconds === "number" && (durationSeconds <= 0 || durationSeconds > 60)) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: `时长需在 0 与 60 秒之间，收到 ${durationSeconds}`,
        retryable: false,
        submissionCertainty: "not_submitted",
        fieldErrors: { duration_seconds: "超出本地可接受范围" },
      });
    }

    const payload = { text: prompt.trim() };
    if (typeof durationSeconds === "number") payload.duration_seconds = durationSeconds;
    if (typeof promptInfluence === "number") {
      payload.prompt_influence = promptInfluence;
    }
    if (typeof loop === "boolean") payload.loop = loop;
    if (modelId) payload.model_id = modelId;

    const out = await this.#request({
      method: "POST",
      path: "/v1/sound-generation",
      key,
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      expect: "binary",
    });

    return {
      artifact: {
        bytes: out.bytes,
        contentType: out.contentType,
        suggestedName: `sfx-${Date.now()}.mp3`,
      },
      providerRequestId: out.requestId,
    };
  }

  /**
   * Voice isolation — API-05, `POST /v1/audio-isolation`, multipart.
   *
   * The documented 500MB / 1h figures are per-tool documentation observations,
   * not a verified API limit, and they are not a global upload cap. So nothing
   * is enforced here beyond refusing an empty file; the real limit is whatever
   * the provider reports.
   */
  async submitIsolation({ key, audio, fileName, inputMime }) {
    if (!audio || !(audio instanceof Uint8Array) || audio.byteLength === 0) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "请先上传或录制需要分离的音频",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }

    const form = new FormData();
    form.set("audio", new Blob([audio], { type: inputMime ?? "audio/mpeg" }), fileName ?? "input.mp3");

    const out = await this.#request({
      method: "POST",
      path: "/v1/audio-isolation",
      key,
      body: form,
      expect: "binary",
    });

    return {
      artifact: {
        bytes: out.bytes,
        contentType: out.contentType,
        suggestedName: `isolated-${Date.now()}.mp3`,
      },
      providerRequestId: out.requestId,
    };
  }

  /**
   * Speech to text — API-03, `POST /v1/speech-to-text`, multipart.
   *
   * Unlike the audio endpoints this one answers with JSON, not bytes, so the
   * artifact is synthesised locally from the returned transcript.
   */
  async submitStt({ key, audio, fileName, modelId, languageCode, options }) {
    if (!audio || !(audio instanceof Uint8Array) || audio.byteLength === 0) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "请先上传或录制音频",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }

    const form = new FormData();
    form.set("model_id", modelId ?? "scribe_v1");
    if (languageCode && languageCode !== "auto") form.set("language_code", languageCode);
    for (const [k, v] of Object.entries(options ?? {})) {
      if (v === undefined || v === null || v === "") continue;
      form.set(k, String(v));
    }
    form.set("audio", new Blob([audio], { type: "audio/mpeg" }), fileName ?? "input.mp3");

    const { data, requestId } = await this.#request({
      method: "POST",
      path: "/v1/speech-to-text",
      key,
      body: form,
    });

    const text = typeof data?.text === "string" ? data.text : "";
    if (!text) {
      // An empty transcript is not a successful transcription.
      throw normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: "供应商返回了空转录",
        retryable: false,
        submissionCertainty: "accepted",
        providerRequestId: requestId,
      });
    }

    return {
      // The transcript is a text artifact; it is stored like any other asset.
      transcript: {
        text,
        languageCode: data?.language_code ?? null,
        words: Array.isArray(data?.words) ? data.words.length : null,
        characters: Array.isArray(data?.characters) ? data.characters.length : null,
      },
      providerRequestId: requestId,
    };
  }

  /**
   * Dubbing, step 1 of 2 — `POST /v1/dubbing`.
   *
   * Endpoint confirmed to exist by an unauthenticated probe: it answers 401
   * with a key and 404 without one, which is how this API distinguishes a
   * real route from an unknown one. The request/response *shape* is still
   * unverified, so parsing stays defensive.
   *
   * Dubbing is a project flow: create returns an id, and the result is polled
   * on `GET /v1/dubbing/studio/{id}`.
   */
  async submitDubbing({ key, file, fileName, targetLanguage, modelId }) {
    if (!file || !(file instanceof Uint8Array) || file.byteLength === 0) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "请先上传要配音的源音频",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }
    if (!targetLanguage) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "请选择目标语言",
        retryable: false,
        submissionCertainty: "not_submitted",
      });
    }

    const form = new FormData();
    form.set("file", new Blob([file], { type: "audio/mpeg" }), fileName ?? "source.mp3");
    form.set("target_lang", targetLanguage);
    if (modelId) form.set("model_id", modelId);

    const { data, requestId } = await this.#request({
      method: "POST",
      path: "/v1/dubbing",
      key,
      body: form,
    });

    const projectId = data?.dubbing_project_id ?? data?.id ?? null;
    if (!projectId) {
      throw normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: "供应商未返回配音项目 id，无法继续查询",
        retryable: false,
        submissionCertainty: "unknown",
        providerRequestId: requestId,
      });
    }

    return {
      remoteId: String(projectId),
      state: mapDubbingStatus(String(data?.status ?? "")),
      requestId,
    };
  }

  /**
   * Dubbing, step 2 of 2 — `GET /v1/dubbing/studio/{id}`.
   *
   * A finished project exposes generated files; only then is there an
   * artifact to fetch.
   */
  async pollDubbing({ key, remoteId }) {
    const { data, requestId } = await this.#request({
      method: "GET",
      path: `/v1/dubbing/studio/${encodeURIComponent(remoteId)}`,
      key,
    });

    const state = mapDubbingStatus(String(data?.status ?? ""));
    const files = Array.isArray(data?.generated_files) ? data.generated_files : [];

    return {
      state,
      requestId,
      // Recorded, not fetched: resolving a download is a separate call with
      // its own authorization decision.
      generatedFileUrls: files
        .map((f) => (typeof f?.url === "string" ? f.url : null))
        .filter(Boolean),
      errorMessage: state === "failed" ? String(data?.error ?? "配音失败") : null,
    };
  }

  /**
   * Download a finished artifact. The URL is server-provided (recorded during
   * polling), and the key is attached here in-process — the browser never
   * sees a signed URL or a key.
   */
  async fetchArtifact({ key, url }) {
    if (!url) {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "没有可取回的产物地址",
        retryable: false,
        submissionCertainty: "unknown",
      });
    }
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw normalizedError({
        code: "VALIDATION_ERROR",
        safeMessage: "产物地址必须是 https",
        retryable: false,
        submissionCertainty: "accepted",
      });
    }
    const res = await this.#config.fetchImpl(url, {
      headers: { "xi-api-key": key },
    });
    if (!res.ok) {
      throw normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: `产物下载失败（HTTP ${res.status}）`,
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
   * Chat is not a capability of this provider. Saying so explicitly beats
   * letting a caller discover it as a confusing 404 later.
   */
  async submitChat() {
    throw normalizedError({
      code: "CAPABILITY_UNAVAILABLE",
      safeMessage:
        "ElevenLabs 不提供对话补全；请在本地设置中配置一个 OpenAI 兼容的本地或第三方 LLM Provider",
      retryable: false,
      submissionCertainty: "not_submitted",
    });
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

/**
 * Remote status -> local state. Anything unrecognised is `unknown`; it is
 * never optimistically read as `completed`.
 */
function mapRemoteStatus(status) {
  switch (status) {
    case "pending":
    case "queued":
    case "processing":
    case "in_progress":
      return "running";
    case "completed":
    case "succeeded":
    case "done":
      return "completed";
    case "failed":
    case "error":
    case "cancelled":
    case "canceled":
      return "failed";
    default:
      return "unknown";
  }
}

/**
 * Dubbing status -> local state. Dubbing uses its own vocabulary rather than
 * the image/video one, so it gets its own mapping instead of sharing.
 */
function mapDubbingStatus(status) {
  switch (status) {
    case "pending":
    case "queued":
    case "in_progress":
    case "processing":
      return "running";
    case "finished":
    case "completed":
    case "done":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    default:
      return "unknown";
  }
}

export const elevenlabs = new ElevenLabsAdapter();
export { ERROR_CODES };
