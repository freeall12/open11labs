import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../server/lib/db.mjs";
import { ProjectStore } from "../../server/lib/projects.mjs";

/* ==========================================================================
   Variant derivation.

   Borrowed from open-source video-DSL projects (hypit and similar): a finished
   workflow is re-run with different variables rather than rebuilt. The payoff
   is that structure and finished assets are reused, so the second run is
   cheap. These tests pin that behaviour, and pin the part that is easy to get
   wrong: deriving must never regenerate anything on its own.
   ========================================================================== */

let db;
let projects;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "open11labs-variant-"));
  db = openDb(join(dir, "meta.db"));
  projects = new ProjectStore({ db });
});

afterEach(() => db.close());

const base = () =>
  projects.create({
    kind: "studio",
    name: "播客开场",
    content: {
      variables: { host: "主播A", language: "zh", duration: 20 },
      beats: ["开场", "要点", "收尾"],
    },
    assetRefs: ["asset_intro"],
  });

describe("variant derivation", () => {
  it("keeps the structure and swaps only the named variables", () => {
    const src = base();
    const v = projects.deriveVariant(src.id, {
      variables: { host: "主播B" },
    });

    expect(v.content.beats).toEqual(src.content.beats);
    expect(v.content.variables.host).toBe("主播B");
    // Untouched variables survive.
    expect(v.content.variables.language).toBe("zh");
    expect(v.content.variables.duration).toBe(20);
  });

  it("records where it came from and what actually changed", () => {
    const src = base();
    const v = projects.deriveVariant(src.id, {
      variables: { host: "主播B", language: "en" },
    });

    expect(v.content.derivedFrom.id).toBe(src.id);
    expect(v.content.derivedFrom.revision).toBe(1);
    expect(v.content.derivedFrom.changed.sort()).toEqual(["host", "language"]);
  });

  it("does not list unchanged variables as changed", () => {
    const src = base();
    const v = projects.deriveVariant(src.id, {
      variables: { host: "主播A", language: "en" },
    });
    expect(v.content.derivedFrom.changed).toEqual(["language"]);
  });

  it("reuses the existing assets rather than re-generating", () => {
    const src = base();
    const v = projects.deriveVariant(src.id, { variables: { host: "X" } });
    expect(v.assetRefs).toEqual(src.assetRefs);
  });

  it("is a new project, so the original is untouched", () => {
    const src = base();
    projects.deriveVariant(src.id, { variables: { host: "X" } });

    const after = projects.get(src.id);
    expect(after.content.variables.host).toBe("主播A");
    expect(projects.list()).toHaveLength(2);
  });

  it("rejects an unknown project", () => {
    expect(() => projects.deriveVariant("nope", {})).toThrow(/unknown project/);
  });

  it("chains: a variant can itself spawn a variant", () => {
    const a = base();
    const b = projects.deriveVariant(a.id, { variables: { host: "B" } });
    const c = projects.deriveVariant(b.id, { variables: { language: "en" } });

    expect(c.content.variables.host).toBe("B");
    expect(c.content.variables.language).toBe("en");
  });
});
