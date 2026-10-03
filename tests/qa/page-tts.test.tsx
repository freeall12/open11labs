import { describe, expect, it, beforeEach, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TtsPage } from "@/features/voice/pages";
import { VoicePicker } from "@/features/voice/VoicePicker";

/* ==========================================================================
   QA gap-fill: TTS page behaviour + voice picker states (UI-rewrite edition).

   Coverage target: the only fully implemented generation page at HEAD.
   tests/contract/routing.test.tsx proves each route renders *something*
   with an h1, but no existing test asserts any interactive behaviour:
     - the provider gate: no provider / unverified provider -> generation
       disabled with a reason and a link to local settings
     - the honesty line ("能力未经真实调用核验") lives in the model dialog
       now; there is no global capability notice any more, so the textarea
       mounting is the page's "ready" signal in these tests
     - text-length states per model (over limit vs near limit)
     - per-model parameter gating: 风格夸张 and 说话人增强 are v2.5/v3-only;
       速度 is accepted by every model (the rewrite changed the matrix, the
       assertions below pin the CURRENT one). Unsupported params are dropped
       on submit, asserted end-to-end in the payload test.
     - the unknown-cost acknowledgement actually gating the submit button
     - the submit payload: intent id shape (provider:model:voice plus a
       trailing content digest, so an edit gets a new id), unsupported params
       dropped, and create followed by jobs.run (D-01 regression guard at
       page level); the run's asset is surfaced as a player immediately
     - the ⌘+Enter shortcut submits only a valid, acknowledged form
     - voice selection happens through the 选择音色 modal: `voices.list`
       must return real voice records (voiceId/name required) and clicking
       a row commits it and closes the dialog. There is no manual-ID entry
       in the dialog; that lives in the inline VoicePicker, which keeps its
       own describe block below (including the 手动输入音色 ID details).
     - VoicePicker (inline): needs-provider reason, search filter, selection,
       and the "selected voice vanished" warning that must not auto-substitute

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
    voices: { voices: [], reason: null } as Record<string, unknown>,
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

/** A voice record shaped like the real API returns (previewUrl may be null). */
function makeVoice(over: Record<string, unknown> = {}) {
  return {
    voiceId: "voice_manual_1",
    name: "晓晓",
    category: "premade",
    previewUrl: null,
    labels: { zh: "female" },
    availableForTiers: null,
    unverified: true,
    ...over,
  };
}

const DIALOG_VOICE = makeVoice();

beforeEach(() => {
  // useDraft persists the form across mounts, and the page reads a
  // sessionStorage handoff key: a stale draft would leak between tests.
  // This jsdom build exposes only one of the two stores; clear what exists.
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
  state.providers = [];
  state.voices = { voices: [], reason: null };
  state.created = [];
  state.runCalls = [];
  state.createImpl = null;
});

/** No jest-dom in this workspace: assert the DOM property directly. */
const isDisabled = (el: Element) => (el as HTMLInputElement).disabled;

/** The rewrite dropped the global capability notice; the textarea mounting is the ready signal. */
async function waitForReady() {
  await screen.findByRole("textbox", { name: "主文本区域" });
}

/** Interpolated JSX text spans several text nodes; match the whole body. */
async function expectBodyText(substring: string) {
  await waitFor(() => expect(document.body.textContent).toContain(substring));
}

/** Open the 选择音色 modal and click a voice row; the row click commits and closes. */
async function pickVoiceViaDialog(
  user: ReturnType<typeof userEvent.setup>,
  voice: { name: string },
) {
  await user.click(screen.getByRole("button", { name: "选择音色" }));
  expect(await screen.findByRole("dialog", { name: "选择一个音色" })).toBeTruthy();
  await user.click(await screen.findByRole("radio", { name: new RegExp(voice.name) }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "选择一个音色" })).toBeNull(),
  );
}

/** Open the 选择模型 dialog and pick a model radio; the click commits and closes. */
async function pickModelViaDialog(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
) {
  await user.click(screen.getByRole("button", { name: /选择模型/ }));
  const dialog = await screen.findByRole("dialog", { name: "选择模型" });
  await user.click(within(dialog).getByRole("radio", { name: label }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "选择模型" })).toBeNull());
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

  it("with an unverified provider: state shown, the voice pill is disabled", async () => {
    state.providers = [availableProvider({ validationState: "unverified" })];
    renderPage(<TtsPage />);

    await expectBodyText("当前密钥状态为「unverified」");
    expect(screen.getByText(/Provider 状态为「unverified」，请先在本地设置中验证/)).toBeTruthy();
    // The rail no longer embeds an inline picker: voice choosing goes through
    // the 选择音色 pill, and it must not open for an unvalidated key.
    expect(isDisabled(screen.getByRole("button", { name: "选择音色" }))).toBe(true);
  });

  it("with an available provider: the model dialog carries the honesty line, not capability claims", async () => {
    state.providers = [availableProvider()];
    renderPage(<TtsPage />);
    await waitForReady();

    // The global "capability unverified" notice is gone; the honesty line now
    // ships with every model entry instead of pretending a model is usable.
    await userEvent.setup().click(screen.getByRole("button", { name: /选择模型/ }));
    expect(await screen.findByRole("dialog", { name: "选择模型" })).toBeTruthy();
    expect(screen.getAllByText(/能力未经真实调用核验/).length).toBeGreaterThan(0);
  });
});

describe("TtsPage form validation", () => {
  it("an over-limit text blocks submission and names the model limit", async () => {
    const user = userEvent.setup();
    state.providers = [availableProvider()];
    state.voices = { voices: [DIALOG_VOICE], reason: null };
    renderPage(<TtsPage />);
    await waitForReady();

    // Voice first: the gate reports the first unmet condition in order.
    await pickVoiceViaDialog(user, DIALOG_VOICE);
    // Eleven v3 has the smallest limit (5000) among the models offered.
    await pickModelViaDialog(user, /Eleven v3/);
    // Typing 5001 characters one by one is pointless; replace the value wholesale.
    fireEvent.change(screen.getByRole("textbox", { name: "主文本区域" }), {
      target: { value: "a".repeat(5001) },
    });

    expect(screen.getByText(/超出 Eleven v3 上限：当前 5001 \/ 5000 字符/)).toBeTruthy();
    expect(screen.getByText("文本超出所选模型上限")).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: /生成语音/ }))).toBe(true);
  });

  it("a near-limit text warns but does not block", async () => {
    const user = userEvent.setup();
    state.providers = [availableProvider()];
    renderPage(<TtsPage />);
    await waitForReady();

    await pickModelViaDialog(user, /Eleven v3/);
    fireEvent.change(screen.getByRole("textbox", { name: "主文本区域" }), {
      target: { value: "a".repeat(4800) },
    });
    expect(screen.getByText(/接近上限：4800 \/ 5000 字符/)).toBeTruthy();
    expect(screen.queryByText(/超出/)).toBeNull();
  });

  it("unsupported parameters are disabled for the selected model and dropped on submit", async () => {
    const user = userEvent.setup();
    state.providers = [availableProvider()];
    renderPage(<TtsPage />);
    await waitForReady();

    // Slider order in the rail: 速度, 稳定性, 相似度, 风格夸张.
    // Multilingual v2 accepts speed + stability + similarity; 风格夸张 is
    // v2.5/v3-only.
    let sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(4);
    expect(isDisabled(sliders[0])).toBe(false); // 速度
    expect(isDisabled(sliders[1])).toBe(false); // 稳定性
    expect(isDisabled(sliders[2])).toBe(false); // 相似度
    expect(isDisabled(sliders[3])).toBe(true); // 风格夸张
    expect(screen.getAllByText("当前模型不支持该参数，不会发送。")).toHaveLength(1);

    // 说话人增强 lives in the collapsed 高级设置 block and follows the same matrix.
    await user.click(screen.getByRole("button", { name: "高级设置" }));
    expect(isDisabled(screen.getByRole("switch", { name: "说话人增强" }))).toBe(true);
    expect(screen.getByText("当前模型不支持说话人增强，不会发送。")).toBeTruthy();

    // Switching model re-enables what that model accepts (speed stays enabled
    // for every model in the current matrix).
    await pickModelViaDialog(user, /Eleven Flash v2\.5/);
    expect(isDisabled(screen.getByRole("slider", { name: "风格夸张" }))).toBe(false);
    expect(isDisabled(screen.getByRole("slider", { name: "速度" }))).toBe(false);
    expect(isDisabled(screen.getByRole("switch", { name: "说话人增强" }))).toBe(false);
    expect(screen.queryByText("当前模型不支持该参数，不会发送。")).toBeNull();
  });

  it("a Pro-gated output format blocks submission with a stated reason", async () => {
    const user = userEvent.setup();
    state.providers = [availableProvider()];
    state.voices = { voices: [DIALOG_VOICE], reason: null };
    renderPage(<TtsPage />);
    await waitForReady();

    await pickVoiceViaDialog(user, DIALOG_VOICE);
    await user.click(screen.getByRole("button", { name: "高级设置" }));
    await user.selectOptions(screen.getByLabelText("输出格式"), "pcm_44100");
    expect(screen.getByText(/本地无法确认当前密钥是否具备该格式权限/)).toBeTruthy();
    expect(screen.getByText("当前密钥不具备该输出格式所需权限")).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: /生成语音/ }))).toBe(true);
  });
});

describe("TtsPage submit flow", () => {
  async function fillValidForm() {
    const user = userEvent.setup();
    state.providers = [availableProvider()];
    state.voices = { voices: [DIALOG_VOICE], reason: null };
    renderPage(<TtsPage />);
    await waitForReady();

    await user.type(screen.getByRole("textbox", { name: "主文本区域" }), "  你好，世界  ");
    await pickVoiceViaDialog(user, DIALOG_VOICE);
    await user.click(screen.getByRole("checkbox", { name: /我了解这次提交会产生费用/ }));
    return user;
  }

  it("the acknowledgement checkbox gates the button on its own", async () => {
    const user = userEvent.setup();
    state.providers = [availableProvider()];
    state.voices = { voices: [DIALOG_VOICE], reason: null };
    renderPage(<TtsPage />);
    await waitForReady();

    await user.type(screen.getByRole("textbox", { name: "主文本区域" }), "你好");
    await pickVoiceViaDialog(user, DIALOG_VOICE);
    // Text present -> the button reads 重新生成语音; it stays disabled without
    // the cost acknowledgement either way.
    expect(isDisabled(screen.getByRole("button", { name: /生成语音/ }))).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: /我了解这次提交会产生费用/ }));
    expect(isDisabled(screen.getByRole("button", { name: /生成语音/ }))).toBe(false);
  });

  it("submits one intent with the verbatim text and only supported params, then runs the job", async () => {
    const user = await fillValidForm();
    await user.click(screen.getByRole("button", { name: /生成语音/ }));

    await waitFor(() => expect(state.created).toHaveLength(1));
    const sent = state.created[0];
    // The id carries a trailing content digest so an edit can never silently
    // collapse into the previous job; identical content keeps the same id
    // (the dedup/reuse path is pinned in tests/qa/defect-regression.test.tsx).
    expect(String(sent.intentId)).toMatch(
      /^tts:p1:eleven_multilingual_v2:voice_manual_1:[0-9a-z]+$/,
    );
    expect(sent.type).toBe("text_to_speech");
    expect(sent.modelId).toBe("eleven_multilingual_v2");
    // The draft text is sent verbatim, whitespace included: trimming here
    // would silently edit what the user asked to be read aloud.
    expect((sent.input as Record<string, unknown>).text).toBe("  你好，世界  ");
    const params = (sent.input as Record<string, unknown>).params as Record<string, unknown>;
    expect(params).toEqual({ stability: 0.5, similarity_boost: 0.75, speed: 1 });
    // Multilingual v2 accepts neither style nor speaker boost — they must be
    // dropped, not forwarded to be rejected upstream. (Speed IS accepted by
    // every model in the current matrix, so it stays.)
    expect(params).not.toHaveProperty("style");
    expect(params).not.toHaveProperty("use_speaker_boost");

    // A create is followed by a run: the job must not sit in draft forever
    // (D-01 regression guard at page level). The run's asset is surfaced
    // immediately — a synchronous adapter finishes inside run(), and without
    // this the player would never appear for it.
    await waitFor(() => expect(state.runCalls).toEqual(["job_abcd1234"]));
    expect(await screen.findByText(/任务 succeeded/)).toBeTruthy();
    expect(await screen.findByText("out.mp3")).toBeTruthy();
    expect(screen.getByText("下载音频")).toBeTruthy();
  });

  it("⌘+Enter submits the acknowledged, valid form", async () => {
    const user = await fillValidForm();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "主文本区域" }), {
      key: "Enter",
      metaKey: true,
    });
    await waitFor(() => expect(state.created).toHaveLength(1));
    expect(state.runCalls).toEqual(["job_abcd1234"]);
  });
});

describe("VoicePicker states (inline picker)", () => {
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

  it("manual voice-ID entry stays available under 手动输入音色 ID", async () => {
    const user = userEvent.setup();
    // The input is controlled: the value has to be held somewhere, like the
    // hosting page does, or React resets it to "" on every keystroke.
    const seen: string[] = [];
    function Holder() {
      const [value, setValue] = useState("");
      return <VoicePicker value={value} onChange={(v) => { seen.push(v); setValue(v); }} />;
    }
    state.voices = TWO_VOICES;
    render(<Holder />);
    await screen.findByRole("radio", { name: /Aria/ });

    await user.click(screen.getByText("手动输入音色 ID"));
    await user.type(await screen.findByPlaceholderText("voice_xxxxxxxxxxxx"), "voice_manual_9");
    // One onChange per keystroke with the accumulated value; the last one is
    // the full id the page would commit.
    expect(seen.length).toBe("voice_manual_9".length);
    expect(seen[seen.length - 1]).toBe("voice_manual_9");
  });
});
