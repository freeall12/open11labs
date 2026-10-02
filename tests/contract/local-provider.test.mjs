import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../server/lib/db.mjs";
import { Vault, assertAllowedBaseURL } from "../../server/lib/vault.mjs";
import { LocalOpenAIAdapter, PROVIDER_ID } from "../../packages/providers/local/openai-compatible.mjs";

/* ==========================================================================
   Self-hosted provider.

   This is the one documented exception to the URL allowlist, so it is also
   the one place most likely to be abused: the allowlist must stay closed by
   default, and opening it must require an explicit opt-in recorded on the
   credential.
   ========================================================================== */

let dir;
let vault;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "open11labs-local-"));
  vault = new Vault();
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/* ------------------------------------------------------------ allowlist -- */

describe("self-hosted opt-in", () => {
  it("still refuses a private address by default", () => {
    expect(() => assertAllowedBaseURL("http://127.0.0.1:11434/v1")).toThrow();
    expect(() => assertAllowedBaseURL("http://localhost:1234/v1")).toThrow();
  });

  it("allows a private address only when explicitly self-hosted", () => {
    expect(() =>
      assertAllowedBaseURL("http://127.0.0.1:11434/v1", { allowPrivate: true }),
    ).not.toThrow();
  });

  it("allows plain http on loopback, because that traffic never leaves the host", () => {
    expect(() =>
      assertAllowedBaseURL("http://127.0.0.1:11434", { allowPrivate: true }),
    ).not.toThrow();
    expect(() =>
      assertAllowedBaseURL("http://localhost:1234/v1", { allowPrivate: true }),
    ).not.toThrow();
  });

  it("still refuses plain http to a public host, self-hosted flag or not", () => {
    // This is the line that matters: a "self-hosted" claim must not become a
    // way to ship a credential in cleartext to a remote server.
    expect(() =>
      assertAllowedBaseURL("http://example.com", { allowPrivate: true }),
    ).toThrow(/https/);
    expect(() => assertAllowedBaseURL("http://example.com")).toThrow(/https/);
  });

  it("still refuses an unregistered private host over https", () => {
    // 10.x is reachable with the flag, but 192.0.2.x here is not in the
    // self-hosted set, so the host allowlist still applies.
    expect(() =>
      assertAllowedBaseURL("https://198.51.100.7", { allowPrivate: true }),
    ).toThrow(/not registered/);
  });

  it("records the self-hosted flag on the credential", () => {
    const rec = vault.put({
      type: PROVIDER_ID,
      baseURL: "http://127.0.0.1:11434",
      secret: "unused",
      selfHosted: true,
    });
    expect(rec.selfHosted).toBe(true);
  });

  it("marks a normal hosted credential as not self-hosted", () => {
    const rec = vault.put({
      type: "elevenlabs",
      baseURL: "https://api.elevenlabs.io",
      secret: "sk-x",
    });
    expect(rec.selfHosted).toBe(false);
  });
});

/* -------------------------------------------------------------- adapter -- */

function adapterWith(impl, opts = {}) {
  return new LocalOpenAIAdapter({
    baseURL: "http://127.0.0.1:11434",
    fetchImpl: impl,
    ...opts,
  });
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("local adapter", () => {
  it("validates with a read-only model listing", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "qwen" }] }));
    const out = await adapterWith(impl).validateCredential();

    expect(out.ok).toBe(true);
    expect(out.modelCount).toBe(1);
    expect(out.local).toBe(true);
    expect(impl.mock.calls[0][0]).toBe("http://127.0.0.1:11434/v1/models");
  });

  it("reports an unreachable server as a network error, not a bad key", async () => {
    const impl = vi.fn().mockRejectedValue(Object.assign(new Error("refused"), { name: "Error" }));
    await expect(adapterWith(impl).validateCredential()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("sends no authorization header when no key is configured", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    await adapterWith(impl).validateCredential();
    expect(impl.mock.calls[0][1].headers.authorization).toBeUndefined();
  });

  it("sends a bearer token when one is configured", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    await adapterWith(impl, { apiKey: "sk-local" }).validateCredential();
    expect(impl.mock.calls[0][1].headers.authorization).toBe("Bearer sk-local");
  });

  it("maps a missing route to CAPABILITY_UNAVAILABLE, not a generic failure", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    await expect(
      adapterWith(impl).submit({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });

  it("treats an empty completion as a failure", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: "" } }] }));
    await expect(
      adapterWith(impl).submit({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
  });

  it("returns the reply as a text artifact", async () => {
    const impl = vi.fn().mockResolvedValue(
      jsonResponse({ id: "cmpl_1", choices: [{ message: { content: "你好" } }] }),
    );
    const out = await adapterWith(impl).submit({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.artifact.contentType).toMatch(/text\/plain/);
    expect(new TextDecoder().decode(out.artifact.bytes)).toBe("你好");
    expect(out.providerRequestId).toBe("cmpl_1");
  });

  it("never claims a local model matches a hosted one", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "qwen" }] }));
    const [cap] = await adapterWith(impl).listCapabilities();
    expect(cap.availability).toBe("unverified");
    expect(cap.reason).toContain("不等同");
  });

  it("reports unavailable when the server lists no models", async () => {
    const impl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const [cap] = await adapterWith(impl).listCapabilities();
    expect(cap.availability).toBe("unavailable");
  });

  it("states that a local call has no per-call price, with a reason", () => {
    const u = adapterWith(vi.fn()).estimateCost({ jobId: "j1" });
    expect(u.state).toBe("estimated");
    expect(u.amount).toBe(0);
    // Zero is stated with a source, never a bare 0.
    expect(u.source).toBeTruthy();
    expect(u.unit).toBe("api_calls");
  });

  it("has no cancel or status polling, and says so", async () => {
    const a = adapterWith(vi.fn());
    await expect(a.cancel()).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
    await expect(a.getStatus?.() ?? a.pollStatus()).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
    });
  });
});
