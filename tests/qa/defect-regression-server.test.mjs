import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalServer } from "../../server/index.mjs";
import { Vault } from "../../server/lib/vault.mjs";

/* ==========================================================================
   Defect regression marker D-05 (server-level, polarity-inverted — vitest 3
   has no test.failing; see tests/qa/defect-regression.test.tsx for the
   marker convention).

   D-05  GET /api/v1/session calls sessions.issue() unconditionally and
         never reuses the el_session cookie the caller already holds. Both
         tabs of one browser share the cookie jar for 127.0.0.1, so the
         second tab's bootstrap overwrites the cookie and the FIRST tab's
         csrf token is instantly orphaned — every write from it 403s with
         CSRF_REJECTED until a full page reload.

   ⚠️ FLIP WHEN FIXED: when the endpoint reuses a live session cookie, the
   second bootstrap must return the SAME csrfToken and must not set a new
   cookie. The assertions below encode today's defective rotation on
   purpose so the fix flips them red — do not just delete this test.
   ========================================================================== */

let server;
let PORT;
let HOST;

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "open11labs-d05-"));
  writeFileSync(join(dataDir, "index.html"), "<!doctype html><title>t</title>");
  const handle = createLocalServer({
    root: dataDir,
    vault: new Vault(),
    port: 0,
    dataDir,
    log: () => {},
    providerAdapters: { elevenlabs: { async validateCredential() { return { ok: true, modelCount: 0 }; } } },
  });
  await new Promise((r) => handle.server.listen(0, "127.0.0.1", r));
  handle.adoptActualPort();
  server = handle.server;
  PORT = server.address().port;
  HOST = `127.0.0.1:${PORT}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

describe("defect regression marker (server)", () => {
  it("D-05 session bootstrap rotates even with a live cookie (⚠️ FLIP WHEN FIXED)", async () => {
    const first = await fetch(`http://127.0.0.1:${PORT}/api/v1/session`, {
      headers: { host: HOST },
    });
    const firstBody = await first.json();
    const firstCookie = first.headers.get("set-cookie").split(";")[0];

    const second = await fetch(`http://127.0.0.1:${PORT}/api/v1/session`, {
      headers: { host: HOST, cookie: firstCookie },
    });
    const secondBody = await second.json();
    const secondCookieHeader = second.headers.get("set-cookie");

    // DEFECT PRESENT (D-05): a caller that already holds a live session is
    // issued a brand-new one; the old csrf token is orphaned.
    // ⚠️ FLIP WHEN FIXED: expect(secondBody.csrfToken).toBe(firstBody.csrfToken)
    // and expect(secondCookieHeader).toBeNull().
    expect(secondBody.csrfToken).not.toBe(firstBody.csrfToken);
    expect(secondCookieHeader).not.toBeNull();
  });
});
