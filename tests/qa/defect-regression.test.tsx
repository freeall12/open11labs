import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TtsPage } from "@/features/voice/pages";
import { LocalOpenAIAdapter } from "../../packages/providers/local/openai-compatible.mjs";

/* ==========================================================================
   Defect regression markers (polarity-inverted).

   These encode the two P1 defects found in the 2026-10-03 baseline QA round
   (docs/qa/2026-10-03-baseline-browser.md). vitest 3 has no `test.failing`,
   so each test asserts the CURRENT defective behaviour with a ⚠️ FLIP WHEN
   FIXED marker. When the FEATURE track lands the fix, the assertion here
   fails on purpose — that is the signal to flip the polarity so the fix is
   pinned forever (a plain skip would let the defect come back unnoticed).

   D-01  TtsPage submits a job but never calls jobs.run, so every TTS job
         stays in `draft` forever (every other tool page calls run).
   D-02  The local OpenAI-compatible adapter has no TTS entry point at all;
         the runner dispatches text_to_speech to the chat-only submit(), so
         a mock /v1/audio/speech is never called and a text "reply" is
         recorded as a successful audio artifact (wrong-shaped success).
   ========================================================================== */

const state = vi.hoisted(() => ({
  providers: [] as Record<string, unknown>[],
  created: [] as Record<string, unknown>[],
  runCalls: [] as string[],
}));

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
    list: () => Promise.resolve({ voices: [], reason: null, needsProvider: undefined }),
  },
  assets: {
    list: () => Promise.resolve({ assets: [], usage: { totalBytes: 0, count: 0 } }),
  },
  jobs: {
    list: () => Promise.resolve([]),
    create: (input: Record<string, unknown>) => {
      state.created.push(input);
      return Promise.resolve({
        job: {
          id: "job_d001",
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
        },
        created: true,
      });
    },
    run: (id: string) => {
      state.runCalls.push(id);
      return Promise.resolve({
        job: { id, status: "succeeded" },
        asset: { id: "asset_out", url: "/api/v1/assets/asset_out", displayName: "out.mp3" },
        reason: null,
      });
    },
    cancel: () => Promise.resolve({ job: { status: "cancel_requested" }, scope: {} }),
  },
}));

beforeEach(() => {
  state.providers = [];
  state.created = [];
  state.runCalls = [];
});

describe("defect regression markers", () => {
  it("D-01 TtsPage: create is never followed by jobs.run (⚠️ FLIP WHEN FIXED)", async () => {
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
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/app/tts"]}>
        <TtsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/能力尚未经过真实 API 核验/);

    await user.type(screen.getByLabelText("文本"), "你好，世界");
    await user.click(screen.getByText(/手动输入音色 ID/));
    await user.type(await screen.findByPlaceholderText("voice_xxxxxxxxxxxx"), "voice_d001");
    await user.click(screen.getByRole("checkbox", { name: /我了解这次提交会产生费用/ }));
    await user.click(screen.getByRole("button", { name: "生成语音" }));

    await waitFor(() => expect(state.created).toHaveLength(1));
    // DEFECT PRESENT (D-01): create happened, run never did — the job stays
    // `draft` forever. ⚠️ FLIP WHEN FIXED: expect(["job_d001"]).
    expect(state.runCalls).toEqual([]);
  });

  it("D-02 local adapter: no TTS entry point, /v1/audio/speech unreachable (⚠️ FLIP WHEN FIXED)", () => {
    const adapter = new LocalOpenAIAdapter({
      baseURL: "http://127.0.0.1:5190/v1",
      apiKey: "sk-local-fixture",
    });

    const submitTts = (adapter as unknown as Record<string, unknown>)
      .submitTextToSpeech;
    // DEFECT PRESENT (D-02): the adapter only has the chat submit(), so the
    // runner records a text "reply" as a successful audio artifact.
    // ⚠️ FLIP WHEN FIXED: expect a function that POSTs to /v1/audio/speech
    // (assert the endpoint with a fetchImpl stub, see
    // tests/qa/local-provider-branches.test.mjs for the stub pattern).
    expect(submitTts).toBeUndefined();
  });
});
