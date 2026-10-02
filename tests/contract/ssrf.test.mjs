import { describe, expect, it, vi } from "vitest";
import {
  UnsafeUrlError,
  isPrivateAddress,
  safeFetchUrl,
} from "../../server/lib/safe-fetch.mjs";

/* ==========================================================================
   SSRF negatives.

   Every case here is something a local server must refuse. A negative that
   silently succeeds would let a page on the user's machine make the server
   reach into its own network — or into the cloud metadata service.
   ========================================================================== */

/** Public DNS stand-in, so these tests never touch the network. */
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];
const privateResolver = async () => [{ address: "127.0.0.1", family: 4 }];

function response({ status = 200, headers = {}, chunks = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    body: (async function* () {
      for (const c of chunks) yield c;
    })(),
  };
}

describe("address classification", () => {
  it("refuses loopback, private, link-local and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "0.0.0.0",
      "100.64.0.1", // CGNAT
      "224.0.0.1", // multicast
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateAddress(ip), `${ip} must be refused`).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), `${ip} must be allowed`).toBe(false);
    }
  });
});

describe("safeFetchUrl", () => {
  it("refuses a loopback URL before any request", async () => {
    const impl = vi.fn();
    await expect(
      safeFetchUrl("http://127.0.0.1:8080/admin", { fetchImpl: impl }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(impl).not.toHaveBeenCalled();
  });

  it("refuses the cloud metadata endpoint", async () => {
    const impl = vi.fn();
    await expect(
      safeFetchUrl("http://169.254.169.254/latest/meta-data/", { fetchImpl: impl }),
    ).rejects.toThrow(/private or reserved/);
    expect(impl).not.toHaveBeenCalled();
  });

  it("refuses localhost by name", async () => {
    const impl = vi.fn();
    await expect(
      safeFetchUrl("http://localhost:5173/api/v1/vault", { fetchImpl: impl }),
    ).rejects.toThrow(/local name/);
    expect(impl).not.toHaveBeenCalled();
  });

  it("refuses non-http protocols", async () => {
    const impl = vi.fn();
    for (const u of ["file:///etc/passwd", "ftp://example.com/a", "gopher://x"]) {
      await expect(safeFetchUrl(u, { fetchImpl: impl })).rejects.toThrow(/not allowed/);
    }
    expect(impl).not.toHaveBeenCalled();
  });

  it("refuses a URL carrying credentials", async () => {
    const impl = vi.fn();
    await expect(
      safeFetchUrl("https://user:pass@example.com/a.mp3", { fetchImpl: impl }),
    ).rejects.toThrow(/credentials/);
    expect(impl).not.toHaveBeenCalled();
  });

  it("re-validates every redirect hop", async () => {
    const impl = vi
      .fn()
      .mockResolvedValueOnce(
        response({ status: 302, headers: { location: "http://169.254.169.254/" } }),
      );
    await expect(
      safeFetchUrl("https://example.com/a.mp3", { fetchImpl: impl, resolve: publicResolver }),
    ).rejects.toThrow(/private or reserved/);
  });

  it("follows a public redirect chain but never attaches credentials", async () => {
    const impl = vi
      .fn()
      .mockResolvedValueOnce(
        response({ status: 301, headers: { location: "https://cdn.example.com/a.mp3" } }),
      )
      .mockResolvedValueOnce(response({ chunks: [new Uint8Array([1, 2, 3])] }));

    const out = await safeFetchUrl("https://example.com/a.mp3", { fetchImpl: impl, resolve: publicResolver });
    expect(out.bytes.byteLength).toBe(3);
    expect(out.finalUrl).toBe("https://cdn.example.com/a.mp3");

    for (const call of impl.mock.calls) {
      const init = call[1] ?? {};
      expect(init.headers?.authorization).toBeUndefined();
    }
  });

  it("refuses a public name that resolves to a private address", async () => {
    const impl = vi.fn();
    await expect(
      safeFetchUrl("https://sneaky.example.com/a.mp3", {
        fetchImpl: impl,
        resolve: privateResolver,
      }),
    ).rejects.toThrow(/resolves to 127.0.0.1/);
    expect(impl).not.toHaveBeenCalled();
  });

  it("stops after too many redirects", async () => {
    const impl = vi.fn().mockResolvedValue(
      response({ status: 302, headers: { location: "https://example.com/loop" } }),
    );
    await expect(
      safeFetchUrl("https://example.com/a.mp3", { fetchImpl: impl, resolve: publicResolver }),
    ).rejects.toThrow(/too many redirects/);
  });

  it("caps the body size", async () => {
    const impl = vi.fn().mockResolvedValue(
      response({ chunks: [new Uint8Array(100), new Uint8Array(100)] }),
    );
    await expect(
      safeFetchUrl("https://example.com/a.mp3", {
        fetchImpl: impl,
        resolve: publicResolver,
        maxBytes: 150,
      }),
    ).rejects.toThrow(/exceeds/);
  });
});
