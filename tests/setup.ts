// jsdom does not implement these, and the shell relies on them. Files that
// opt into the plain node environment (see local-tts-e2e.test.mjs) have no
// window at all, so the polyfills are guarded rather than unconditional.
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
}

/* --------------------------------------------------------------------------
   Global fetch stub for the jsdom component tests.

   Without this, every page that calls the local API on mount produces an
   unhandled rejection and the whole run exits 1 even when all assertions
   pass — which is exactly the "looks green, is not green" failure mode.

   Two separate problems, both real:

   1. jsdom has an origin, but the global `fetch` is Node's undici, which
      rejects a relative URL outright. Resolving against the document origin
      is what a browser does.
   2. Resolving is not enough. The request then really leaves the process and
      gets ECONNREFUSED, which rejects again. So every same-origin `/api`
      call answers with a controlled failure instead, which lets each
      component take its own error branch and keeps its assertions honest.

   Anything NOT under `/api` is passed through to the real implementation, so
   a test that wants to stub something else is not silently swallowed here.
   -------------------------------------------------------------------------- */

const realFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Endpoints the app needs during a mount, answered plausibly. */
const STUBS: Record<string, () => Response> = {
  "/api/v1/session": () =>
    jsonResponse(200, { csrfToken: "test-csrf-token", origin: "test" }),
  "/api/v1/providers": () => jsonResponse(200, { providers: [] }),
  "/api/v1/provider-catalog": () => jsonResponse(200, { providers: [] }),
  "/api/v1/voices": () => jsonResponse(200, { voices: [], reason: "测试环境未配置 Provider" }),
  "/api/v1/jobs": () => jsonResponse(200, { jobs: [] }),
  "/api/v1/assets": () =>
    jsonResponse(200, { assets: [], usage: { totalBytes: 0, count: 0 } }),
  "/api/v1/folders": () => jsonResponse(200, { folders: [] }),
  "/api/v1/projects": () => jsonResponse(200, { projects: [] }),
  "/api/v1/cost": () =>
    jsonResponse(200, {
      summary: { money: [], usage: [], unknown: { count: 0, note: null } },
      budget: { limit: null, currency: "USD" },
      scope: { controls: "test", doesNotControl: [] },
    }),
  "/api/v1/capabilities": () => jsonResponse(200, { capabilities: [] }),
  "/api/v1/tools": () => jsonResponse(200, { tools: [] }),
};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;

  // Only *relative* requests are stubbed. The integration tests boot a real
  // server and call it with an absolute `http://127.0.0.1:<port>/api/...` URL;
  // intercepting those would replace the server under test with a canned
  // answer. In a browser, a relative fetch is same-origin, so this split
  // matches what production actually does.
  const isRelative = !/^([a-z][a-z0-9+.-]*:)?\/\//i.test(raw);
  if (!isRelative) return realFetch(input as RequestInfo, init);

  let url: URL;
  try {
    url = new URL(raw, "http://localhost");
  } catch {
    return realFetch(input as RequestInfo, init);
  }

  const path = url.pathname;
  if (!path.startsWith("/api/")) return realFetch(input as RequestInfo, init);

  const stub = STUBS[path];
  if (stub) return stub();

  // A dynamic segment the stub table cannot name, e.g. /api/v1/jobs/<id>/run.
  // Answer 404 so the caller reports a real "not found" rather than hanging on
  // a refused socket.
  return jsonResponse(404, {
    error: { code: "NOT_STUBBED", safeMessage: `测试环境未预置 ${path}` },
  });
}) as typeof globalThis.fetch;

