import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TtsPage } from "@/features/voice/pages";
import { LocalOpenAIAdapter } from "../../packages/providers/local/openai-compatible.mjs";

/* ==========================================================================
   Defect regression markers (from the 2026-10-03 baseline QA round,
   docs/qa/2026-10-03-baseline-browser.md).

   Both P1 defects were FIXED on 2026-10-03 (ZCode); the tests below pin the
   fixed behaviour forever — if either fails, the fix regressed.

   D-01  FIXED: TtsPage.generate() dispatches jobs.run right after a *fresh*
         create; on a dedup hit (created=false) it shows "已复用对应任务"
         and deliberately does NOT run again (a second run would bill twice).

   D-02  FIXED: the local OpenAI-compatible adapter now exposes
         submitTextToSpeech, which POSTs to /v1/audio/speech and returns raw
         audio bytes as the artifact — the runner no longer falls back to the
         chat-only submit() that recorded a text "reply" as a successful
         audio artifact.
   ========================================================================== */

const state = vi.hoisted(() => {
  const makeJob = (over: Record<string, unknown> = {}) => ({
    id: over.id ?? "job_d001",
    intentId: "intent-d001",
    type: "text_to_speech",
    providerId: "p1",
    modelId: null,
    status: "draft",
    revision: 1,
    requestId: null,
    outputAssetIds: [],
    error: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  });
  return {
    makeJob,
    providers: [] as Record<string, unknown>[],
    voices: { voices: [], reason: null } as Record<string, unknown>,
    created: [] as Record<string, unknown>[],
    runCalls: [] as string[],
  };
});

vi.mock("@/lib/api", () => ({
  ApiError: class MockApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  },
  providers: {
    list: () => Promise.resolve(state.providers),
  },
  voices: {
    list: () => Promise.resolve(state.voices),
  },
  assets: {
    list: () => Promise.resolve({ assets: [], usage: { totalBytes: 0, count: 0 } }),
  },
  jobs: {
    list: () => Promise.resolve([]),
    create: (input: Record<string, unknown>) => {
      // First attempt of a test = fresh create; any later identical intent is
      // the server-side dedup path (created=false).
      const fresh = state.created.length === 0;
      state.created.push(input);
      return Promise.resolve({ job: state.makeJob(), created: fresh });
    },
    run: (id: string) => {
      state.runCalls.push(id);
      return Promise.resolve({
        job: state.makeJob({ id, status: "succeeded" }),
        asset: { id: "asset_out", url: "/api/v1/assets/asset_out", displayName: "out.mp3" },
        reason: null,
      });
    },
    cancel: () => Promise.resolve({ job: { status: "cancel_requested" }, scope: {} }),
  },
}));

beforeEach(() => {
  // Draft/handoff state must not leak between tests; this jsdom build
  // exposes only one of the two stores, so clear what exists.
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
  state.providers = [];
  state.voices = { voices: [], reason: null };
  state.created = [];
  state.runCalls = [];
});

describe("defect regression markers", () => {
  it("D-01 FIXED (2026-10-03, ZCode): TtsPage runs after create, and dedup never re-runs", async () => {
    state.providers = [
      {
        id: "p1",
        type: "elevenlabs",
        displayName: "测试密钥",
        baseURL: "https://api.elevenlabs.io",
        maskedSecret: "sk-1••••6789",
        validationState: "available",
        validatedAt: "2026-01-01T00:00:00Z",
        lastError: null,
        createdAt: "2026-01-01T00:00:00Z",
        rotatedAt: null,
      },
    ];
    state.voices = {
      voices: [
        {
          voiceId: "voice_d001",
          name: "测试音",
          category: "premade",
          previewUrl: null,
          labels: { zh: "female" },
          availableForTiers: null,
          unverified: true,
        },
      ],
      reason: null,
    };
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/app/tts"]}>
        <TtsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("textbox", { name: "主文本区域" });

    await user.type(screen.getByRole("textbox", { name: "主文本区域" }), "你好，世界");
    await user.click(screen.getByRole("button", { name: "选择音色" }));
    await user.click(await screen.findByRole("radio", { name: /测试音/ }));
    await user.click(screen.getByRole("checkbox", { name: /我了解这次提交会产生费用/ }));
    await user.click(screen.getByRole("button", { name: /生成语音/ }));

    await waitFor(() => expect(state.created).toHaveLength(1));
    // FIXED: a fresh create MUST be followed by exactly one jobs.run with the
    // created job's id — a job left in `draft` forever was the original D-01.
    expect(state.runCalls).toEqual(["job_d001"]);

    // The same intent submitted again must hit the dedup path: create returns
    // created=false, the page says so, and it must NOT run a second time.
    await user.click(screen.getByRole("button", { name: /生成语音/ }));
    await waitFor(() => expect(state.created).toHaveLength(2));
    expect(screen.getByText(/已复用对应任务/)).toBeTruthy();
    expect(state.runCalls).toEqual(["job_d001"]);
  });

  it("D-02 FIXED (2026-10-03, ZCode): adapter POSTs /v1/audio/speech and returns an audio artifact", async () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x08, 0x00, 0x00]); // "RIFF"…
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    const adapter = new LocalOpenAIAdapter({
      // baseURL carries no /v1: the adapter appends the route itself.
      baseURL: "http://127.0.0.1:5190",
      apiKey: "sk-local-fixture",
      fetchImpl: async (url: string | URL, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: String(init?.method),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(wav, {
          status: 200,
          headers: { "content-type": "audio/wav" },
        });
      },
    });
    // Fetch stays stubbed, so nothing here touches the network.
    expect(calls).toHaveLength(0);

    const res = await adapter.submitTextToSpeech({
      text: "你好，本地",
      modelId: "tts-1",
      voiceId: "alloy",
      outputFormat: "wav",
    });

    // The speech endpoint is hit exactly once, with the OpenAI speech shape.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:5190/v1/audio/speech");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({
      model: "tts-1",
      input: "你好，本地",
      voice: "alloy",
      response_format: "wav",
    });
    // The artifact is audio, not a text "reply" (the original D-02 symptom).
    expect(typeof res.artifact.bytes).toBe("object");
    expect(res.artifact.bytes.byteLength).toBe(wav.byteLength);
    expect(res.artifact.contentType.startsWith("audio/")).toBe(true);
    expect(res.artifact.suggestedName).toBe("speech.wav");
  });
});
