/* ==========================================================================
   yt-dlp integration.

   Why a subprocess: yt-dlp is the maintained answer for YouTube extraction.
   Re-implementing it would break whenever the platform changes. Audio is
   downloaded here and then transcribed with the *user's own* STT provider, so
   no third-party transcription service is involved.

   Safety rules, from docs/architecture/security.md:
     - arguments are passed as an array, never through a shell string
     - a timeout and a post-download size check bound the work
     - output goes only into a server-created temp directory
     - no cookie jar, no login, no credentials of any kind
     - only public, non-paywalled URLs are accepted

   What this deliberately does NOT do: bypass login walls, age gates or
   paywalls, and it never touches the user's browser cookies. Content the
   user is not entitled to download is out of scope for this build.
   ========================================================================== */

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Hosts we will hand to yt-dlp. Anything else is refused outright. */
const ALLOWED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export class YtdlpError extends Error {
  constructor(message, { code = "YTDL P_FAILED", detail = null } = {}) {
    super(message);
    this.code = code.replace(" ", "_");
    this.detail = detail;
  }
}

/** Validate a user-supplied URL before it ever reaches the subprocess. */
export function assertAllowedVideoUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new YtdlpError("不是有效的 URL", { code: "INVALID_URL" });
  }
  if (url.protocol !== "https:") {
    throw new YtdlpError("只接受 https 链接", { code: "INVALID_SCHEME" });
  }
  if (url.username || url.password) {
    throw new YtdlpError("链接不得包含凭据", { code: "URL_CREDENTIALS" });
  }
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new YtdlpError(`不支持的站点：${host}`, { code: "HOST_NOT_ALLOWED" });
  }
  return url;
}

/**
 * Run yt-dlp with an argument array.
 *
 * Deliberately no shell: a user-supplied URL can never become a shell fragment.
 */
function runYtDlp(args, { timeoutMs = DEFAULT_TIMEOUT_MS, bin = "yt-dlp" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      shell: false, // never
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "" },
    });

    let stdout = "";
    let stderr = "";
    const cap = 4 * 1024 * 1024;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      if (stdout.length < cap) stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < cap) stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new YtdlpError(
          err.code === "ENOENT"
            ? "未找到 yt-dlp，请先安装"
            : "yt-dlp 启动失败",
          { code: "YTDLP_MISSING", detail: err.message },
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new YtdlpError("下载超时", { code: "YTDLP_TIMEOUT" }));
        return;
      }
      if (code !== 0) {
        reject(
          new YtdlpError(summarise(stderr) ?? `yt-dlp 退出码 ${code}`, {
            code: "YTDLP_FAILED",
          }),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/** yt-dlp's stderr is user-facing; keep the useful line, drop the noise. */
function summarise(stderr) {
  const line = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => /^ERROR|WARNING: \[youtube\]/i.test(l) || l.startsWith("ERROR:"))
    .pop();
  return line ? line.replace(/^ERROR:\s*/, "").slice(0, 300) : null;
}

/**
 * Download the best available audio-only stream.
 *
 * @returns {Promise<{ bytes: Uint8Array, filename: string, title: string|null,
 *                     durationSeconds: number|null, videoId: string|null }>}
 */
export async function downloadAudio(rawUrl, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    bin = "yt-dlp",
    fetchImpl = runYtDlp,
  } = options;

  assertAllowedVideoUrl(rawUrl);

  const dir = mkdtempSync(join(tmpdir(), "open11labs-yt-"));
  try {
    const args = [
      // No cookies, ever: this build does not access anything the user is not
      // already entitled to fetch anonymously.
      "--no-cookies",
      "--no-playlist",
      // Audio only — the transcript pipeline never needs the picture.
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--no-progress",
      "--no-warnings",
      "--print-json",
      "--no-simulate",
      "-o",
      join(dir, "audio.%(ext)s"),
      // Trusted formats keep the extractor from fetching a manifest.
      "--extractor-args",
      "youtube:player_client=default",
      rawUrl,
    ];

    const { stdout } = await fetchImpl(args, { timeoutMs, bin });

    const file = readdirSync(dir).find((f) => f.endsWith(".mp3"));
    if (!file) {
      throw new YtdlpError("下载完成但未找到音频文件", { code: "NO_OUTPUT" });
    }

    const full = join(dir, file);
    const size = statSync(full).size;
    if (size > maxBytes) {
      throw new YtdlpError(
        `音频 ${(size / 1024 / 1024).toFixed(1)}MB 超过本地上限 ${(maxBytes / 1024 / 1024).toFixed(0)}MB`,
        { code: "AUDIO_TOO_LARGE" },
      );
    }

    let meta = {};
    try {
      meta = JSON.parse(stdout.trim().split("\n").pop() ?? "{}");
    } catch {
      // Metadata is a nice-to-have; the file itself is what matters.
    }

    const { readFileSync } = await import("node:fs");
    return {
      bytes: new Uint8Array(readFileSync(full)),
      filename: `${sanitiseTitle(meta.title ?? file)}.mp3`,
      title: meta.title ?? null,
      durationSeconds:
        typeof meta.duration === "number" ? Math.round(meta.duration) : null,
      videoId: meta.id ?? null,
    };
  } finally {
    // The temp directory never outlives the call, success or failure.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort; the sweeper also covers this */
    }
  }
}

/**
 * A title is a label, never a path. Characters that are illegal on Windows are
 * folded too, so a downloaded asset can still be exported and opened there.
 */
function sanitiseTitle(title) {
  const s = String(title)
    .replace(/[/\\]/g, "-")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/^\.+/, "")
    .replace(/[\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return s || "视频音频";
}

/** Is the binary present? Reported rather than assumed, so the UI can say so. */
export async function isAvailable(bin = "yt-dlp") {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], {
      shell: false,
      stdio: "ignore",
      env: { PATH: process.env.PATH ?? "" },
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export { existsSync, randomUUID };
