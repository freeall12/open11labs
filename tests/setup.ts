// jsdom does not implement these, and the shell relies on them.
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

// jsdom's location is http://localhost:3000/ but the global fetch in the
// vitest worker is Node's undici, which rejects relative URLs. Components
// fetch "/api/..." on mount, so without this the run accumulates unhandled
// rejections ("Failed to parse URL from /api/v1/session") and exits 1.
// Relative /api requests get a controlled error response so components walk
// their own failure branches deterministically; everything else — absolute
// URLs included, which is what the integration tests use against real
// servers — passes through untouched.
const nodeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : null;
  if (raw !== null && raw.startsWith("/") && !raw.startsWith("//")) {
    if (raw.startsWith("/api/")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "TEST_API_UNAVAILABLE", safeMessage: "API not provided in component tests" },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      );
    }
    return nodeFetch(new URL(raw, window.location.href).toString(), init);
  }
  return nodeFetch(input as RequestInfo, init);
}) as typeof fetch;
