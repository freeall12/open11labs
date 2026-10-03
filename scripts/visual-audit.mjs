#!/usr/bin/env node
/* ==========================================================================
   Visual audit — screenshot every in-scope route.

   Purpose: produce a reviewable artefact for "does this page look like the
   reference", without adding a browser-automation dependency. It drives the
   Chrome that is already installed, in headless mode, against a running local
   server.

   How it drives Chrome: ONE long-lived `chrome --headless=new` process, one
   tab per route, created over the DevTools Protocol HTTP endpoints and driven
   over the CDP WebSocket. The previous implementation spawned a whole browser
   per route, which cost ~20s each and ~10 minutes for the full set; process
   startup, not rendering, was the cost. Reuse drops it to a couple of seconds
   per route.

   What it does NOT do, and must not be read as doing:
     - it does not compare against the reference corpus. `research/` is private
       and gitignored, and diffing against it is a separate, manual judgement
       that also has to account for the scope trimming (marketing and account
       surfaces are removed on purpose)
     - it does not prove a page is functionally correct. A screenshot of a page
       that renders an error state still looks like a page

   Usage:
     node scripts/visual-audit.mjs --base http://127.0.0.1:5178 --out tmp/visual
   ========================================================================== */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import http from "node:http";

/** Routes worth photographing, in the order a reviewer should read them. */
const ROUTES = [
  ["/app/home", "主页"],
  ["/app/voice-library", "音色"],
  ["/app/voice-lab", "我的音色"],
  ["/app/speech-synthesis/text-to-speech", "文本转语音"],
  ["/app/speech-synthesis/speech-to-speech", "变声器"],
  ["/app/voice-isolator", "人声分离"],
  ["/app/speech-to-text", "语音转文本"],
  ["/app/speech-to-text/speakers", "说话者"],
  ["/app/dubbing", "配音"],
  ["/app/sound-effects", "音效"],
  ["/app/sound-effects/history", "音效历史"],
  ["/app/sound-effects/favorites", "音效收藏"],
  ["/app/music", "音乐"],
  ["/app/music/history", "音乐历史"],
  ["/app/music/saved", "音乐收藏"],
  ["/app/music/finetunes", "音乐微调"],
  ["/app/image-video", "图像和视频"],
  ["/app/image-video/history", "生成历史"],
  ["/app/studio", "工作室"],
  ["/app/studio/templates", "工作室模板"],
  ["/app/flows", "Flows"],
  ["/app/creative-agent", "聊天"],
  ["/app/files", "素材"],
  ["/app/files/brand-kits", "品牌套件"],
  ["/app/audiobooks", "有声书"],
  ["/app/audio-detector", "音频检测"],
  ["/local/settings/providers", "Provider 与密钥"],
  ["/local/settings/storage", "存储设置"],
  ["/local/jobs", "任务队列"],
];

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    console.error("no Chrome/Chromium binary found; set CHROME_PATH");
    process.exit(2);
  }
  return found;
}

function parseArgs(argv) {
  const out = {
    base: "http://127.0.0.1:5178",
    dir: "tmp/visual",
    width: 1512,
    height: 900,
    settleMs: 20000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--base") out.base = argv[++i];
    else if (a === "--out") out.dir = argv[++i];
    else if (a === "--width") out.width = Number(argv[++i]);
    else if (a === "--height") out.height = Number(argv[++i]);
    else if (a === "--settle-timeout") out.settleMs = Number(argv[++i]);
  }
  out.base = out.base.replace(/\/+$/, "");
  return out;
}

const args = parseArgs(process.argv.slice(2));
const chrome = process.env.CHROME_PATH || findChrome();
mkdirSync(args.dir, { recursive: true });

const slug = (p) =>
  p
    .replace(/^\/app\//, "")
    .replace(/^\/local\//, "local-")
    .replace(/[/?=&]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "root";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- browser -- */

/**
 * Ask the OS for a port nobody is listening on, instead of hardcoding one —
 * other agents keep browsers open on this machine.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * The profile MUST NOT live on the repo volume. This workspace is exFAT, and
 * Chrome writing thousands of small cache files to it dominates the runtime.
 * `tmpdir()` is local disk on every platform we support.
 */
function makeProfile() {
  return join(tmpdir(), `open11labs-audit-${process.pid}`);
}

/* -------------------------------------------------------------- CDP client -- */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (ev) => this.#onMessage(ev));
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error(`websocket failed: ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }

  #onMessage(ev) {
    const raw = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8");
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
      else p.resolve(msg.result);
      return;
    }
    for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

/* ------------------------------------------------------- settle detection -- */

/**
 * Strings the app renders *only* while a provider/config fetch is in flight.
 * Their absence is the cheapest reliable "the async boot finished" signal:
 * every page in scope swaps the marker for real content or an empty state.
 */
const LOADING_MARKERS = ["正在读取", "正在加载", "加载中"];

/** Evaluated in the page. Returns the raw facts; the verdict is made in node. */
const PROBE = `(() => {
  const root = document.getElementById("app-root");
  const text = document.body ? (document.body.innerText || "") : "";
  const rect = document.body ? document.body.getBoundingClientRect() : { width: 0, height: 0 };
  return {
    readyState: document.readyState,
    rootChildren: root ? root.childElementCount : -1,
    textLen: text.length,
    loading: ${JSON.stringify(LOADING_MARKERS)}.filter((m) => text.includes(m)),
    fonts: document.fonts ? document.fonts.status : "unknown",
    scrollHeight: document.documentElement ? document.documentElement.scrollHeight : 0,
    bodyWidth: Math.round(rect.width),
    bodyHeight: Math.round(rect.height),
    title: document.title,
  };
})()`;

function hardReady(p) {
  if (!p) return false;
  return (
    p.readyState === "complete" &&
    p.rootChildren > 0 &&
    p.loading.length === 0 &&
    p.bodyWidth > 0 &&
    p.textLen > 40
  );
}

/* -------------------------------------------------------------- browser run -- */

let chromeProc = null;
let stderrTail = "";

function launchChrome(port, profile, width, height) {
  const chromeArgs = [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--force-device-scale-factor=1",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-networking",
    "about:blank",
  ];
  chromeProc = spawn(chrome, chromeArgs, { stdio: ["ignore", "ignore", "pipe"] });
  chromeProc.stderr.setEncoding("utf8");
  chromeProc.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-4000);
  });
  chromeProc.on("error", (err) => {
    stderrTail += `\nspawn error: ${err.message}`;
  });
  return chromeProc;
}

/** Poll the DevTools HTTP endpoint until Chrome is listening. */
async function waitForDevTools(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (chromeProc && chromeProc.exitCode !== null) {
      throw new Error(`chrome exited early (code ${chromeProc.exitCode}):\n${stderrTail.slice(-1200)}`);
    }
    try {
      const version = await devtoolsHttp("GET", "/json/version", port);
      if (version && version.webSocketDebuggerUrl) return version;
    } catch {
      /* not up yet */
    }
    await sleep(120);
  }
  throw new Error(`devtools endpoint never came up on ${port}:\n${stderrTail.slice(-1200)}`);
}

function devtoolsHttp(method, path, port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, timeout: 5000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body); // /json/close answers with plain text
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("devtools http timeout")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Capture can transiently fail with "Not attached to an active page" when the
 * renderer is still swapping contexts after a navigation. That is a timing
 * artefact, not a broken route, so retry briefly before calling it a failure.
 */
async function captureWithRetry(cdp, attempts = 6) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await cdp.send(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: false, optimizeForSpeed: false },
        15000,
      );
    } catch (err) {
      lastErr = err;
      await sleep(350);
    }
  }
  throw lastErr;
}

/** Photograph one route on its own fresh tab, then throw the tab away. */
async function shootRoute(port, route, file) {
  const target = await devtoolsHttp("PUT", "/json/new?about:blank", port);
  if (!target || !target.webSocketDebuggerUrl) {
    throw new Error(`could not open a tab for ${route}`);
  }
  const targetId = target.id;

  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  let inFlight = 0;
  let lastRequestEnd = Date.now();
  let loaded = false;
  const pageErrors = [];

  try {
    cdp.on("Network.requestWillBeSent", () => {
      inFlight += 1;
    });
    const endRequest = () => {
      inFlight = Math.max(0, inFlight - 1);
      lastRequestEnd = Date.now();
    };
    cdp.on("Network.loadingFinished", endRequest);
    cdp.on("Network.loadingFailed", endRequest);
    cdp.on("Page.loadEventFired", () => {
      loaded = true;
    });
    cdp.on("Runtime.exceptionThrown", (p) => {
      const d = p?.exceptionDetails;
      pageErrors.push(String(d?.exception?.description || d?.text || "exception").split("\n")[0].slice(0, 160));
    });
    cdp.on("Runtime.consoleAPICalled", (p) => {
      if (p?.type === "error" && p.args?.length) {
        pageErrors.push(
          String(p.args.map((a) => a.description || a.value).join(" ")).split("\n")[0].slice(0, 160),
        );
      }
    });

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    // Pin the viewport through emulation so the PNG is exactly width x height
    // device pixels, independent of headless window chrome.
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: args.width,
      height: args.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const nav = await cdp.send("Page.navigate", { url: `${args.base}${route}` });
    if (nav?.errorText) throw new Error(`navigate failed: ${nav.errorText}`);

    // Settle: wait for a rendered, data-loaded frame — not merely a deadline.
    // Hard gates: load event, React root mounted, no in-flight request for a
    // quiet window, and none of the app's own loading markers on screen.
    // The load event alone is NOT enough — it fires before React mounts, and a
    // page can paint a partial tree and then fill it in from a fetch. So the
    // DOM signature must also stop changing between two consecutive samples.
    const deadline = Date.now() + args.settleMs;
    let hardAt = null;
    let stableSig = null;
    let probe = null;
    let fontsOk = false;
    let settled = false;
    while (Date.now() < deadline) {
      if (loaded) {
        const { result } = await cdp.send("Runtime.evaluate", {
          expression: PROBE,
          returnByValue: true,
        });
        probe = result?.value ?? null;
        fontsOk = probe?.fonts === "loaded";
        const quiet = inFlight === 0 && Date.now() - lastRequestEnd >= 350;
        if (loaded && quiet && hardReady(probe)) {
          if (hardAt === null) hardAt = Date.now();
          // Let webfonts finish, but do not hang the run on them — Google
          // Fonts can be unreachable and the page is still a real render.
          const fontsGraceDone = fontsOk || Date.now() - hardAt >= 1500;
          const sig = `${probe.rootChildren}|${probe.textLen}|${probe.loading.join(",")}`;
          const domStable = sig === stableSig;
          stableSig = sig;
          if (domStable && fontsGraceDone) {
            // two more animation frames: the settle is a painted frame
            await cdp
              .send(
                "Runtime.evaluate",
                {
                  expression:
                    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))",
                  awaitPromise: true,
                },
                5000,
              )
              .catch(() => {});
            settled = true;
            break;
          }
        } else {
          hardAt = null;
          stableSig = null;
        }
      }
      await sleep(100);
    }

    const shot = await captureWithRetry(cdp);
    if (!shot?.data) throw new Error("captureScreenshot returned no data");
    writeFileSync(file, Buffer.from(shot.data, "base64"));

    return {
      settled: Boolean(settled),
      probe,
      pageErrors,
      fonts: fontsOk,
    };
  } finally {
    cdp.close();
    // Close the tab so cookies/localStorage never leak into the next route.
    try {
      await devtoolsHttp("GET", `/json/close/${targetId}`, port);
    } catch {
      /* the browser may already be gone */
    }
  }
}

/* -------------------------------------------------------------------- main -- */

const results = [];
const timings = [];
let browserUp = false;
let profileDir = null;

/**
 * A thrown error is covered by the `finally` below, but an interrupt is not:
 * without this, Ctrl-C mid-run would strand a headless Chrome on the machine.
 */
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (chromeProc && chromeProc.exitCode === null) chromeProc.kill("SIGKILL");
    process.exit(130);
  });
}

try {
  const port = await freePort();
  const profile = makeProfile();
  profileDir = profile;
  const t0 = Date.now();
  launchChrome(port, profile, args.width, args.height);
  await waitForDevTools(port);
  browserUp = true;
  console.log(
    `chrome up on 127.0.0.1:${port} in ${((Date.now() - t0) / 1000).toFixed(1)}s · profile ${profile}\n`,
  );

  for (const [route, label] of ROUTES) {
    const file = join(args.dir, `${slug(route)}.png`);
    const tRoute = Date.now();
    try {
      const info = await shootRoute(port, route, file);
      const ok = existsSync(file);
      const ms = Date.now() - tRoute;
      timings.push(ms);
      results.push({ route, label, file: ok ? file : null, ok, ms, ...info });
      const flags = [
        info.settled ? "" : "UNSETTLED",
        info.fonts ? "" : "fonts-pending",
        info.pageErrors.length ? `js-error(${info.pageErrors.length})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      console.log(`${ok ? "ok  " : "FAIL"} ${route} (${(ms / 1000).toFixed(1)}s)${flags ? ` ${flags}` : ""}`);
    } catch (err) {
      const ms = Date.now() - tRoute;
      timings.push(ms);
      results.push({
        route,
        label,
        file: null,
        ok: false,
        ms,
        settled: false,
        pageErrors: [],
        error: String(err.message).slice(0, 200),
      });
      console.log(`FAIL ${route} — ${String(err.message).slice(0, 140)}`);
    }
  }
} finally {
  // Never leave an orphan browser behind, whatever happened above.
  if (chromeProc && chromeProc.exitCode === null) {
    chromeProc.kill("SIGTERM");
    const gone = await Promise.race([
      new Promise((r) => chromeProc.once("exit", () => r(true))),
      sleep(3000).then(() => false),
    ]);
    if (!gone) chromeProc.kill("SIGKILL");
  }
  // Only now, with the browser gone: it rewrites its profile on shutdown, so
  // removing the directory earlier just left Chrome to recreate the skeleton.
  // Scoped to the temp profile this process created, nothing else.
  if (profileDir && profileDir.startsWith(tmpdir()) && /open11labs-audit-\d+$/.test(profileDir)) {
    rmSync(profileDir, { recursive: true, force: true });
  }
}

const passed = results.filter((r) => r.ok).length;
const unsettled = results.filter((r) => r.ok && !r.settled);
const withJsErrors = results.filter((r) => r.ok && r.pageErrors?.length);
const totalMs = timings.reduce((a, b) => a + b, 0);
const avgMs = timings.length ? totalMs / timings.length : 0;

const lines = [
  "# 视觉复验索引",
  "",
  `生成时间：${new Date().toISOString()}`,
  `视口：${args.width}×${args.height} · 目标：${args.base}`,
  `结果：${passed}/${results.length} 页截图成功`,
  `单页平均：${(avgMs / 1000).toFixed(2)}s（共 ${(totalMs / 1000).toFixed(1)}s，不含浏览器启动）`,
  "",
  "> 这些截图是**复验素材**，不是通过证据。它们不与参考站做像素比对，",
  "> 也不证明功能正确。营销与账号区域按范围裁剪移除，因此不应与原站全图对比。",
  "",
  "| 页面 | 路由 | 截图 | 就绪 |",
  "|---|---|---|---|",
  ...results.map(
    (r) =>
      `| ${r.label} | \`${r.route}\` | ${r.ok ? `[${slug(r.route)}.png](./${slug(r.route)}.png)` : "**失败**"} | ${
        !r.ok
          ? "—"
          : r.settled
            ? `${(r.ms / 1000).toFixed(1)}s${r.pageErrors?.length ? ` · JS 报错 ${r.pageErrors.length}` : ""}`
            : "**未就绪**"
      } |`,
  ),
  "",
];

if (unsettled.length) {
  lines.push(
    `> ⚠️ ${unsettled.length} 页在超时内没有通过就绪检查（应用仍在加载或渲染为空），这些图不可作为外观依据：`,
    ...unsettled.map((r) => `> - \`${r.route}\``),
    "",
  );
}
if (withJsErrors.length) {
  lines.push(
    "> ⚠️ 以下页面在渲染期间抛出 JS 错误，图可能是错误态：",
    ...withJsErrors.map((r) => `> - \`${r.route}\` — ${r.pageErrors[0]}`),
    "",
  );
}

writeFileSync(join(args.dir, "INDEX.md"), lines.join("\n"));
console.log(`\n${passed}/${results.length} -> ${join(args.dir, "INDEX.md")}`);
if (browserUp) console.log("browser closed");
process.exit(passed === results.length ? 0 : 1);
