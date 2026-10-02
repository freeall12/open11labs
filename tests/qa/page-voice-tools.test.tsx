import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { StsPage, IsolatorPage, DubbingPage, SttYoutubePage } from "@/features/voice/pages";

/* ==========================================================================
   QA gap-fill: voice tool pages — STS queue, isolator, dubbing, YouTube STT.

   Coverage target: the implemented page *behaviours* that no existing test
   asserts (routing.test.tsx only proves an h1 renders per route):
     - StsPage: audio-only queue (non-audio rejected with the file named),
       the 50MB observed-web-limit rejection, queue empty state, the blocked
       chain, the upload->create->run submit flow, and the dedupe reuse path
     - IsolatorPage: non-audio refusal, per-tool doc-observed limit wording,
       source/result comparison rendering, dedupe reuse
     - DubbingPage: file->language blocked chain, unverified language-count
       honesty notice, no v1 editor statement, submit payload
     - SttYoutubePage: yt-dlp availability gate (from /api/v1/tools), the
       double acknowledgement (rights AND unknown cost) gating the button,
       trimmed-URL intent, transcript rendering

   Why the existing tests do not cover this: there are no other page-behaviour
   tests. @/lib/api is mocked at the module boundary (its real behaviour is
   covered over HTTP by tests/integration/client.test.mjs), so nothing leaves
   the machine and no provider is billed. These pages are implemented at HEAD;
   Studio/Flows/Chat/music/voice-library are still in flight and deliberately
   not tested here.
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
    uploads: [] as File[],
    created: [] as Record<string, unknown>[],
    runCalls: [] as string[],
    cancelCalls: [] as string[],
    createImpl: null as null | ((input: Record<string, unknown>) => unknown),
    runImpl: null as null | ((id: string) => unknown),
    transcriptText: '{"text":"你好世界"}',
    tools: null as null | Record<string, unknown>[],
  };
});

vi.mock("@/lib/api", () => ({
  ApiError: class MockApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  providers: { list: () => Promise.resolve(state.providers) },
  voices: { list: () => Promise.resolve({ voices: [], reason: null }) },
  assets: {
    list: () => Promise.resolve({ assets: [], usage: { totalBytes: 0, count: 0 } }),
    upload: (file: File) => {
      state.uploads.push(file);
      return Promise.resolve({
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
      });
    },
    readText: () => Promise.resolve(state.transcriptText),
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
      if (state.runImpl) return Promise.resolve(state.runImpl(id));
      return Promise.resolve({
        job: state.makeJob({ status: "succeeded" }),
        asset: { id: "asset_out", url: "/api/v1/assets/asset_out", displayName: "out.mp3" },
        reason: null,
      });
    },
    cancel: (id: string) => {
      state.cancelCalls.push(id);
      return Promise.resolve({
        job: state.makeJob({ status: "cancel_requested" }),
        scope: { stops: "本地等待", doesNot: ["供应商侧撤销", "退款"] },
      });
    },
    poll: () =>
      Promise.resolve({
        job: state.makeJob({ status: "running", requestId: "proj_remote_1" }),
        asset: null,
        reason: null,
        stillRunning: true,
        remoteSucceeded: false,
      }),
  },
}));

beforeEach(() => {
  state.providers = [state.makeProvider()];
  state.uploads = [];
  state.created = [];
  state.runCalls = [];
  state.cancelCalls = [];
  state.createImpl = null;
  state.runImpl = null;
  state.transcriptText = '{"text":"你好世界"}';
  state.tools = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const isDisabled = (el: Element) => (el as HTMLInputElement).disabled;

/**
 * Push files through the input the way the "all files" browser dialog would.
 * user-event honours the input's `accept` filter, so the page's own
 * rejection branch (which must stay reachable) is driven with fireEvent.
 */
function forceFiles(input: HTMLInputElement, files: File[]) {
  fireEvent.change(input, { target: { files } });
}

function renderAt(ui: React.ReactElement, path = "/app/sts") {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

const ACK = /我了解/;

async function ackCost(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("checkbox", { name: ACK }));
}

async function pickVoiceManually(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByText(/手动输入音色 ID/));
  await user.type(await screen.findByPlaceholderText("voice_xxxxxxxxxxxx"), id);
}

/* ------------------------------------------------------------------ STS -- */

describe("StsPage (voice changer)", () => {
  const audioFile = () => new File([new Uint8Array(1024)], "clip.mp3", { type: "audio/mpeg" });

  async function uploadFiles(files: File[]) {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, ...files);
    return user;
  }

  it("rejects a non-audio file and names it, keeping the queue empty", async () => {
    renderAt(<StsPage />);
    await screen.findByText(/音频队列/);
    forceFiles(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      [new File(["x"], "notes.txt", { type: "text/plain" })],
    );

    expect(await screen.findByText(/已跳过：notes\.txt（非音频）/)).toBeTruthy();
    expect(screen.getByText(/队列为空/)).toBeTruthy();
  });

  it("rejects an oversize file citing the per-tool observed limit", async () => {
    renderAt(<StsPage />);
    await screen.findByText(/音频队列/);
    const big = new File([new Uint8Array(50 * 1024 * 1024 + 1)], "huge.mp3", {
      type: "audio/mpeg",
    });
    await uploadFiles([big]);

    expect(await screen.findByText(/huge\.mp3（超过 50MB 网页观察上限）/)).toBeTruthy();
    // The limit is stated as unverified right on the page, not silently applied.
    expect(screen.getByText(/未经 API 验证/)).toBeTruthy();
  });

  it("queues a valid audio file; remove and clear restore the empty state", async () => {
    const user = await (async () => {
      renderAt(<StsPage />);
      await screen.findByText(/音频队列/);
      return uploadFiles([audioFile()]);
    })();

    expect(screen.getByText("clip.mp3")).toBeTruthy();
    expect(screen.getByText("0.00 MB")).toBeTruthy();
    expect(screen.queryByText(/队列为空/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "移除" }));
    expect(screen.getByText(/队列为空/)).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: /转换/ }))).toBe(true);
  });

  it("blocks on a missing voice before anything is uploaded", async () => {
    const user = userEvent.setup();
    renderAt(<StsPage />);
    await screen.findByText(/音频队列/);
    await uploadFiles([audioFile()]);
    await ackCost(user);

    expect(screen.getByText("请选择目标音色")).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: /转换/ }))).toBe(true);
    expect(state.uploads).toHaveLength(0);
  });

  it("submits the queue: upload -> job -> run, with an asset-scoped intent", async () => {
    const user = userEvent.setup();
    renderAt(<StsPage />);
    await screen.findByText(/音频队列/);
    await uploadFiles([audioFile()]);
    await pickVoiceManually(user, "voice_manual_1");
    await ackCost(user);

    await user.click(screen.getByRole("button", { name: /转换/ }));

    await waitFor(() => expect(state.runCalls).toHaveLength(1));
    expect(state.uploads).toHaveLength(1);
    expect(state.created[0].type).toBe("speech_to_speech");
    expect(state.created[0].intentId).toBe(
      "sts:p1:eleven_multilingual_sts_v2:voice_manual_1:asset_1",
    );
    const input = state.created[0].input as Record<string, unknown>;
    expect(input.assetId).toBe("asset_1");
    expect(input.voiceId).toBe("voice_manual_1");
    expect((input.params as Record<string, unknown>).remove_background_noise).toBe(false);
    // The result is offered through the controlled URL.
    expect(await screen.findByText("下载")).toBeTruthy();
  });

  it("a byte-identical re-submission reuses the job and never runs again", async () => {
    state.createImpl = () => ({ job: state.makeJob(), created: false });
    const user = userEvent.setup();
    renderAt(<StsPage />);
    await screen.findByText(/音频队列/);
    await uploadFiles([audioFile()]);
    await pickVoiceManually(user, "voice_manual_1");
    await ackCost(user);

    await user.click(screen.getByRole("button", { name: /转换/ }));

    expect(await screen.findByText(/已复用对应任务，不会重复计费/)).toBeTruthy();
    await waitFor(() => expect(state.created).toHaveLength(1));
    expect(state.runCalls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------- isolator -- */

describe("IsolatorPage", () => {
  async function uploadOne(file: File) {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, file);
    return user;
  }

  it("ignores a non-audio file with a readable note", async () => {
    renderAt(<IsolatorPage />, "/app/isolator");
    await screen.findByText(/输入音频/);
    forceFiles(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      [new File(["x"], "photo.png", { type: "image/png" })],
    );

    expect(await screen.findByText(/photo\.png 不是音频文件，已忽略/)).toBeTruthy();
    expect(screen.getByText(/尚未选择音频/)).toBeTruthy();
  });

  it("blocks until a file is chosen, saying exactly what is missing", async () => {
    const user = userEvent.setup();
    renderAt(<IsolatorPage />, "/app/isolator");
    await screen.findByText(/输入音频/);
    await ackCost(user);

    expect(screen.getByText("请先上传或录制音频")).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: "开始分离" }))).toBe(true);
  });

  it("states that this is not music separation, and labels its limit unverified", () => {
    renderAt(<IsolatorPage />, "/app/isolator");
    // The source text keeps its markdown asterisks; match around them.
    expect(screen.getByText(/音乐分轨或乐器分离/)).toBeTruthy();
    // The limit wording is an actual <strong>, not decoration.
    expect(screen.getByText("未经 API 验证").tagName).toBe("STRONG");
  });

  it("runs upload -> create -> run and shows the source/result comparison", async () => {
    const user = userEvent.setup();
    renderAt(<IsolatorPage />, "/app/isolator");
    await screen.findByText(/输入音频/);
    await uploadOne(new File([new Uint8Array(2048)], "song.mp3", { type: "audio/mpeg" }));
    await ackCost(user);

    await user.click(screen.getByRole("button", { name: "开始分离" }));

    await waitFor(() => expect(state.runCalls).toHaveLength(1));
    expect(state.created[0].type).toBe("audio_isolation");
    expect(state.created[0].intentId).toBe("isolate:p1:asset_1");
    expect((state.created[0].input as Record<string, unknown>).assetId).toBe("asset_1");

    expect(await screen.findByText("对比")).toBeTruthy();
    expect(screen.getByText("原始音频")).toBeTruthy();
    expect(screen.getByText("分离后")).toBeTruthy();
    expect(screen.getByText(/下载 out\.mp3/)).toBeTruthy();
  });

  it("a repeat of the same audio reuses the job and skips the run", async () => {
    state.createImpl = () => ({ job: state.makeJob(), created: false });
    const user = userEvent.setup();
    renderAt(<IsolatorPage />, "/app/isolator");
    await screen.findByText(/输入音频/);
    await uploadOne(new File([new Uint8Array(2048)], "song.mp3", { type: "audio/mpeg" }));
    await ackCost(user);

    await user.click(screen.getByRole("button", { name: "开始分离" }));

    expect(await screen.findByText(/已复用对应任务，不会重复计费/)).toBeTruthy();
    expect(state.runCalls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------- dubbing -- */

describe("DubbingPage", () => {
  async function chooseFile() {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(
      input,
      new File([new Uint8Array(2048)], "episode.mp4", { type: "video/mp4" }),
    );
    return user;
  }

  it("blocks on the file, then on the language, in order", async () => {
    const user = userEvent.setup();
    renderAt(<DubbingPage />, "/app/dubbing");
    await screen.findByText(/源音频/);
    await ackCost(user);
    expect(screen.getByText("请先上传源音频")).toBeTruthy();

    await chooseFile();
    expect(screen.getByText("请选择目标语言")).toBeTruthy();

    await user.type(screen.getByPlaceholderText(/语言代码/), "en");
    expect(screen.queryByText(/请先|请选择/)).toBeNull();
  });

  it("states the language count is unverified and v1 has no editor", () => {
    renderAt(<DubbingPage />, "/app/dubbing");
    expect(screen.getByText(/约 104 种语言/)).toBeTruthy();
    expect(screen.getByText(/\*\*这个数字未经核验\*\*/)).toBeTruthy();
    expect(screen.getByText(/\*\*不提供\*\*编辑器/)).toBeTruthy();
  });

  it("submits a dubbing job keyed by version+language+asset", async () => {
    state.runImpl = (id) => ({
      job: state.makeJob({ id, status: "running", requestId: "proj_remote_1" }),
      asset: null,
      reason: "pending: remote project created",
    });
    const user = await (async () => {
      renderAt(<DubbingPage />, "/app/dubbing");
      await screen.findByText(/源音频/);
      const u = await chooseFile();
      await u.type(screen.getByPlaceholderText(/语言代码/), "en");
      await ackCost(u);
      return u;
    })();

    await user.click(screen.getByRole("button", { name: "开始配音" }));

    await waitFor(() => expect(state.runCalls).toHaveLength(1));
    expect(state.created[0].type).toBe("dubbing");
    expect(state.created[0].modelId).toBe("v2");
    expect(state.created[0].intentId).toBe("dub:p1:v2:en:asset_1");
    const input = state.created[0].input as Record<string, unknown>;
    expect(input.targetLanguage).toBe("en");

    // Async: the job stays running and the remote project id is shown.
    expect(await screen.findByText(/任务 running/)).toBeTruthy();
    expect(screen.getByText("proj_remote_1")).toBeTruthy();
  });
});

/* --------------------------------------------------- youtube transcription */

describe("SttYoutubePage", () => {
  function stubTools(tools: Record<string, unknown>[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ tools }) })),
    );
  }

  it("when yt-dlp is missing the page says so and blocks before provider checks", async () => {
    stubTools([{ id: "yt-dlp", purpose: "x", available: false, install: "brew install yt-dlp" }]);
    renderAt(<SttYoutubePage />, "/app/stt-youtube");

    expect(await screen.findByText(/本机未找到/)).toBeTruthy();
    expect(screen.getByText(/brew install yt-dlp/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText("本机未安装 yt-dlp")).toBeTruthy(),
    );
    expect(isDisabled(screen.getByRole("button", { name: /下载并转写/ }))).toBe(true);
  });

  it("blocks on the empty URL before acknowledging anything", async () => {
    const user = userEvent.setup();
    renderAt(<SttYoutubePage />, "/app/stt-youtube");
    await screen.findByText(/YouTube 链接/);
    await ackCost(user);

    expect(screen.getByText("请粘贴 YouTube 链接")).toBeTruthy();
  });

  it("needs BOTH the rights and the unknown-cost acknowledgement to enable", async () => {
    const user = userEvent.setup();
    renderAt(<SttYoutubePage />, "/app/stt-youtube");
    await screen.findByText(/YouTube 链接/);

    await user.type(screen.getByLabelText("YouTube 链接"), "https://www.youtube.com/watch?v=abc");
    const submit = screen.getByRole("button", { name: /下载并转写/ });
    expect(isDisabled(submit)).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: /合法的处理权/ }));
    expect(isDisabled(submit)).toBe(true); // cost ack still missing

    await ackCost(user);
    expect(isDisabled(submit)).toBe(false);
  });

  it("trims the URL into the intent and renders the transcript with a count", async () => {
    const user = userEvent.setup();
    renderAt(<SttYoutubePage />, "/app/stt-youtube");
    await screen.findByText(/YouTube 链接/);

    await user.type(
      screen.getByLabelText("YouTube 链接"),
      "  https://www.youtube.com/watch?v=abc  ",
    );
    await user.click(screen.getByRole("checkbox", { name: /合法的处理权/ }));
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: /下载并转写/ }));

    await waitFor(() => expect(state.runCalls).toHaveLength(1));
    expect(state.created[0].type).toBe("youtube_transcription");
    expect(state.created[0].intentId).toBe("yt:p1:auto:https://www.youtube.com/watch?v=abc");

    expect(await screen.findByText("转写结果")).toBeTruthy();
    expect(screen.getByText("4 字符")).toBeTruthy();
  });

  it("a repeated link reuses its job and never runs a second time", async () => {
    state.createImpl = () => ({ job: state.makeJob(), created: false });
    const user = userEvent.setup();
    renderAt(<SttYoutubePage />, "/app/stt-youtube");
    await screen.findByText(/YouTube 链接/);

    await user.type(screen.getByLabelText("YouTube 链接"), "https://youtu.be/x");
    await user.click(screen.getByRole("checkbox", { name: /合法的处理权/ }));
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: /下载并转写/ }));

    expect(await screen.findByText(/复用了同一个任务，不会重复计费/)).toBeTruthy();
    expect(state.runCalls).toHaveLength(0);
  });
});
