import { describe, expect, it, vi } from "vitest";

import { ElevenLabsAdapter, PROVIDER_ID } from "../../packages/providers/elevenlabs/adapter.mjs";
import {
  errorBodies,
  modelsResponse,
  modelsResponseUnexpectedShape,
  ttsAudioBytes,
  ttsSuccessHeaders,
} from "../../packages/providers/elevenlabs/fixtures.mjs";
import {
  assertCapability,
  assertUsageEntry,
  capability,
  normalizedError,
  retryDecision,
  usageEntry,
} from "../../packages/contracts/src/index.mjs";

/* ==========================================================================
   M1-T04 contract tests.

   Everything here runs against a stub fetch. No credential, no quota, no
   network. A test that passed by calling the real API would not be
   reproducible, so none of these do.
   ========================================================================== */

const KEY = "sk_test_fixture_key_not_real";

/** Stub fetch returning one canned response, and recording the call. */
function stub({ status = 200, body = {}, headers = {}, binary } = {}) {
  const calls = [];
  const impl = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const h = new Headers(headers);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `status ${status}`,
      headers: h,
      json: async () => body,
      text: async () => JSON.stringify(body),
      arrayBuffer: async () => (binary ?? ttsAudioBytes).buffer,
    };
  });
  return { impl, calls };
}

function adapterWith(fake) {
  return new ElevenLabsAdapter({
    baseURL: "https://api.elevenlabs.io",
    fetchImpl: fake.impl,
  });
}

describe("validateCredential", () => {
  it("uses the free capability endpoint, not a generation call", async () => {
    const fake = stub({ body: modelsResponse });
    await adapterWith(fake).validateCredential(KEY);

    expect(fake.calls).toHaveLength(1);
    const { url, init } = fake.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/models");
    expect(init.method).toBe("GET");
    // No body means nothing was generated and nothing was billed.
    expect(init.body).toBeUndefined();
  });

  it("sends the key as xi-api-key and never in the URL", async () => {
    const fake = stub({ body: modelsResponse });
    await adapterWith(fake).validateCredential(KEY);

    const { url, init } = fake.calls[0];
    expect(init.headers["xi-api-key"]).toBe(KEY);
    expect(url).not.toContain(KEY);
  });

  it("maps a 401 to PROVIDER_AUTH_FAILED and marks it not retryable", async () => {
    const fake = stub(errorBodies.unauthorized);
    await expect(adapterWith(fake).validateCredential(KEY)).rejects.toMatchObject({
      code: "PROVIDER_AUTH_FAILED",
      retryable: false,
      submissionCertainty: "not_submitted",
    });
  });

  it("distinguishes a 403 as insufficient scope, not a bad key", async () => {
    const fake = stub(errorBodies.forbidden);
    await expect(adapterWith(fake).validateCredential(KEY)).rejects.toMatchObject({
      code: "PROVIDER_AUTH_FAILED",
      safeMessage: expect.stringContaining("权限"),
    });
  });

  it("keeps the raw provider body out of the safe message", async () => {
    const fake = stub({
      ...errorBodies.unauthorized,
      body: { detail: { message: "Invalid API key sk_leaked_in_body_123" } },
    });
    const err = await adapterWith(fake)
      .validateCredential(KEY)
      .catch((e) => e);
    expect(err.safeMessage).not.toContain("sk_leaked_in_body_123");
  });
});

describe("error normalisation", () => {
  it("429 keeps Retry-After and is retryable", async () => {
    const fake = stub({ ...errorBodies.rateLimited, headers: errorBodies.rateLimited.headers });
    const err = await adapterWith(fake)
      .validateCredential(KEY)
      .catch((e) => e);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryable).toBe(true);
    expect(err.fieldErrors.retryAfter).toBe("7");
  });

  it("a 5xx is retryable but submission certainty is unknown", async () => {
    const fake = stub(errorBodies.serverError);
    const err = await adapterWith(fake)
      .validateCredential(KEY)
      .catch((e) => e);
    expect(err.code).toBe("PROVIDER_REJECTED");
    expect(err.retryable).toBe(true);
    expect(err.submissionCertainty).toBe("unknown");
  });

  it("a network timeout is an unknown submission, not a clean failure", async () => {
    const impl = vi.fn(async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    const err = await adapterWith({ impl })
      .validateCredential(KEY)
      .catch((e) => e);
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.submissionCertainty).toBe("unknown");
  });
});

describe("capabilities are never claimed as available without a real run", () => {
  it("maps a known payload to unverified capabilities", async () => {
    const fake = stub({ body: modelsResponse });
    const caps = await adapterWith(fake).listCapabilities(KEY);

    expect(caps.length).toBe(4);
    for (const c of caps) {
      expect(c.availability).toBe("unverified");
      expect(c.reason).toBeTruthy();
      expect(c.providerId).toBe(PROVIDER_ID);
    }
  });

  it("uses the API model id, never the display name", async () => {
    const fake = stub({ body: modelsResponse });
    const caps = await adapterWith(fake).listCapabilities(KEY);
    const tts = caps.find((c) => c.modelId === "eleven_multilingual_v2");
    expect(tts).toBeDefined();
    expect(tts.displayName).toBe("Multilingual v2");
  });

  it("refuses to guess when the payload shape is not understood", async () => {
    const fake = stub({ body: modelsResponseUnexpectedShape });
    const caps = await adapterWith(fake).listCapabilities(KEY);
    expect(caps).toHaveLength(1);
    expect(caps[0].availability).toBe("unverified");
    expect(caps[0].reason).toContain("结构");
  });

  it("does not claim streaming, cancel or idempotency support", async () => {
    const fake = stub({ body: modelsResponse });
    const caps = await adapterWith(fake).listCapabilities(KEY);
    for (const c of caps) {
      expect(c.supportsStreaming).toBe(false);
      expect(c.supportsCancel).toBe(false);
      expect(c.supportsIdempotency).toBe(false);
    }
  });
});

describe("text to speech submission", () => {
  it("posts to the documented endpoint and returns bytes", async () => {
    const fake = stub({ status: 200, headers: ttsSuccessHeaders, binary: ttsAudioBytes });
    const out = await adapterWith(fake).submit({
      key: KEY,
      voiceId: "voice_synthetic_1",
      text: "你好",
    });

    const { url, init } = fake.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice_synthetic_1");
    expect(init.method).toBe("POST");
    expect(out.artifact.bytes).toEqual(ttsAudioBytes);
    expect(out.providerRequestId).toBe("req_synthetic_0001");
    // Metering signal kept, never converted to money.
    expect(out.characterCost).toBe("142");
  });

  it("rejects empty input before touching the network", async () => {
    const fake = stub({});
    await expect(
      adapterWith(fake).submit({ key: KEY, voiceId: "v", text: "   " }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fake.calls).toHaveLength(0);
  });

  it("requires a voice id", async () => {
    const fake = stub({});
    await expect(
      adapterWith(fake).submit({ key: KEY, text: "hi" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("unsupported remote capabilities report honestly", () => {
  it("cancel says the provider has no cancel API", async () => {
    await expect(adapterWith(stub({})).cancel()).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
    });
    const err = await adapterWith(stub({})).cancel().catch((e) => e);
    expect(err.safeMessage).toContain("本地");
  });

  it("getStatus is unsupported for a synchronous call", async () => {
    await expect(adapterWith(stub({})).getStatus()).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
    });
  });

  it("getArtifact is unreachable because submit already returned the bytes", async () => {
    await expect(adapterWith(stub({})).getArtifact()).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
    });
  });
});

describe("cost is unknown until a price is verified", () => {
  it("estimateCost returns unknown with a null amount, never 0", () => {
    const u = new ElevenLabsAdapter().estimateCost({ jobId: "job_1" });
    expect(u.state).toBe("unknown");
    expect(u.amount).toBeNull();
    expect(u).not.toMatchObject({ amount: 0 });
    assertUsageEntry(u);
  });

  it("a known state may carry a number", () => {
    const u = usageEntry({
      jobId: "j",
      providerId: PROVIDER_ID,
      state: "reported",
      amount: 0.02,
      unit: "characters",
      currency: "USD",
      source: "character-cost header",
    });
    assertUsageEntry(u);
    expect(u.amount).toBe(0.02);
  });
});

describe("retry safety", () => {
  it("an unknown submission must not be retried", () => {
    const d = retryDecision({
      status: "unknown_submission",
      error: normalizedError({
        code: "NETWORK_ERROR",
        safeMessage: "timeout",
        submissionCertainty: "unknown",
      }),
    });
    expect(d.safe).toBe(false);
  });

  it("an accepted request that failed afterwards must not be retried", () => {
    const d = retryDecision({
      status: "failed",
      error: normalizedError({
        code: "PROVIDER_REJECTED",
        safeMessage: "x",
        retryable: true,
        submissionCertainty: "accepted",
      }),
    });
    expect(d.safe).toBe(false);
    expect(d.why).toContain("重复计费");
  });

  it("a rate limit that was definitely not accepted may be retried", () => {
    const d = retryDecision({
      status: "failed",
      error: normalizedError({
        code: "RATE_LIMITED",
        safeMessage: "slow down",
        retryable: true,
        submissionCertainty: "not_submitted",
      }),
    });
    expect(d.safe).toBe(true);
  });

  it("an auth failure is never retried", () => {
    const d = retryDecision({
      status: "failed",
      error: normalizedError({
        code: "PROVIDER_AUTH_FAILED",
        safeMessage: "bad key",
      }),
    });
    expect(d.safe).toBe(false);
  });
});

describe("contract guards", () => {
  it("rejects an unverified capability that carries no reason", () => {
    expect(() =>
      assertCapability({
        providerId: "p",
        modelId: "m",
        taskType: "text_to_speech",
        availability: "unverified",
        reason: "",
      }),
    ).toThrow(/reason/);
  });

  it("rejects an unknown availability value", () => {
    expect(() =>
      assertCapability({
        providerId: "p",
        modelId: "m",
        taskType: "text_to_speech",
        availability: "probably",
      }),
    ).toThrow(/availability/);
  });

  it("the constructor defaults a missing reason rather than leaving it blank", () => {
    const c = capability({
      providerId: "p",
      modelId: "m",
      taskType: "text_to_speech",
      availability: "unavailable",
    });
    expect(c.reason).toBeTruthy();
  });

  it("rejects a numeric amount on an unknown cost", () => {
    expect(() =>
      assertUsageEntry({ jobId: "j", providerId: "p", state: "unknown", amount: 0 }),
    ).toThrow(/must not carry a numeric amount/);
  });
});


