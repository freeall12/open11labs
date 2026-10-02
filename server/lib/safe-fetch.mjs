/* ==========================================================================
   Safe remote fetch.

   docs/architecture/security.md requires that a user-supplied URL is never
   fetched with the provider key attached, and that loopback, private ranges,
   link-local metadata endpoints, DNS rebinding and redirects to those
   addresses are all refused.

   The rules:
     - http/https only
     - no credentials in the URL
     - resolve the hostname and reject any private/loopback/link-local/
       multicast/reserved address — re-checked on every redirect hop
     - cap redirects, bytes and time
     - the provider key is never attached; this fetch is anonymous
   ========================================================================== */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

export class UnsafeUrlError extends Error {
  constructor(url, reason) {
    super(`refusing to fetch ${url}: ${reason}`);
    this.code = "SSRF_BLOCKED";
    this.url = url;
  }
}

/** True for any address that must never be reached from a user-supplied URL. */
export function isPrivateAddress(ip) {
  const v = ip.toLowerCase();

  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1 — classify by the embedded v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateAddress(mapped[1]);

  if (v === "::1" || v === "::") return true;          // loopback / unspecified
  if (/^fe[89ab]/.test(v)) return true;                 // link-local
  if (/^f[cd]/.test(v)) return true;                    // unique-local
  if (v.startsWith("ff")) return true;                  // multicast
  // Anything else that parses as IPv6 is treated as public.
  if (isIP(v) === 6) return false;

  const parts = v.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Unrecognised form: refuse rather than guess.
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true;             // 0.0.0.0/8
  if (a === 10) return true;            // private
  if (a === 127) return true;           // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;            // multicast / reserved
  return false;
}

async function assertPublicHost(hostname, resolve = lookup) {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new UnsafeUrlError(hostname, "address is private or reserved");
    }
    return;
  }
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(hostname)) {
    throw new UnsafeUrlError(hostname, "hostname resolves to a local name");
  }
  // Resolve before connecting, so a public name cannot point at a private
  // address (DNS rebinding).
  let records;
  try {
    records = await resolve(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError(hostname, "host does not resolve");
  }
  if (!records?.length) throw new UnsafeUrlError(hostname, "host does not resolve");
  for (const r of records) {
    if (isPrivateAddress(r.address)) {
      throw new UnsafeUrlError(hostname, `resolves to ${r.address}`);
    }
  }
}

/**
 * Fetch a user-supplied URL with no credential attached and a hard cap on
 * redirects, bytes and time. Each hop is re-validated, because a public host
 * may redirect to a private one.
 */
export async function safeFetchUrl(
  rawUrl,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    /** Injectable for tests; production always uses DNS. */
    resolve = lookup,
  } = {},
) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(String(rawUrl), "not a valid URL");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new UnsafeUrlError(url.toString(), `protocol ${url.protocol} not allowed`);
    }
    if (url.username || url.password) {
      throw new UnsafeUrlError(url.toString(), "URL must not embed credentials");
    }
    await assertPublicHost(url.hostname, resolve);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      // No Authorization header, and an explicit redirect: manual so each hop
      // goes back through the checks above.
      res = await fetchImpl(url.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "open11labs-local-fetch" },
      });
    } catch (err) {
      throw new UnsafeUrlError(url.toString(), err?.message ?? "request failed");
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new UnsafeUrlError(url.toString(), "redirect without Location");
      url = new URL(next, url);
      continue;
    }

    if (!res.ok) {
      throw new UnsafeUrlError(url.toString(), `HTTP ${res.status}`);
    }

    // Stream with a byte cap so a huge or endless body cannot exhaust memory.
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body ?? []) {
      total += chunk.length;
      if (total > maxBytes) {
        throw new UnsafeUrlError(url.toString(), `exceeds ${maxBytes} bytes`);
      }
      chunks.push(chunk);
    }
    return {
      bytes: new Uint8Array(Buffer.concat(chunks)),
      finalUrl: url.toString(),
      contentType: res.headers.get("content-type"),
    };
  }

  throw new UnsafeUrlError(url.toString(), "too many redirects");
}
