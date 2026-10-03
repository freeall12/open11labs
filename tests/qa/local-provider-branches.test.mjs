import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalOpenAIAdapter,
  PROVIDER_ID,
} from "../../packages/providers/local/openai-compatible.mjs";

/* ==========================================================================
   QA gap-fill: local (self-hosted OpenAI-compatible) adapter branches.

   Coverage target: the failure and formatting branches of
   packages/providers/local/openai-compatible.mjs that
   tests/contract/local-provider.test.mjs does not exercise:
     - submit/validate with no baseURL (VALIDATION_ERROR before any request)
     - 401/403 mapped to PROVIDER_AUTH_FAILED (key hint, not retryable)
     - 5xx mapped to PROVIDER_REJECTED with retryable:true and unknown
       submission certainty; 4xx with retryable:false
     - an aborted request (timeout) mapped to a non-retryable NETWORK_ERROR
       with the "model may be loading" wording
     - validateCredential on a non-2xx /v1/models, on malformed JSON, and on
       a non-array `data` field
     - the request body contract (model default, temperature, stream:false,
       max_tokens only when provided)
     - fetchArtifact success / missing content-type / failure
     - normalizeError's 404 vs other-status mapping
     - trailing-slash normalization of baseURL

   Why the existing tests do not cover this: local-provider.test.mjs only
   drives the happy paths (models listing, 200 completion, empty completion,
   404-on-submit, cost/cancel/capability honesty). The error-mapping matrix
   and the abort path are the branches a self-hosted server actually hits in
   practice (model loading, wrong port, proxy auth), and they decide whether
   the UI may offer a retry — so they are asserted here, against a mocked
   fetchImpl only. No network is touched: every baseURL is 127.0.0.1 and
   every response comes from a stub.
   ========================================================================== */

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

const CHAT = { messages: [{ role: "user", content: "你好" }] };

describe("request plumbing", () => {
  it("strips trailing slashes from baseURL so the path is not doubled", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434/", fetchImpl: impl });
    await a.validateCredential();
    expect(impl.mock.calls[0][0]).toBe("http://127.0.0.1:11434/v1/models");
  });

  it("refuses to send when baseURL was never configured, before any request", async () => {
    const impl = vi.fn();
    const a = new LocalOpenAIAdapter({ baseURL: "", fetchImpl: impl });

    await expect(a.submit(CHAT)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      safeMessage: "本地 Provider 未配置 baseURL",
      submissionCertainty: "not_submitted",
    });
    expect(impl).not.toHaveBeenCalled();
  });

  it("sends the OpenAI chat contract: local model, temperature, stream:false", async () => {
    const impl = vi.fn().mockResolvedValue(
      jsonResponse({ id: "cmpl_x", choices: [{ message: { content: "ok" } }] }),
    );
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });
    await a.submit({ ...CHAT, maxTokens: 128 });

    const [url, init] = impl.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("local");
    expect(body.temperature).toBe(0.7);
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(128);
  });

  it("omits max_tokens when the caller did not set it", async () => {
    const impl = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "ok" } }] }),
    );
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });
    await a.submit(CHAT);
    const body = JSON.parse(impl.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("leaves providerRequestId null when the body carries no id", async () => {
    const impl = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "ok" } }] }),
    );
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });
    const out = await a.submit(CHAT);
    expect(out.providerRequestId).toBeNull();
  });
});

describe("submit error mapping", () => {
  it("maps 401 to PROVIDER_AUTH_FAILED and blames the optional key", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 401));
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });

    await expect(a.submit(CHAT)).rejects.toMatchObject({
      code: "PROVIDER_AUTH_FAILED",
      retryable: false,
      submissionCertainty: "not_submitted",
    });
    await expect(a.submit(CHAT)).rejects.toMatchObject({
      safeMessage: expect.stringContaining("留空"),
    });
  });

  it("maps 403 the same way as 401", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({}, 403));
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });
    await expect(a.submit(CHAT)).rejects.toMatchObject({ code: "PROVIDER_AUTH_FAILED" });
  });

  it("a 500 is possibly-accepted: retryable provider rejection with unknown certainty", async () => {
    const impl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "gpu oom" }, 500));
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });

    await expect(a.submit(CHAT)).rejects.toMatchObject({
      code: "PROVIDER_REJECTED",
      retryable: true,
      submissionCertainty: "unknown",
    });
    // The safe message carries the status and a truncated body, so the user
    // can see what their own server said without leaking anything else.
    await expect(a.submit(CHAT)).rejects.toMatchObject({
      safeMessage: expect.stringContaining("HTTP 500"),
    });
  });

  it("a 400 is a clean rejection: not retryable", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({ error: "bad shape" }, 400));
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });
    await expect(a.submit(CHAT)).rejects.toMatchObject({
      code: "PROVIDER_REJECTED",
      retryable: false,
    });
  });

  it("an aborted request is a timeout: NETWORK_ERROR that must not auto-retry", async () => {
    const impl = (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    const a = new LocalOpenAIAdapter({
      baseURL: "http://127.0.0.1:11434",
      fetchImpl: impl,
      timeoutMs: 20,
    });

    await expect(a.submit(CHAT)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      safeMessage: expect.stringContaining("超时"),
      // The request may have landed on the model server; never auto-retry.
      retryable: false,
      submissionCertainty: "unknown",
    });
  });
});

describe("validateCredential branches", () => {
  it("a non-2xx /v1/models is an auth-style failure, not a network error", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });

    await expect(a.validateCredential()).rejects.toMatchObject({
      code: "PROVIDER_AUTH_FAILED",
      safeMessage: expect.stringContaining("HTTP 503"),
      retryable: false,
      submissionCertainty: "not_submitted",
    });
  });

  it("malformed JSON is tolerated as an empty listing, never a crash", async () => {
    const impl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError("not json");
      },
      text: async () => "<html>not json</html>",
    });
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });
    const out = await a.validateCredential();
    expect(out.ok).toBe(true);
    expect(out.modelCount).toBe(0);
  });

  it("a non-array data field counts as zero models, not one", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "weird" } }));
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });
    const out = await a.validateCredential();
    expect(out.modelCount).toBe(0);
  });
});

describe("fetchArtifact", () => {
  it("returns the bytes and the served content type", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const impl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "audio/wav" }),
      arrayBuffer: async () => payload.buffer,
    });
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });

    const out = await a.fetchArtifact({ url: "http://127.0.0.1:11434/file" });
    expect(impl.mock.calls[0][0]).toBe("http://127.0.0.1:11434/file");
    expect(out.bytes).toEqual(payload);
    expect(out.contentType).toBe("audio/wav");
  });

  it("falls back to application/octet-stream when no content-type is sent", async () => {
    const impl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(2),
    });
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });
    const out = await a.fetchArtifact({ url: "http://127.0.0.1:11434/file" });
    expect(out.contentType).toBe("application/octet-stream");
  });

  it("a failed download is retryable and does not claim the generation failed", async () => {
    const impl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: impl });
    await expect(a.fetchArtifact({ url: "http://127.0.0.1:11434/file" })).rejects.toMatchObject({
      code: "PROVIDER_REJECTED",
      retryable: true,
      submissionCertainty: "accepted",
    });
  });
});

describe("normalizeError", () => {
  it("maps a raw 404 to CAPABILITY_UNAVAILABLE", async () => {
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: vi.fn() });
    const err = await a.normalizeError({ status: 404 });
    expect(err.code).toBe("CAPABILITY_UNAVAILABLE");
    expect(err.submissionCertainty).toBe("not_submitted");
  });

  it("maps any other raw status to PROVIDER_REJECTED with the status number", async () => {
    const a = new LocalOpenAIAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: vi.fn() });
    const err = await a.normalizeError({ status: 502 });
    expect(err.code).toBe("PROVIDER_REJECTED");
    expect(err.safeMessage).toContain("502");
  });

  it("keeps the documented provider id", () => {
    expect(PROVIDER_ID).toBe("openai-local");
  });
});
