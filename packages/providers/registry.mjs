/* ==========================================================================
   Provider registry.

   BYOK means the user brings their own key, and in practice that key comes
   from *some* platform. Hard-coding one vendor's host list would make every
   other platform impossible to add, so the supported set is declared here as
   data: id, label, default base URL, the hosts allowed to serve that base
   URL, how the key is sent, and which task types the provider is wired for.

   Three rules this file exists to enforce:

   1. **No catch-all fetch.** `allowedHosts` is the only way a base URL is
      accepted. A host that is not on a provider's list is refused, so a
      malicious or mistaken base URL cannot make the server send the user's key
      somewhere unintended. Adding a provider means adding its hosts here,
      which is a reviewable change.

   2. **The key never travels to a page.** Adapters receive the secret through
      the server's credential lookup; nothing in this file is imported by the
      frontend.

   3. **Capability is declared, not assumed.** `taskTypes` says what the
      adapter is *implemented* for. A model appearing in a provider's catalogue
      does not make it callable, and the UI reads this list rather than
      guessing from a model name.
   ========================================================================== */

/** @typedef {"tts"|"stt"|"sts"|"isolation"|"sfx"|"image"|"video"|"chat"} TaskKind */

export const PROVIDERS = [
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    /** Audio-first: speech, cloning, sound, dubbing, speech-to-text. */
    defaultBaseURL: "https://api.elevenlabs.io",
    allowedHosts: ["api.elevenlabs.io", "api.eu.elevenlabs.io"],
    /** Bearer token in the Authorization header. */
    auth: "bearer",
    keyPlaceholder: "sk_…",
    docs: "https://elevenlabs.io/docs/api-reference",
    taskTypes: ["tts", "sts", "stt", "isolation", "sfx", "image", "video"],
    /** No completion endpoint; the chat page must not offer this provider. */
    chat: false,
    adapter: "elevenlabs",
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultBaseURL: "https://api.openai.com/v1",
    allowedHosts: ["api.openai.com"],
    auth: "bearer",
    keyPlaceholder: "sk-…",
    docs: "https://platform.openai.com/docs/api-reference",
    taskTypes: ["chat", "stt", "tts"],
    chat: true,
    adapter: "openai",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultBaseURL: "https://api.anthropic.com/v1",
    allowedHosts: ["api.anthropic.com"],
    /** Anthropic uses its own header rather than a bearer token. */
    auth: "x-api-key",
    keyPlaceholder: "sk-ant-…",
    docs: "https://docs.anthropic.com/en/api",
    taskTypes: ["chat"],
    chat: true,
    adapter: "anthropic",
  },
  {
    id: "google",
    label: "Google Gemini",
    defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    allowedHosts: ["generativelanguage.googleapis.com"],
    /** Google takes the key as a query parameter on some routes. */
    auth: "query",
    keyPlaceholder: "AIza…",
    docs: "https://ai.google.dev/api",
    taskTypes: ["chat"],
    chat: true,
    adapter: "google",
  },
  {
    id: "openai-compatible",
    label: "OpenAI 兼容网关（自托管）",
    /** Any OpenAI-shaped server the user runs. Must be opted into. */
    defaultBaseURL: "http://127.0.0.1:11434/v1",
    allowedHosts: [],
    requiresSelfHosted: true,
    auth: "bearer",
    keyPlaceholder: "通常留空",
    docs: "",
    taskTypes: ["chat", "stt", "tts"],
    chat: true,
    adapter: "openai-compatible",
  },
];

/** @type {Map<string, typeof PROVIDERS[number]>} */
const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export function providerById(id) {
  return BY_ID.get(id) ?? null;
}

export function providerIds() {
  return PROVIDERS.map((p) => p.id);
}

/**
 * Hosts a provider's base URL may resolve to.
 *
 * A self-hosted entry has an empty list by design: its host is whatever the
 * user runs, and it is only reachable because the user explicitly marked the
 * credential self-hosted, which is checked separately. It is never reachable
 * by accident.
 */
export function allowedHostsFor(type) {
  const p = BY_ID.get(type);
  return p ? p.allowedHosts : [];
}

export function requiresSelfHosted(type) {
  return BY_ID.get(type)?.requiresSelfHosted === true;
}

export function supportsChat(type) {
  return BY_ID.get(type)?.chat === true;
}

/** Task types a provider's adapter is actually implemented for. */
export function taskTypesFor(type) {
  return BY_ID.get(type)?.taskTypes ?? [];
}

/**
 * Public shape for the settings UI. Contains no secret and no host policy.
 *
 * Booleans are coerced explicitly: `JSON.stringify` drops `undefined`, and a
 * field that is present for one provider and absent for another makes the UI
 * branch on `undefined` instead of on a real value.
 */
export function publicProviders() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    defaultBaseURL: p.defaultBaseURL,
    keyPlaceholder: p.keyPlaceholder,
    docs: p.docs,
    taskTypes: [...p.taskTypes],
    chat: p.chat === true,
    requiresSelfHosted: p.requiresSelfHosted === true,
  }));
}
