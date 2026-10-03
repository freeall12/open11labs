import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TtsPage } from "@/features/voice/pages";
import { VoicePicker } from "@/features/voice/VoicePicker";

/* ==========================================================================
   QA gap-fill: TTS page behaviour + voice picker states.

   Coverage target: the only fully implemented generation page at HEAD.
   tests/contract/routing.test.tsx proves each route renders *something*
   with an h1, but no existing test asserts any interactive behaviour:
     - the provider gate: no provider / unverified provider -> generation
       disabled with a reason and a link to local settings
     - text-length states per model (over limit vs near limit)
     - per-model parameter gating (unsupported sliders disabled and not sent)
     - the unknown-cost acknowledgement actually gating the submit button
     - the submit payload: intent id shape, unsupported params dropped
     - VoicePicker: needs-provider reason, search filter, selection, and the
       "selected voice vanished" warning that must not auto-substitute

   Why the existing tests do not cover this: routing.test.tsx is render-only
   and no other *Page test exists. The @/lib/api module is mocked at the
   module boundary (the client itself is covered over real HTTP by
   tests/integration/client.test.mjs), so these tests are deterministic and
   never touch the network.
   ========================================================================== */

const state = vi.hoisted(() => {
  const makeProvider = (over: Record<string, unknown> = {}) => ({
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
    ...over,
  });
  const makeJob = (over: Record<string, unknown> = {}) => ({
    id: over.id ?? "job_abcd1234",
    intentId: "intent-1",
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
    makeProvider,
    makeJob,
    providers: [] as Record<string, unknown>[],
    voices: { voices: [], reason: null, needsProvider: undefined } as Record<string, unknown>,
    created: [] as Record<string, unknown>[],
    runCalls: [] as string[],
    createImpl: null as null | ((input: Record<string, unknown>) => unknown),
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
    upload: (file: File) =>
      Promise.resolve({
        asset: {
          id: "asset_1",
          url: "/api/v1/assets/asset_1",
          displayName: file.name,
          mediaType: file.type,
          byteSize: file.size,
          origin: "uploaded",
          licenseSource: null,
        },
        created: true,
      }),
    readText: () => Promise.resolve("{}"),
  },
  jobs: {
    list: () => Promise.resolve([]),
    create: (input: Record<string, unknown>) => {
      state.created.push(input);
      if (state.createImpl) return Promise.resolve(state.createImpl(input));
      return Promise.resolve({ job: state.makeJob(), created: true });
    },
    run: (id: string) => {
      state.runCalls.push(id);
      return Promise.resolve({
        job: state.makeJob({ status: "succeeded" }),
        asset: { id: "asset_out", url: "/api/v1/assets/asset_out", displayName: "out.mp3" },
        reason: null,
      });
    },
    cancel: () =>
      Promise.resolve({
        job: state.makeJob({ status: "cancel_requested" }),
        scope: { stops: "本地等待", doesNot: ["退款"] },
      }),
    poll: () =>
      Promise.resolve({
        job: state.makeJob({ status: "running" }),
        asset: null,
        reason: null,
        stillRunning: true,
        remoteSucceeded: false,
      }),
  },
}));

function renderPage(ui: React.ReactElement) {
  return render(<MemoryRouter initialEntries={["/app/tts"]}>{ui}</MemoryRouter>);
}

function availableProvider(over: Record<string, unknown> = {}) {
  return state.makeProvider(over);
}

beforeEach(() => {
  state.providers = [];
  state.voices = { voices: [], reason: null, needsProvider: undefined };
  state.created = [];
  state.runCalls = [];
  state.createImpl = null;
});

const VOICE_OPTION = /手动输入音色 ID/;

/** No jest-dom in this workspace: assert the DOM property directly. */
const isDisabled = (el: Element) => (el as HTMLInputElement).disabled;

async function pickVoiceManually(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByText(VOICE_OPTION));
  await user.type(await screen.findByPlaceholderText("voice_xxxxxxxxxxxx"), id);
}

/** Interpolated JSX text spans several text nodes; match the whole body. */
async function expectBodyText(substring: string) {
  await waitFor(() => expect(document.body.textContent).toContain(substring));
}

describe("TtsPage provider gate", () => {
  it("with no provider: warning with guidance, submit disabled with the reason", async () => {
    renderPage(<TtsPage />);
    expect(await screen.findByText(/尚未配置 Provider。你可以浏览界面/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /去本地设置添加密钥/ }).getAttribute("href"),
    ).toBe("/local/settings/providers");

    const submit = screen.getByRole("button", { name: "生成语音" });
    expect(isDisabled(submit)).toBe(true);
    expect(screen.getByText("尚未配置 Provider")).toBeTruthy();
  });

  it("with an unverified provider: state shown, voice picker disabled", async () => {
    state.providers = [availableProvider({ validationState: "unverified" })];
    renderPage(<TtsPage />);

    await expectBodyText("当前密钥状态为「unverified」");
    expect(screen.getByText(/Provider 状态为「unverified」，请先在本地设置中验证/)).toBeTruthy();
    // The picker must not offer voices for a key that has not been validated.
    expect(isDisabled(screen.getByPlaceholderText(/按名称或 ID 搜索/))).toBe(true);
  });

  it("with an available provider: honesty notice instead of capability claims", async () => {
    state.providers = [availableProvider()];
    renderPage(<TtsPage />);
    expect(await screen.findByText(/能力尚未经过真实 API 核验/)).toBeTruthy();
  });
});

describe("TtsPage form validation", () => {
  it("an over-limit text blocks submission and names the model limit", async () => {
    const user = userEvent.setup();
    state.providers = [availableProvider()];
    renderPage(<TtsPage />);
    await screen.findByText(/能力尚未经过真实 API 核验/);

    // Voice first: the gate reports the first unmet condition in order.
    await pickVoiceManually(user, "voice_limit_1");
    // Eleven v3 has the smallest limit (5000) among the models offered.
    await user.selectOptions(screen.getByLabelText("模型"), "eleven_v3");
    // Typing 5001 characters one by one is pointless; replace the value wholesale.
    fireEvent.change(screen.getByLabelText("文本"), { target: { value: "a".repeat(5001) } });

    expect(screen.getByText(/超出 Eleven v3 上限：当前 5001 \/ 5000 字符/)).toBeTruthy();
    expect(screen.getByText("文本超出所选模型上限")).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: "生成语音" }))).toBe(true);
  });

  it("a near-limit text warns but does not block", async () => {
    state.providers = [availableProvider()];
    renderPage(<TtsPage />);
    await screen.findByText(/能力尚未经过真实 API 核验/);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("模型"), "eleven_v3");
    fireEvent.change(screen.getByLabelText("文本"), { target: { value: "a".repeat(4800) } });
    expect(screen.getByText(/接近上限：4800 \/ 5000 字符/)).toBeTruthy();
    expect(screen.queryByText(/超出/)).toBeNull();
  });

  it("unsupported parameters are disabled for the selected model and dropped on submit", async () => {
    const user = userEvent.setup();
    state.providers = [availableProvider()];
    renderPage(<TtsPage />);
    await screen.findByText(/能力尚未经过真实 API 核验/);

    // Multilingual v2 supports stability + similarity only.
    let sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(4);
    expect(isDisabled(sliders[0])).toBe(false); // 稳定性
    expect(isDisabled(sliders[1])).toBe(false); // 相似度
    expect(isDisabled(sliders[2])).toBe(true); // 风格
    expect(isDisabled(sliders[3])).toBe(true); // 语速
    expect(isDisabled(screen.getByLabelText("说话人增强"))).toBe(true);
    expect(screen.getAllByText("当前模型不支持该参数，不会发送。")).toHaveLength(2);

    // Switching model re-enables what that model accepts.
    await user.selectOptions(screen.getByLabelText("模型"), "eleven_turbo_v2_5");
    sliders = screen.getAllByRole("slider");
    expect(isDisabled(sliders[2])).toBe(false); // 风格
    expect(isDisabled(sliders[3])).toBe(true); // 语速 stays v3/v4-only
    expect(isDisabled(screen.getByLabelText("说话人增强"))).toBe(false);
  });

  it("a Pro-gated output format blocks submission with a stated reason", async () => {
    const user = userEvent.setup();
    state.providers = [availableProvider()];
    renderPage(<TtsPage />);
    await screen.findByText(/能力尚未经过真实 API 核验/);

    await pickVoiceManually(user, "voice_format_1");
    await user.selectOptions(screen.getByLabelText("输出格式"), "pcm_44100");
    expect(screen.getByText(/本地无法确认当前密钥是否具备该格式权限/)).toBeTruthy();
    expect(screen.getByText("当前密钥不具备该输出格式所需权限")).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: "生成语音" }))).toBe(true);
  });
});

describe("TtsPage submit flow", () => {
  async function fillValidForm() {
    const user = userEvent.setup();
    state.providers = [availableProvider()];
    renderPage(<TtsPage />);
    await screen.findByText(/能力尚未经过真实 API 核验/);

    await user.type(screen.getByLabelText("文本"), "  你好，世界  ");
    await pickVoiceManually(user, "voice_manual_1");
    await user.click(screen.getByRole("checkbox", { name: /我了解这次提交会产生费用/ }));
    return user;
  }

  it("the acknowledgement checkbox gates the button on its own", async () => {
    const user = userEvent.setup();
    state.providers = [availableProvider()];
    renderPage(<TtsPage />);
    await screen.findByText(/能力尚未经过真实 API 核验/);

    await user.type(screen.getByLabelText("文本"), "你好");
    await pickVoiceManually(user, "voice_manual_1");
    expect(isDisabled(screen.getByRole("button", { name: "生成语音" }))).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: /我了解这次提交会产生费用/ }));
    expect(isDisabled(screen.getByRole("button", { name: "生成语音" }))).toBe(false);
  });

  it("submits one intent with the trimmed text and only supported params", async () => {
    const user = await fillValidForm();
    await user.click(screen.getByRole("button", { name: "生成语音" }));

    await waitFor(() => expect(state.created).toHaveLength(1));
    const sent = state.created[0];
    expect(sent.intentId).toBe("tts:p1:eleven_multilingual_v2:voice_manual_1");
    expect(sent.type).toBe("text_to_speech");
    expect(sent.modelId).toBe("eleven_multilingual_v2");
    // The draft text is sent verbatim, whitespace included: trimming here
    // would silently edit what the user asked to be read aloud.
    expect((sent.input as Record<string, unknown>).text).toBe("  你好，世界  ");
    const params = (sent.input as Record<string, unknown>).params as Record<string, unknown>;
    expect(params.stability).toBe(0.5);
    expect(params.similarity_boost).toBe(0.75);
    // Multilingual v2 accepts neither style/speed nor speaker boost —
    // they must be dropped, not forwarded to be rejected upstream.
    expect(params).not.toHaveProperty("style");
    expect(params).not.toHaveProperty("speed");
    expect(params).not.toHaveProperty("use_speaker_boost");

    // The job panel appears with the local job, still a draft until run.
    expect(await screen.findByText(/任务 draft/)).toBeTruthy();
  });
});

describe("VoicePicker states", () => {
  const TWO_VOICES = {
    voices: [
      {
        voiceId: "voice_zh_1",
        name: "晓晓",
        category: "premade",
        previewUrl: null,
        labels: { zh: "female" },
        availableForTiers: null,
        unverified: true,
      },
      {
        voiceId: "voice_en_1",
        name: "Aria",
        category: "premade",
        previewUrl: null,
        labels: { en: "female" },
        availableForTiers: null,
        unverified: true,
      },
    ],
    reason: null,
  };

  it("says plainly when no provider is configured", async () => {
    state.voices = { voices: [], reason: "尚未配置 Provider", needsProvider: true };
    render(<VoicePicker value="" onChange={() => {}} />);
    expect(await screen.findByText("尚未配置 Provider，无法读取音色。")).toBeTruthy();
  });

  it("surfaces the provider's failure reason instead of a silent empty grid", async () => {
    state.voices = { voices: [], reason: "API 密钥无效或已失效" };
    render(<VoicePicker value="" onChange={() => {}} />);
    expect(await screen.findByText("API 密钥无效或已失效")).toBeTruthy();
  });

  it("renders voices as a radio group and reports a selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    state.voices = TWO_VOICES;
    render(<VoicePicker value="" onChange={onChange} />);

    const aria = await screen.findByRole("radio", { name: /晓晓/ });
    await user.click(aria);
    expect(onChange).toHaveBeenCalledWith("voice_zh_1");
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("filters by search text across name and id", async () => {
    const user = userEvent.setup();
    state.voices = TWO_VOICES;
    render(<VoicePicker value="" onChange={() => {}} />);
    await screen.findByRole("radio", { name: /Aria/ });

    await user.type(screen.getByPlaceholderText(/按名称或 ID 搜索/), "晓晓");
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /晓晓/ })).toBeTruthy();
  });

  it("an empty filter result gets an explicit empty state", async () => {
    const user = userEvent.setup();
    state.voices = TWO_VOICES;
    render(<VoicePicker value="" onChange={() => {}} />);
    await screen.findByRole("radio", { name: /Aria/ });

    await user.type(screen.getByPlaceholderText(/按名称或 ID 搜索/), "不存在的音色");
    expect(screen.getByText("没有匹配的音色。")).toBeTruthy();
  });

  it("a selected voice that vanished is reported, never auto-substituted", async () => {
    state.voices = TWO_VOICES;
    render(<VoicePicker value="voice_deleted" onChange={() => {}} />);
    expect(await screen.findByText(/不在当前可用列表中/)).toBeTruthy();
    expect(screen.getByText(/voice_deleted/)).toBeTruthy();
    // No other voice may become selected in its place.
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-checked")).toBe("false");
    }
  });
});
