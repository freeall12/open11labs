// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* ==========================================================================
   Geometry contract (pixel-verified anchors).

   The home page's key dimensions were measured against the live reference
   twice: by the original prototype author (getBoundingClientRect, values
   recorded in the old README measurement table) and re-verified on
   2026-10-03 at 1500×759/DPR1 (docs/qa/visual-pass-1.md). This file pins
   the source tokens those measurements depend on, so a refactor cannot
   silently drift the geometry. Browser-level layout assertions are done in
   the ego-browser visual rounds; this is the CI-able source-level guard.
   ========================================================================== */

const root = fileURLToPath(new URL("../../", import.meta.url));
const src = (p) => readFileSync(root + p, "utf8");

describe("home geometry contract (measured 2026-10-02, re-verified 2026-10-03)", () => {
  it("top bar height is 50px", () => {
    expect(src("src/app/AppShell.tsx")).toContain("HEADER_HEIGHT = 50");
  });

  it("sidebar rail is 256px expanded / 72px collapsed", () => {
    const css = src("src/index.css");
    expect(css).toContain("--eleven-sidebar-width: 16rem"); // 256
    expect(css).toContain("--sidebar-width: 4.5rem"); // 72
  });

  it("prompt bar: 650px max width, 26px radius on box and all shadow layers", () => {
    const bar = src("src/components/PromptBar.tsx");
    expect(bar).toContain("max-w-[650px]");
    // Outer + three absolutely-positioned shadow layers must share the radius,
    // otherwise the shadow corners visibly detach from the box.
    expect(bar.match(/rounded-\[26px\]/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("tool cards: 81px content with a 97px-wide hit overlay (-inset-x-2)", () => {
    const grid = src("src/components/ToolGrid.tsx");
    expect(grid).toContain("w-[81px]");
    expect(grid).toContain("-inset-x-2 -inset-y-3.5");
  });

  it("STT dropzone wording matches the reference capture", () => {
    expect(src("src/features/voice/SttPage.tsx")).toContain("点击或将文件拖到此处上传");
  });
});
