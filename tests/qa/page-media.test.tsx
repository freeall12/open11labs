import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SfxPage, ImageVideoPage } from "@/features/media/pages";

/* ==========================================================================
   QA gap-fill: media pages — sound effects and image/video generation.

   Coverage target: implemented page behaviours no existing test asserts
   (routing.test.tsx renders h1s only):
     - SfxPage: empty-prompt gate, presets that fill the draft but never
       auto-submit, the duration ceiling state, the submit payload, result
       + session history rendering, and the dedupe reuse path
     - ImageVideoPage: mode tabs driven by the URL query (?modality=video),
       the needs-approval model that the local app refuses to submit, the
       model reset that keeps the draft prompt across a mode switch, the
       async run->poll lifecycle surface (running panel, cancel with its
       honest scope), and the image result rendering

   Why the existing tests do not cover this: there are no other page-behaviour
   tests. @/lib/api is mocked at the module boundary (its real behaviour is
   covered over HTTP by tests/integration/client.test.mjs), so no provider is
   contacted. These pages are implemented at HEAD; music/editor pages are
   still in flight and deliberately not tested here.
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
    type: "sound_generation",
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
    created: [] as Record<string, unknown>[],
    runCalls: [] as string[],
    cancelCalls: [] as string[],
    pollCalls: [] as string[],
    createImpl: null as null | ((input: Record<string, unknown>) => unknown),
    runImpl: null as null | ((id: string) => unknown),
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
    upload: () => Promise.resolve({ asset: { id: "asset_1" }, created: true }),
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
      if (state.runImpl) return Promise.resolve(state.runImpl(id));
      return Promise.resolve({
        job: state.makeJob({ status: "succeeded" }),
        asset: { id: "asset_out", url: "/api/v1/assets/asset_out.png", displayName: "out.png" },
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
    poll: (id: string) => {
      state.pollCalls.push(id);
      return Promise.resolve({
        job: state.makeJob({ id, status: "running", requestId: "rem_1" }),
        asset: null,
        reason: null,
        stillRunning: true,
        remoteSucceeded: false,
      });
    },
  },
}));

beforeEach(() => {
  state.providers = [state.makeProvider()];
  state.created = [];
  state.runCalls = [];
  state.cancelCalls = [];
  state.pollCalls = [];
  state.createImpl = null;
  state.runImpl = null;
});

afterEach(() => {
  cleanup();
});

const isDisabled = (el: Element) => (el as HTMLInputElement).disabled;
const ACK = /我了解这次提交会产生费用/;

async function ackCost(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("checkbox", { name: ACK }));
}

/* ----------------------------------------------------------------- SFX -- */

describe("SfxPage", () => {
  it("blocks on an empty prompt and says what is missing", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SfxPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText("描述你想要的音效…");
    await ackCost(user);

    expect(screen.getByText("请输入音效描述")).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: "生成音效" }))).toBe(true);
  });

  it("a preset fills the draft but never submits on its own", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SfxPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText("描述你想要的音效…");

    await user.click(screen.getByRole("button", { name: /雨夜窗外的雨声/ }));
    expect((screen.getByPlaceholderText("描述你想要的音效…") as HTMLTextAreaElement).value).toContain("雨夜窗外");
    expect(state.created).toHaveLength(0);
    // Acknowledgement is still missing, so the button stays gated.
    expect(isDisabled(screen.getByRole("button", { name: "生成音效" }))).toBe(true);
  });

  it("the duration ceiling is a stated state, not a silent clamp", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SfxPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText("描述你想要的音效…");

    const slider = screen.getAllByRole("slider")[0];
    expect(slider.getAttribute("max")).toBe("60");
    fireEventChange(slider, "60");
    expect(screen.getByText(/正好等于本地上限 60 秒/)).toBeTruthy();
  });

  it("submits the trimmed prompt with the local duration range", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SfxPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText("描述你想要的音效…");

    await user.type(screen.getByPlaceholderText("描述你想要的音效…"), "  篝火噼啪声  ");
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: "生成音效" }));

    await waitFor(() => expect(state.runCalls).toHaveLength(1));
    expect(state.created[0].type).toBe("sound_generation");
    const input = state.created[0].input as Record<string, unknown>;
    expect(input.prompt).toBe("篝火噼啪声");
    expect(input.durationSeconds).toBe(5);
    expect(input.loop).toBe(false);
    expect(await screen.findByText(/下载 out\.png/)).toBeTruthy();
  });

  it("a second generation shows the session history", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SfxPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText("描述你想要的音效…");

    await user.type(screen.getByPlaceholderText("描述你想要的音效…"), "第一个音效");
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: "生成音效" }));
    await screen.findByText(/下载 out\.png/);

    await user.click(screen.getByRole("button", { name: "生成音效" }));
    expect(await screen.findByText("本次会话历史")).toBeTruthy();
  });

  it("an identical re-submission reuses the job and never runs again", async () => {
    state.createImpl = () => ({ job: state.makeJob(), created: false });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SfxPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText("描述你想要的音效…");

    await user.type(screen.getByPlaceholderText("描述你想要的音效…"), "同一个音效");
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: "生成音效" }));

    expect(await screen.findByText(/已复用同一个任务，不会重复计费/)).toBeTruthy();
    await waitFor(() => expect(state.created).toHaveLength(1));
    expect(state.runCalls).toHaveLength(0);
  });
});

/* ---------------------------------------------------------- image/video -- */

function renderImageVideo(path = "/app/image-video") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ImageVideoPage />
    </MemoryRouter>,
  );
}

describe("ImageVideoPage", () => {
  it("defaults to image mode with the docs-derived model list", async () => {
    renderImageVideo();
    await screen.findByRole("tab", { name: "图像", selected: true });

    const select = screen.getByLabelText("模型") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["seedream", "flux", "seedream_4"]);
  });

  it("a deep link with ?modality=video lands on video mode", async () => {
    renderImageVideo("/app/image-video?modality=video");
    await screen.findByRole("tab", { name: "视频", selected: true });
    expect(screen.getByRole("tab", { name: "图像", selected: false })).toBeTruthy();
  });

  it("a needs-approval model is blocked with the reason stated, not hidden", async () => {
    const user = userEvent.setup();
    renderImageVideo();
    await screen.findByRole("tab", { name: "图像", selected: true });

    await user.selectOptions(screen.getByLabelText("模型"), "seedream_4");
    expect(screen.getByText(/该模型在你的 Provider 账户中默认禁用/)).toBeTruthy();
    await user.type(screen.getByLabelText("描述"), "一张图");
    await ackCost(user);
    expect(isDisabled(screen.getByRole("button", { name: "生成图像" }))).toBe(true);
    expect(screen.getByText(/本地无法代为申请/)).toBeTruthy();
  });

  it("switching mode resets only the model and keeps the draft prompt", async () => {
    const user = userEvent.setup();
    renderImageVideo();
    await screen.findByRole("tab", { name: "图像", selected: true });

    await user.type(screen.getByLabelText("描述"), "我的草稿");
    await user.click(screen.getByRole("tab", { name: "视频" }));

    const select = screen.getByLabelText("模型") as HTMLSelectElement;
    expect(select.value).toBe("kling_v2");
    expect((screen.getByLabelText("描述") as HTMLTextAreaElement).value).toBe("我的草稿");
  });

  it("submits an image job and renders the returned image", async () => {
    const user = userEvent.setup();
    renderImageVideo();
    await screen.findByRole("tab", { name: "图像", selected: true });

    await user.type(screen.getByLabelText("描述"), "  一只猫  ");
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: "生成图像" }));

    await waitFor(() => expect(state.runCalls).toHaveLength(1));
    expect(state.created[0].type).toBe("image_generation");
    expect(state.created[0].modelId).toBe("seedream");
    expect(state.created[0].intentId).toBe("image:p1:seedream:一只猫");
    expect((state.created[0].input as Record<string, unknown>).prompt).toBe("一只猫");

    await screen.findByText("产物");
    expect(document.querySelector("img[alt='out.png']")).toBeTruthy();
  });

  it("an async run shows the running panel and cancel with its honest scope", async () => {
    state.runImpl = (id) => ({
      job: state.makeJob({ id, type: "image_generation", status: "running", requestId: "rem_1" }),
      asset: null,
      reason: null,
    });
    const user = userEvent.setup();
    renderImageVideo();
    await screen.findByRole("tab", { name: "图像", selected: true });

    await user.type(screen.getByLabelText("描述"), "异步图");
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: "生成图像" }));

    expect(await screen.findByText("任务 running")).toBeTruthy();
    expect(screen.getByText(/远端仍在处理，本应用正在轮询/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(state.cancelCalls).toHaveLength(1);
    // The cancel answer must say what it did NOT do.
    expect(await screen.findByText(/本地等待；不涉及：供应商侧撤销、退款/)).toBeTruthy();
  });

  it("an identical re-submission reuses the job without a second run", async () => {
    state.createImpl = () => ({ job: state.makeJob(), created: false });
    const user = userEvent.setup();
    renderImageVideo();
    await screen.findByRole("tab", { name: "图像", selected: true });

    await user.type(screen.getByLabelText("描述"), "重复图");
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: "生成图像" }));

    expect(await screen.findByText(/已复用同一个任务，不会重复计费/)).toBeTruthy();
    expect(state.runCalls).toHaveLength(0);
  });
});

/** Set a range/select value and let React see the change. */
function fireEventChange(el: Element, value: string) {
  fireEvent.change(el, { target: { value } });
}
