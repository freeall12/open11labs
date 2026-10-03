import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SfxPage } from "@/features/media/SfxPage";
import { ImageVideoPage } from "@/features/media/ImageVideoPage";

/* ==========================================================================
   QA gap-fill: media pages — sound effects and image/video generation.
   Adapted to the composer rewrite (presets -> chips, single docked composer,
   provider-reported models, per-mode persisted drafts).

   Coverage target: implemented page behaviours no existing test asserts
   (routing.test.tsx renders h1s only). The page *bodies* are rendered
   directly with their `tab` prop; the pages.tsx wrappers only add
   PageFrame/route-manifest chrome around them, which the routing test
   already covers.

   SfxPage (composer form):
     - empty-prompt gate that states what is missing
     - suggestion chips fill the draft but never auto-submit. The old
       Chinese preset 「雨夜窗外的雨声」 no longer exists: chips carry the
       reference's own English labels and insert fragments the user can
       read and edit, so the assertion is the equivalent "draft filled,
       nothing created, gate still named".
     - the duration ceiling as a stated state: the slider lives in the
       时长 popover, opens parked on 自动 (disabled — a parked state, not
       a clamp), and 60s reads 正好等于本地上限
     - submit payload: trimmed prompt, durationSeconds present only when
       自动 is off, loop/influence/outputFormat recorded locally, cost ack
       flag; result renders as audio + download link
     - WAS: an in-page 本次会话历史 after a second generation. That list is
       gone from the composer page; session history is the persisted
       历史 tab over the local job store (JobHistory), so the equivalent
       assertion runs two generations and reads them back from that tab.
     - dedupe reuse: created:false reuses the job, run never called

   ImageVideoPage:
     - image mode is the default and the model menu lists exactly what
       providers.models() reported. WAS a hardcoded docs-derived list
       (seedream/flux/seedream_4); the ids stay the same in the mock for
       continuity, but the page now renders the provider's answer and says
       so (模型列表来自你的 Provider).
     - deep link ?modality=video lands on video mode. The switch is a
       radiogroup now, not tabs, and video ships with NO preselected
       model (was kling_v2): the page does not invent model names.
     - WAS: the needs-approval model seedream_4 refused on submit. The
       page no longer hardcodes any model's approval state — which models
       exist, and which need approval, is the provider's business now. The
       equivalent local refusal is 口型同步: a whole class of submission
       this build cannot honour, stated on screen (notice + gate line),
       submit gated even with a filled and acknowledged form, and nothing
       created.
     - a mode switch keeps the half-written draft prompt and swaps in the
       video-only controls (时长 / 声音). WAS "model resets to the new
       mode's default": there is no per-mode default model any more.
     - submit payload incl. the intent id shape, image mode sending no
       duration; result rendered as an image
     - async run→poll surface: running panel with the poll count, cancel
       with its honest scope (stops 本地等待; does NOT do 供应商侧撤销 or
       退款), and a re-query affordance afterwards
     - dedupe reuse without a second run

   @/lib/api is mocked at the module boundary (the real client is covered
   over HTTP by tests/integration/client.test.mjs), so no provider is
   contacted. providers.models MUST be provided: the page reads models
   from the provider instead of hardcoding them. Drafts persist to
   localStorage with a 250ms debounce (and a synchronous flush on
   unmount), so every test starts from a cleared store or it would
   inherit the previous test's prompt. Music/editor pages are still in
   flight and deliberately not tested here.
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
    /** What providers.models() answers; the page renders this verbatim. */
    models: [] as { id: string; source: string }[],
    created: [] as Record<string, unknown>[],
    /** The local job store: jobs.list reads it, create/run keep it honest. */
    jobsStore: [] as Record<string, unknown>[],
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
  providers: {
    list: () => Promise.resolve(state.providers),
    models: () => Promise.resolve({ models: state.models, source: "provider" }),
  },
  assets: {
    list: () => Promise.resolve({ assets: [], usage: { totalBytes: 0, count: 0 } }),
    upload: () =>
      Promise.resolve({
        asset: {
          id: "asset_1",
          url: "/api/v1/assets/asset_1",
          displayName: "ref.png",
          mediaType: "image/png",
          byteSize: 1,
          origin: "uploaded",
          licenseSource: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
        created: true,
      }),
  },
  jobs: {
    list: () => Promise.resolve(state.jobsStore),
    create: (input: Record<string, unknown>) => {
      state.created.push(input);
      const job = state.makeJob({
        id: `job_${String(state.created.length).padStart(8, "0")}`,
        intentId: input.intentId,
        type: input.type,
        modelId: (input.modelId as string | undefined) ?? null,
      });
      state.jobsStore.push(job);
      if (state.createImpl) return Promise.resolve(state.createImpl(input));
      return Promise.resolve({ job, created: true });
    },
    run: (id: string) => {
      state.runCalls.push(id);
      const stored = state.jobsStore.find((j) => j.id === id);
      if (stored) {
        stored.status = "succeeded";
        stored.outputAssetIds = ["asset_out"];
      }
      if (state.runImpl) return Promise.resolve(state.runImpl(id));
      return Promise.resolve({
        job: state.makeJob({ id, status: "succeeded", outputAssetIds: ["asset_out"] }),
        asset: {
          id: "asset_out",
          url: "/api/v1/assets/asset_out.png",
          displayName: "out.png",
          mediaType: "image/png",
          byteSize: 1,
          origin: "generated",
          licenseSource: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
        reason: null,
      });
    },
    cancel: (id: string) => {
      state.cancelCalls.push(id);
      return Promise.resolve({
        job: state.makeJob({ id, status: "cancel_requested", requestId: "rem_1" }),
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
  // Same three ids the old docs-derived list held, but now answered by the
  // provider mock — the page must render the answer, not a constant.
  state.models = [
    { id: "seedream", source: "provider" },
    { id: "flux", source: "provider" },
    { id: "seedream_4", source: "provider" },
  ];
  state.created = [];
  state.jobsStore = [];
  state.runCalls = [];
  state.cancelCalls = [];
  state.pollCalls = [];
  state.createImpl = null;
  state.runImpl = null;
  // Drafts persist to localStorage (250ms debounce + unmount flush), so clear
  // the store or a test inherits the previous test's half-written prompt.
  // Guarded: this setup does not always expose localStorage on the test global
  // (same convention as page-voice-tools.test.tsx).
  globalThis.localStorage?.clear?.();
});

afterEach(() => {
  cleanup();
});

const isDisabled = (el: Element) => (el as HTMLButtonElement).disabled;
const ACK = /我了解这次提交会产生费用/;

async function ackCost(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("checkbox", { name: ACK }));
}

/** Set a range/select value and let React see the change. */
function fireEventChange(el: Element, value: string) {
  fireEvent.change(el, { target: { value } });
}

/* ----------------------------------------------------------------- SFX -- */

function renderSfx(tab: "explore" | "history" | "favorites" = "explore") {
  return render(
    <MemoryRouter>
      <SfxPage tab={tab} />
    </MemoryRouter>,
  );
}

/** The duration control lives in a popover and opens parked on 自动. */
async function openDurationPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "时长：自动" }));
  return screen.getByRole("slider", { name: "时长" });
}

/** Turn 自动 off (the slider is disabled while 自动 holds) and close the panel. */
async function takeDurationOffAuto(user: ReturnType<typeof userEvent.setup>) {
  const slider = await openDurationPanel(user);
  await user.click(screen.getByRole("switch", { name: "时长自动" }));
  await user.keyboard("{Escape}");
  return slider;
}

describe("SfxPage", () => {
  it("blocks on an empty prompt and says what is missing", async () => {
    const user = userEvent.setup();
    renderSfx();
    await screen.findByLabelText("音效提示词");
    await ackCost(user);

    expect(await screen.findByText("请输入音效描述")).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: "生成音效" }))).toBe(true);
  });

  it("a suggestion chip fills the draft but never submits on its own", async () => {
    const user = userEvent.setup();
    renderSfx();
    const prompt = (await screen.findByLabelText("音效提示词")) as HTMLTextAreaElement;

    await user.click(screen.getByRole("button", { name: "Add sound qualities" }));
    expect(prompt.value).toContain("high quality");
    expect(state.created).toHaveLength(0);
    // Acknowledgement is still missing, so the button stays gated — and the
    // gate names the missing thing instead of failing silently.
    expect(isDisabled(screen.getByRole("button", { name: "生成音效" }))).toBe(true);
    expect(screen.getByText("请先勾选下方的费用确认")).toBeTruthy();
  });

  it("the duration ceiling is a stated state, not a silent clamp", async () => {
    const user = userEvent.setup();
    renderSfx();
    await screen.findByLabelText("音效提示词");

    // 自动 is the opening state: the range control is parked (disabled),
    // not invisibly clamped to some value.
    const slider = await openDurationPanel(user);
    expect(slider.getAttribute("max")).toBe("60");
    expect(isDisabled(slider)).toBe(true);

    await user.click(screen.getByRole("switch", { name: "时长自动" }));
    expect(isDisabled(slider)).toBe(false);
    fireEventChange(slider, "60");
    expect(screen.getByText(/正好等于本地上限 60 秒/)).toBeTruthy();
  });

  it("submits the trimmed prompt with the chosen local duration", async () => {
    const user = userEvent.setup();
    renderSfx();
    await screen.findByLabelText("音效提示词");

    await takeDurationOffAuto(user); // leaves the draft at the opening 5s
    await user.type(screen.getByLabelText("音效提示词"), "  篝火噼啪声  ");
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: "生成音效" }));

    await waitFor(() => expect(state.runCalls).toHaveLength(1));
    expect(state.created[0].type).toBe("sound_generation");
    expect(state.created[0].credentialRef).toBe("p1");
    // The dedupe key carries the duration: a different length is a different job.
    expect(state.created[0].intentId).toBe("sfx:p1:5:0:mp3:篝火噼啪声");
    const input = state.created[0].input as Record<string, unknown>;
    expect(input.prompt).toBe("篝火噼啪声");
    expect(input.durationSeconds).toBe(5);
    expect(input.loop).toBe(false);
    expect(input.promptInfluence).toBe(0.3);
    // Recorded in the local job record; the adapter never forwards it.
    expect(input.outputFormat).toBe("mp3");
    expect(input.acknowledgeUnknownCost).toBe(true);
    expect(await screen.findByText(/下载 out\.png/)).toBeTruthy();
    expect(document.querySelector("audio[controls]")).toBeTruthy();
  });

  it("the second generation lands in the persisted 历史 tab", async () => {
    const user = userEvent.setup();
    const view = renderSfx();
    const prompt = await screen.findByLabelText("音效提示词");

    await user.type(prompt, "第一个音效");
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: "生成音效" }));
    await screen.findByText(/下载 out\.png/);

    // A distinct prompt so this is a genuinely new job, not the dedupe path.
    await user.type(prompt, "，然后是第二个");
    await user.click(screen.getByRole("button", { name: "生成音效" }));
    await waitFor(() => expect(state.runCalls).toHaveLength(2));

    // The composer page no longer draws an in-page session list; 历史 is the
    // persisted local job store, so that is where the session must show up.
    view.rerender(
      <MemoryRouter>
        <SfxPage tab="history" />
      </MemoryRouter>,
    );
    await screen.findAllByText("sound_generation");
    expect(screen.getAllByText("sound_generation")).toHaveLength(2);
    expect(screen.getAllByText("succeeded")).toHaveLength(2);
  });

  it("an identical re-submission reuses the job and never runs again", async () => {
    state.createImpl = () => ({ job: state.makeJob(), created: false });
    const user = userEvent.setup();
    renderSfx();
    await screen.findByLabelText("音效提示词");

    await user.type(screen.getByLabelText("音效提示词"), "同一个音效");
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
      <ImageVideoPage tab="explore" />
    </MemoryRouter>,
  );
}

/** Pick a model through the composer popover (the provider-reported list). */
async function pickModel(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByRole("button", { name: "模型：未选择" }));
  await user.click(await screen.findByRole("button", { name: id }));
  await user.keyboard("{Escape}"); // leave the bar as one row again
}

describe("ImageVideoPage", () => {
  it("defaults to image mode and lists the models the provider reports", async () => {
    const user = userEvent.setup();
    renderImageVideo();

    const imageRadio = await screen.findByRole("radio", { name: "图像" });
    expect(imageRadio.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "视频" }).getAttribute("aria-checked")).toBe("false");

    // The list is the provider's own answer, and the page says so.
    expect(await screen.findByText(/模型列表来自你的 Provider（3 个）/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "模型：未选择" }));
    await screen.findByRole("button", { name: "seedream" });
    const panel = screen.getByRole("group", { name: "模型：未选择设置" });
    const names = Array.from(panel.querySelectorAll("button")).map((b) => b.textContent);
    expect(names).toEqual(["seedream", "flux", "seedream_4"]);
  });

  it("a deep link with ?modality=video lands on video mode with no invented model", async () => {
    renderImageVideo("/app/image-video?modality=video");

    const videoRadio = await screen.findByRole("radio", { name: "视频" });
    expect(videoRadio.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "图像" }).getAttribute("aria-checked")).toBe("false");

    // Video-only controls are on the bar.
    expect(screen.getByRole("button", { name: "时长" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "声音：关闭" })).toBeTruthy();
    // No per-mode default model any more (was kling_v2): the page does not
    // guess a name the provider never reported.
    expect(screen.getByRole("button", { name: "模型：未选择" })).toBeTruthy();
  });

  it("口型同步 is refused locally with the reason stated, not hidden", async () => {
    const user = userEvent.setup();
    renderImageVideo();
    await screen.findByRole("radio", { name: "图像" });

    await user.click(screen.getByRole("radio", { name: "口型同步" }));
    // Even a fully filled, acknowledged form cannot unlock it.
    await user.type(screen.getByLabelText("口型同步描述"), "一张图");
    await ackCost(user);

    // The unconditional notice (a fact about this build) and the gate line.
    // Both live next to a composer hint with similar wording, so anchor on
    // each element's own tail.
    expect(screen.getByText(/只会存入本地素材库。$/)).toBeTruthy();
    expect(screen.getByText(/因此本页不提交口型同步$/)).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: "生成" }))).toBe(true);
    expect(state.created).toHaveLength(0);
  });

  it("switching mode loads that mode's own draft and swaps in the video controls", async () => {
    // This environment exposes no real localStorage; stand one up so the
    // per-mode draft contract can be seeded and inspected.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear(),
    });
    try {
    const user = userEvent.setup();
    renderImageVideo();
    await screen.findByRole("radio", { name: "图像" });

    await user.type(screen.getByLabelText("图像描述"), "图像模式的草稿");
    // Pre-seed what the video mode itself saved earlier, then switch.
    globalThis.localStorage?.setItem?.(
      "open11labs.draft:image-video:video",
      JSON.stringify({ prompt: "视频模式的旧存稿" }),
    );
    await user.click(screen.getByRole("radio", { name: "视频" }));

    expect(screen.getByRole("radio", { name: "视频" }).getAttribute("aria-checked")).toBe("true");
    // Each mode keeps its own draft: the switch adopts the video draft, it
    // does NOT carry the image prompt over (and must not overwrite it either).
    expect((screen.getByLabelText("视频描述") as HTMLTextAreaElement).value).toBe("视频模式的旧存稿");
    expect(screen.getByRole("button", { name: "时长" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "声音：关闭" })).toBeTruthy();

    // Pollution regression: after the debounce fires, the image mode's stored
    // draft still says exactly what the image mode typed.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    const stored = store.get("open11labs.draft:image-video:image");
    expect(stored && JSON.parse(stored).prompt).toBe("图像模式的草稿");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("submits an image job and renders the returned image", async () => {
    const user = userEvent.setup();
    renderImageVideo();
    await screen.findByRole("radio", { name: "图像" });

    await pickModel(user, "seedream");
    await user.type(screen.getByLabelText("图像描述"), "  一只猫  ");
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: "生成" }));

    await waitFor(() => expect(state.runCalls).toHaveLength(1));
    expect(state.created[0].type).toBe("image_generation");
    expect(state.created[0].modelId).toBe("seedream");
    expect(state.created[0].intentId).toBe("image:p1:seedream:16:9:1K:0:一只猫");
    const input = state.created[0].input as Record<string, unknown>;
    expect(input.prompt).toBe("一只猫");
    expect(input.aspectRatio).toBe("16:9");
    expect(input.resolution).toBe("1K");
    expect(input.sound).toBe(false);
    // Image mode sends no duration: a made-up number is not a parameter.
    expect(input.durationSeconds).toBeUndefined();

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
    await screen.findByRole("radio", { name: "图像" });

    await pickModel(user, "seedream");
    await user.type(screen.getByLabelText("图像描述"), "异步图");
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: "生成" }));

    expect(await screen.findByText("任务 running")).toBeTruthy();
    expect(screen.getByText(/远端仍在处理，本应用正在轮询（第 1 次）/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(state.cancelCalls).toHaveLength(1);
    // The cancel answer must say what it did NOT do.
    expect(await screen.findByText(/本地等待；不涉及：供应商侧撤销、退款/)).toBeTruthy();
    // The job state really moved, and the page offers re-query instead of
    // pretending the remote task is dead.
    expect(screen.getByText("任务 cancel_requested")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新查询" })).toBeTruthy();
  });

  it("an identical re-submission reuses the job without a second run", async () => {
    state.createImpl = () => ({ job: state.makeJob(), created: false });
    const user = userEvent.setup();
    renderImageVideo();
    await screen.findByRole("radio", { name: "图像" });

    await pickModel(user, "seedream");
    await user.type(screen.getByLabelText("图像描述"), "重复图");
    await ackCost(user);
    await user.click(screen.getByRole("button", { name: "生成" }));

    expect(await screen.findByText(/已复用同一个任务，不会重复计费/)).toBeTruthy();
    expect(state.runCalls).toHaveLength(0);
  });
});
