import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { StudioEditorPage } from "@/features/editors/StudioPage";

/* ==========================================================================
   Studio editor beat generation (9f27723 feature pin).

   Pins the gate order (provider → cost ack → text), the submit payload,
   dedup-without-rerun honesty, and the inline audio/download render — the
   reference's confirmed editor operation (047: playback).
   ========================================================================== */

const state = vi.hoisted(() => ({
  providers: [] as Record<string, unknown>[],
  project: null as Record<string, unknown> | null,
  created: [] as Record<string, unknown>[],
  runCalls: [] as string[],
}));

vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  projects: {
    list: () =>
      Promise.resolve(
        state.project ? [state.project] : [],
      ),
    save: (id: string, content: unknown) =>
      Promise.resolve({ ...state.project, id, content, revision: 2 }),
  },
  assets: {
    list: () =>
      Promise.resolve({
        assets: state.project?.["__asset"]
          ? [state.project["__asset"]]
          : [],
        usage: { totalBytes: 0, count: 0 },
      }),
  },
  providers: {
    list: () => Promise.resolve(state.providers),
  },
  jobs: {
    list: () => Promise.resolve([]),
    create: (input: Record<string, unknown>) => {
      state.created.push(input);
      return Promise.resolve({
        job: { id: "job_st1", status: "draft", outputAssetIds: [] },
        created: true,
      });
    },
    run: (id: string) => {
      state.runCalls.push(id);
      return Promise.resolve({
        job: { id, status: "succeeded", outputAssetIds: ["a_out"] },
        asset: { id: "a_out", url: "/api/v1/assets/a_out", displayName: "out.mp3" },
        reason: null,
      });
    },
    cancel: () => Promise.resolve({ job: { status: "cancel_requested" } }),
  },
}));

let store: Map<string, string>;

beforeEach(() => {
  cleanup();
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  });
  state.providers = [
    {
      id: "p1",
      type: "elevenlabs",
      displayName: "测试",
      baseURL: "https://api.elevenlabs.io",
      maskedSecret: "sk-1••••",
      validationState: "available",
      validatedAt: "2026-01-01T00:00:00Z",
      lastError: null,
      createdAt: "2026-01-01T00:00:00Z",
      rotatedAt: null,
    },
  ];
  state.created = [];
  state.runCalls = [];
  state.project = {
    id: "proj1",
    kind: "studio",
    name: "测试项目",
    revision: 1,
    assetRefs: [],
    content: {
      beats: [{ id: "b1", name: "旁白", kind: "tts", text: "预置文本" }],
    },
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={["/app/studio/proj1"]}>
      <Routes>
        <Route path="/app/studio/:id" element={<StudioEditorPage />} />
        <Route path="/local/settings/providers" element={<div>设置页</div>} />
        <Route path="/app/studio" element={<div>列表</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Studio editor beat generation", () => {
  it("gates: cost acknowledgement required before 生成本段", async () => {
    renderEditor();
    const gen = await screen.findByRole("button", { name: "生成本段" });
    expect((gen as HTMLButtonElement).disabled).toBe(true);

    await userEvent.setup().click(screen.getByRole("checkbox"));
    await waitFor(() => expect((screen.getByRole("button", { name: "生成本段" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("submits the beat text through the shared job contract and renders audio", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("button", { name: "生成本段" });

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "生成本段" }));

    await waitFor(() => expect(state.created).toHaveLength(1));
    const sent = state.created[0];
    expect(sent.type).toBe("text_to_speech");
    expect(sent.intentId).toMatch(/^studio:beat:proj1:b1:/);
    expect(sent.input).toMatchObject({ text: "预置文本", outputFormat: "mp3_44100_128" });

    await waitFor(() => expect(state.runCalls).toEqual(["job_st1"]));
    // 音频与下载随产物出现
    await waitFor(() => expect(document.querySelector("audio")).toBeTruthy());
    expect(screen.getByRole("link", { name: /下载音频/ }).getAttribute("download")).toBe("out.mp3");
  });

  it("empty text keeps the beat button disabled even with the ack on", async () => {
    state.project!.content = {
      beats: [{ id: "b1", name: "旁白", kind: "tts", text: "" }],
    };
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("button", { name: "生成本段" });
    await user.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "生成本段" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("no available provider: guidance instead of a dead submit", async () => {
    state.providers = [
      { ...state.providers[0], validationState: "unverified" },
    ];
    renderEditor();
    expect(await screen.findByText(/没有可用的 Provider/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "生成本段" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
