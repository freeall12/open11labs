/**
 * Synthetic contract fixtures.
 *
 * These are hand-written, not captured from a live account: no request ids,
 * no voice ids, no keys, nothing account-specific. They exist so the adapter
 * and the UI can be tested without a credential and without spending quota.
 *
 * If the real API shape differs, fix the fixture AND the adapter together —
 * a fixture that drifts from reality is how a replica ends up confidently
 * wrong.
 */

/** `GET /v1/models` — schema UNVERIFIED (no authenticated call performed). */
export const modelsResponse = {
  models: [
    { model_id: "eleven_multilingual_v2", name: "Multilingual v2", category: "tts" },
    { model_id: "eleven_turbo_v2_5", name: "Turbo v2.5", category: "tts" },
    { model_id: "scribe_v1", name: "Scribe", category: "transcription" },
    { model_id: "eleven_multilingual_sts_v2", name: "Multilingual STS v2", category: "voice_changer" },
  ],
};

/** Same endpoint answering with a shape we do not model. */
export const modelsResponseUnexpectedShape = { data: { items: [] } };

/** TTS success headers documented in API-01. */
export const ttsSuccessHeaders = {
  "content-type": "audio/mpeg",
  "request-id": "req_synthetic_0001",
  "character-cost": "142",
};

export const ttsAudioBytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);

/** A one-character MP3 frame header, enough to assert bytes came through. */
export const errorBodies = {
  unauthorized: {
    status: 401,
    body: { detail: { status: "invalid_api_key", message: "Invalid API key" } },
  },
  forbidden: {
    status: 403,
    body: { detail: { status: "missing_permissions", message: "Missing permission" } },
  },
  rateLimited: {
    status: 429,
    body: { detail: { status: "too_many_requests", message: "Rate limit exceeded" } },
    headers: { "retry-after": "7" },
  },
  validation: {
    status: 422,
    body: {
      detail: {
        status: "invalid_uid",
        message: "Voice id is invalid",
        field_errors: { voice_id: "not_found" },
      },
    },
  },
  serverError: {
    status: 503,
    body: { detail: { status: "internal", message: "upstream unavailable" } },
  },
};
