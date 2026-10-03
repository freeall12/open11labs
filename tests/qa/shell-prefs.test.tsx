import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "@/app/router";

/* ==========================================================================
   Shell view preferences (gaps.md #4 residue).

   The desktop rail's open/collapsed choice is a view preference and must
   survive a refresh (INTERACTIONS: 刷新可恢复) — the sidebar's pin state
   already did; the rail did not (it always rebooted open). This file pins
   both directions of the persistence.
   ========================================================================== */

const KEY = "open11labs.pref:sidebar-rail";

let store: Map<string, string>;

beforeEach(() => {
  cleanup();
  // No real localStorage in this environment; stand one up per test.
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  });
  // jsdom has no layout; force the desktop branch so the rail (not the
  // mobile drawer) is what we are asserting about.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width: 1024px"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/app/home"]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe("sidebar rail preference", () => {
  it("boots collapsed when the stored preference says closed", async () => {
    store.set(KEY, "closed");
    renderHome();
    await screen.findByRole("button", { name: "打开侧边栏" });
    expect(document.querySelector("[data-sidebar-open]")?.getAttribute("data-sidebar-open")).toBe(
      "false",
    );
  });

  it("toggling writes the preference back", async () => {
    const user = userEvent.setup();
    renderHome();
    const toggle = await screen.findByRole("button", { name: "关闭侧边栏" });
    expect(document.querySelector("[data-sidebar-open]")?.getAttribute("data-sidebar-open")).toBe(
      "true",
    );

    await user.click(toggle);
    await act(async () => {});
    expect(store.get(KEY)).toBe("closed");
    expect(
      document.querySelector("[data-sidebar-open]")?.getAttribute("data-sidebar-open"),
    ).toBe("false");
  });
});
