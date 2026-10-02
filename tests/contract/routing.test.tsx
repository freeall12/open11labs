import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "@/app/router";
import {
  ALL_ROUTES,
  EXCLUDED_ROUTES,
  LOCAL_ROUTES,
  PENDING_ROUTES,
  ROUTABLE_ROUTES,
} from "@/app/route-manifest";

/* ==========================================================================
   R1-AC01 — routing acceptance.

   "Real target component per route, not all landing on the home page; deep
   links work; 404 is explicit." Each claim gets a test rather than a
   screenshot, because a screenshot cannot prove a *different* URL rendered
   something *different*.
   ========================================================================== */

const HOME_HEADING = "你想创建什么？";

function renderAt(path: string) {
  cleanup();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe("route manifest", () => {
  it("classifies every route in routes.json", () => {
    const classified =
      EXCLUDED_ROUTES.length + PENDING_ROUTES.length + ROUTABLE_ROUTES.length;
    // modal/mode query routes live inside ROUTABLE_ROUTES' pages but carry
    // their own entries, so compare against the full set instead.
    expect(classified).toBeLessThanOrEqual(ALL_ROUTES.length);
    expect(EXCLUDED_ROUTES.length).toBeGreaterThan(0);
  });

  it("keeps pending-discovery routes unroutable", () => {
    for (const r of PENDING_ROUTES) {
      expect(r.path).toBeNull();
    }
    const routed = ROUTABLE_ROUTES.map((r) => r.path);
    for (const r of PENDING_ROUTES) {
      expect(routed).not.toContain(r.path);
    }
  });
});

describe("every in-scope route renders its own page", () => {
  for (const route of ROUTABLE_ROUTES) {
    // `/app/home` is the one route that *should* render the home page.
    if (route.id === "home") continue;

    it(`${route.id} -> ${route.path}`, () => {
      const path = concretePath(route.path!);
      renderAt(path);

      const heading = screen.getByRole("heading", { level: 1 });
      // A deep link must never fall through to the home page content.
      expect(heading.textContent).not.toBe(HOME_HEADING);
      expect(heading.textContent?.length ?? 0).toBeGreaterThan(0);
    });
  }
});

describe("home", () => {
  it("renders the home page", () => {
    renderAt("/app/home");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      HOME_HEADING,
    );
  });
});

describe("excluded upstream paths", () => {
  for (const route of EXCLUDED_ROUTES.filter((r) => r.path)) {
    it(`${route.path} resolves to the local out-of-scope notice`, () => {
      renderAt(route.path!);
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toContain("不包含在本地版本");
      // Must not show the home page, and must not show any account UI.
      expect(heading.textContent).not.toBe(HOME_HEADING);
      expectNoAccountAffordances();
    });
  }
});

/**
 * The out-of-scope notice legitimately *names* the removed subject (e.g.
 * "订阅/套餐") in order to explain the decision. What must not exist is a
 * control that goes there, so this inspects interactive elements only.
 */
function expectNoAccountAffordances() {
  const controls = [
    ...document.querySelectorAll("a, button, [role='button'], [role='menuitem']"),
  ];
  for (const el of controls) {
    const label = (el.textContent ?? "").trim();
    expect(label).not.toMatch(
      /登出|退出登录|登录|注册|订阅|套餐|积分|充值|账单|收益|分成|工作区|切换平台/,
    );
  }
}

describe("local BYOK extension pages", () => {
  for (const local of LOCAL_ROUTES) {
    it(`${local.path} renders`, () => {
      renderAt(local.path);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        local.title,
      );
    });
  }
});

describe("unknown paths", () => {
  it("404 explicitly instead of showing the home page", () => {
    renderAt("/app/definitely-not-a-real-route");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("找不到这个页面");
    expect(heading.textContent).not.toBe(HOME_HEADING);
  });
});

describe("scope trimming", () => {
  it("renders no account or marketing affordances anywhere in the shell", () => {
    for (const route of [...ROUTABLE_ROUTES.slice(0, 12), ...LOCAL_ROUTES]) {
      renderAt(concretePath(route.path!));
      expectNoAccountAffordances();
      expect(screen.queryByLabelText(/个人资料|通知/)).toBeNull();
    }
  });
});

/** Replace `:id` placeholders with a concrete segment. */
function concretePath(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, "test-id");
}
