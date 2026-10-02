import { describe, expect, it, vi } from "vitest";
import {
  YtdlpError,
  assertAllowedVideoUrl,
  downloadAudio,
  isAvailable,
} from "../../server/lib/ytdlp.mjs";

/* ==========================================================================
   yt-dlp guardrails.

   The subprocess is the risky part: a user-supplied URL reaching a shell
   would be a command injection. These tests pin the argument array, the URL
   allowlist, and the size bound.
   ========================================================================== */

describe("URL allowlist", () => {
  it("accepts public YouTube URLs", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=abc123",
      "https://youtu.be/abc123",
      "https://m.youtube.com/watch?v=abc123",
    ]) {
      expect(() => assertAllowedVideoUrl(u)).not.toThrow();
    }
  });

  it("refuses other hosts", () => {
    for (const u of [
      "https://vimeo.com/12345",
      "https://example.com/a.mp4",
      "https://youtube.com.evil.test/watch?v=x",
    ]) {
      expect(() => assertAllowedVideoUrl(u)).toThrow(YtdlpError);
    }
  });

  it("refuses non-https and credentialed URLs", () => {
    expect(() => assertAllowedVideoUrl("http://youtube.com/x")).toThrow();
    expect(() => assertAllowedVideoUrl("https://u:p@youtu.be/x")).toThrow();
  });

  it("refuses a value that is not a URL at all", () => {
    expect(() => assertAllowedVideoUrl("not a url ; & |")).toThrow(/有效/);
  });
});

describe("subprocess invocation", () => {
  /** Pretend yt-dlp ran: materialise the file it was told to write. */
  function fakeRun(stdoutPayload = '{"id":"vid1","title":"A/B: test","duration":12}') {
    return vi.fn(async (args) => {
      const out = args[args.indexOf("-o") + 1];
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { dirname, resolve } = await import("node:path");
      const target = resolve(dirname(out), "audio.mp3");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, new Uint8Array([0x49, 0x44, 0x33]));
      return { stdout: stdoutPayload, stderr: "" };
    });
  }

  it("passes an argument array, never a shell string", async () => {
    const fetchImpl = fakeRun();
    const out = await downloadAudio("https://youtu.be/abc", { fetchImpl });

    const args = fetchImpl.mock.calls[0][0];
    expect(Array.isArray(args)).toBe(true);
    expect(args.every((a) => typeof a === "string")).toBe(true);
    // The user URL is its own argv entry, so it cannot become a shell fragment.
    expect(args[args.length - 1]).toBe("https://youtu.be/abc");
    // No cookie jar of any kind.
    expect(args).toContain("--no-cookies");
    expect(args.some((a) => a.startsWith("--cookies"))).toBe(false);
    // Audio only, normalised to a real audio container.
    expect(args).toContain("bestaudio[ext=m4a]/bestaudio");
    expect(args).toContain("mp3");

    // The title becomes a label, never a path.
    expect(out.filename).toBe("A-B- test.mp3");
    expect(out.filename).not.toContain("/");
    expect(out.videoId).toBe("vid1");
    expect(out.durationSeconds).toBe(12);
  });

  it("rejects an oversized download after the fact", async () => {
    const fetchImpl = vi.fn(async (args) => {
      const out = args[args.indexOf("-o") + 1];
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { dirname, resolve } = await import("node:path");
      const target = resolve(dirname(out), "audio.mp3");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.alloc(2048));
      return { stdout: "{}", stderr: "" };
    });

    await expect(
      downloadAudio("https://youtu.be/a", { fetchImpl, maxBytes: 1024 }),
    ).rejects.toThrow(/超过本地上限/);
  });

  it("surfaces a failure as a readable message", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new YtdlpError("Video unavailable", { code: "YTDLP_FAILED" }));
    await expect(
      downloadAudio("https://youtu.be/a", { fetchImpl }),
    ).rejects.toThrow(/Video unavailable/);
  });

  it("reports a missing binary distinctly", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new YtdlpError("未找到 yt-dlp，请先安装", { code: "YTDLP_MISSING" }));
    const err = await downloadAudio("https://youtu.be/a", { fetchImpl }).catch((e) => e);
    expect(err.code).toBe("YTDLP_MISSING");
  });

  it("never reaches the subprocess for a disallowed host", async () => {
    const fetchImpl = vi.fn();
    await expect(
      downloadAudio("https://evil.test/watch?v=x", { fetchImpl }),
    ).rejects.toThrow(YtdlpError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("availability probe", () => {
  it("answers a boolean rather than assuming the tool exists", async () => {
    expect(typeof (await isAvailable())).toBe("boolean");
  });

  it("reports false for a binary that is not installed", async () => {
    expect(await isAvailable("definitely-not-a-real-binary-xyz")).toBe(false);
  });
});
