/* ==========================================================================
   Local HTTP server.

   One origin: the built SPA and the API are served from the same port, so the
   browser never makes a cross-origin request to reach the key vault. No CORS
   headers are emitted at all — that is deliberate, because "allow *" is what
   would let a random page drive this server.

   Binds to loopback only. Binding 0.0.0.0 is never a fallback for a failed
   local connection; see docs/architecture/security.md.
   ========================================================================== */

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, extname, resolve } from "node:path";

const joinPath = join;

import {
  RequestRejected,
  SessionStore,
  SESSION_COOKIE,
  assertCsrf,
  assertHost,
  assertOrigin,
  guard,
  parseCookies,
  sessionCookie,
} from "./lib/security.mjs";
import { Vault, toPublic } from "./lib/vault.mjs";
import * as providers from "../packages/providers/elevenlabs/adapter.mjs";
import { openDb, getSetting, setSetting } from "./lib/db.mjs";
import { JobStore } from "./lib/jobs.mjs";
import { CostLedger } from "./lib/cost.mjs";
import { AssetStore } from "./lib/assets.mjs";
import { ProjectStore, RevisionConflictError } from "./lib/projects.mjs";
import { buildBundle, validateBundle, writeBundle } from "./lib/backup.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
};

/* ------------------------------------------------------------ logging -- */

const SECRET_KEYS = new Set([
  "secret",
  "apikey",
  "api_key",
  "x-api-key",
  "authorization",
  "token",
  "password",
]);

/** Log a request without ever writing a secret. */
function safeLog(entry) {
  const redacted = {};
  for (const [k, v] of Object.entries(entry)) {
    redacted[k] = SECRET_KEYS.has(k.toLowerCase()) ? "[redacted]" : v;
  }
  console.log(JSON.stringify({ t: new Date().toISOString(), ...redacted }));
}

/* ------------------------------------------------------------- helpers -- */

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

async function readJsonBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new RequestRejected(413, "BODY_TOO_LARGE", `${size} bytes`);
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestRejected(400, "BAD_JSON", "body is not valid JSON");
  }
}

/* -------------------------------------------------------------- static -- */

/**
 * Serve the built SPA. Paths are resolved inside `root` and anything that
 * escapes it is refused, so a crafted URL cannot read the filesystem.
 */
function serveStatic(root, urlPath, res) {
  const rootResolved = resolve(root);
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const candidate = resolve(join(rootResolved, normalize(decoded)));

  if (candidate !== rootResolved && !candidate.startsWith(rootResolved + "/")) {
    json(res, 403, { error: { code: "PATH_ESCAPE", message: "forbidden" } });
    return;
  }

  let file = candidate;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // SPA history fallback: unknown paths are client routes, not 404s here.
    // The client decides what is genuinely unknown (see StatusPages.tsx).
    file = join(rootResolved, "index.html");
  }
  if (!existsSync(file)) {
    json(res, 503, {
      error: {
        code: "NOT_BUILT",
        message: "web build missing — run `npm run build`",
      },
    });
    return;
  }

  const type = MIME[extname(file)] ?? "application/octet-stream";
  const immutable = file.includes(`${"/assets/"}`) || extname(file) === ".woff2";
  res.writeHead(200, {
    "content-type": type,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  createReadStream(file).pipe(res);
}

/* ----------------------------------------------------------------- api -- */

function createApi({ vault, sessions, log, providerAdapters = providers, port, jobs, cost, assets, projects, dataDir }) {
  return async function handleApi(req, res, urlPath) {
    /* -- session bootstrap ------------------------------------------- */
    if (urlPath === "/api/v1/session" && req.method === "GET") {
      // Host and Origin still apply: a cross-site page must not be able to
      // mint a session, and without CORS headers it cannot read this anyway.
      assertHost(req, port());
      const origin = req.headers.origin;
      // Force the mutating path: an IncomingMessage is not safely spreadable,
      // and the check only matters for writes.
      if (origin) {
        assertOrigin({ method: "POST", headers: req.headers }, port());
      }

      const session = sessions.issue();
      return json(
        res,
        200,
        { csrfToken: session.csrf, createdAt: session.createdAt },
        { "set-cookie": sessionCookie(session.id, port()) },
      );
    }

    /* -- everything below needs a full guard ------------------------- */
    const session = guard({ req, port: port(), sessions });

    /* -- providers --------------------------------------------------- */
    if (urlPath === "/api/v1/providers") {
      if (req.method === "GET") return json(res, 200, { providers: vault.list() });
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const rec = vault.put(body);
        safeLog({ event: "provider.created", id: rec.id, type: rec.type });
        return json(res, 201, { provider: rec });
      }
    }

    const rotate = urlPath.match(/^\/api\/v1\/providers\/([^/]+)\/rotate$/);
    if (rotate && req.method === "POST") {
      const body = await readJsonBody(req);
      const rec = vault.rotate(rotate[1], body.secret);
      safeLog({ event: "provider.rotated", id: rec.id });
      return json(res, 200, { provider: rec });
    }

    const del = urlPath.match(/^\/api\/v1\/providers\/([^/]+)$/);
    if (del && req.method === "DELETE") {
      const ok = vault.remove(del[1]);
      safeLog({ event: "provider.removed", id: del[1], removed: ok });
      return json(res, ok ? 200 : 404, { removed: ok });
    }

    if (urlPath.startsWith("/api/v1/providers/") && req.method === "GET") {
      const id = urlPath.split("/").pop();
      const rec = vault.get(id);
      return rec
        ? json(res, 200, { provider: rec })
        : json(res, 404, {
            error: { code: "NOT_FOUND", message: "unknown provider" },
          });
    }

    /* -- validation (no generation, no account data) ----------------- */
    const validate = urlPath.match(/^\/api\/v1\/providers\/([^/]+)\/validate$/);
    if (validate && req.method === "POST") {
      const id = validate[1];
      if (!vault.get(id)) {
        return json(res, 404, {
          error: { code: "NOT_FOUND", message: "unknown provider" },
        });
      }

      // A validation call reads the credential in-process. The HTTP layer
      // never sees it, and the adapter only issues a free capability query.
      const secret = vault.useSecret(id);
      try {
        const out = await providerAdapters.elevenlabs.validateCredential(secret);
        const rec = vault.markValidation(id, { state: "available" });
        log({ event: "provider.validated", id, models: out.modelCount });
        return json(res, 200, { provider: rec, result: out });
      } catch (err) {
        const state =
          err?.code === "NETWORK_ERROR"
            ? "network_error"
            : err?.code === "PROVIDER_AUTH_FAILED"
              ? "auth_failed"
              : "unverified";
        const rec = vault.markValidation(id, {
          state,
          error: err?.safeMessage ?? "validation failed",
        });
        log({ event: "provider.validation_failed", id, code: err?.code ?? "?" });
        return json(res, 200, {
          provider: rec,
          error: {
            code: err?.code ?? "INTERNAL",
            safeMessage: err?.safeMessage ?? "validation failed",
            retryable: err?.retryable ?? false,
          },
        });
      }
    }

    /* -- voices ------------------------------------------------------- */
    if (urlPath === "/api/v1/voices" && req.method === "GET") {
      const ids = vault.list().map((p) => p.id);
      for (const id of ids) {
        try {
          const out = await providerAdapters.elevenlabs.listVoices(vault.useSecret(id));
          return json(res, 200, {
            voices: out.voices,
            reason: out.reason,
            providerRequestId: out.requestId,
          });
        } catch (err) {
          log({ event: "voices.failed", id, code: err?.code ?? "?" });
          return json(res, 200, {
            voices: [],
            // A failure is reported, not hidden behind an empty list.
            reason: err?.safeMessage ?? "音色列表不可用",
            error: { code: err?.code ?? "INTERNAL" },
          });
        }
      }
      return json(res, 200, {
        voices: [],
        reason: "尚未配置 Provider",
        needsProvider: true,
      });
    }

    /* -- capabilities ------------------------------------------------ */
    if (urlPath === "/api/v1/capabilities" && req.method === "GET") {
      const ids = vault.list().map((p) => p.id);
      const out = [];
      for (const id of ids) {
        const secret = vault.useSecret(id);
        try {
          out.push(...(await providerAdapters.elevenlabs.listCapabilities(secret)));
        } catch {
          out.push({
            providerId: id,
            modelId: "unknown",
            taskType: "text_to_speech",
            availability: "unverified",
            reason: "能力查询失败，未做猜测",
          });
        }
      }
      return json(res, 200, { capabilities: out });
    }

    /* -- jobs --------------------------------------------------------- */
    if (urlPath === "/api/v1/jobs" && req.method === "GET") {
      return json(res, 200, { jobs: jobs.list() });
    }

    if (urlPath === "/api/v1/jobs" && req.method === "POST") {
      const body = await readJsonBody(req);
      // The client supplies an intent id; the UNIQUE index is what actually
      // prevents a double-click from becoming a second paid submission.
      const { job, created } = jobs.createOrGet({
        intentId: body.intentId,
        type: body.type,
        providerId: body.providerId,
        modelId: body.modelId,
        credentialRef: body.credentialRef,
        input: body.input,
      });
      log({ event: created ? "job.created" : "job.deduped", id: job.id });
      return json(res, created ? 201 : 200, { job, created });
    }

    const jobCancel = urlPath.match(/^\/api\/v1\/jobs\/([^/]+)\/cancel$/);
    if (jobCancel && req.method === "POST") {
      const job = jobs.get(jobCancel[1]);
      if (!job) {
        return json(res, 404, { error: { code: "NOT_FOUND", message: "unknown job" } });
      }
      const decision = jobs.canSubmit(job);
      // Nothing has left the machine, so a draft is simply discarded. Only a
      // job that was on its way needs a cancel request.
      const to = job.status === "draft" ? "cancelled" : "cancel_requested";
      const updated = jobs.transition(job.id, to, {
        cancelRequestedAt: new Date().toISOString(),
      });
      // Cancelling stops local waiting. It is not a refund and it does not
      // claim the provider stopped working.
      return json(res, 200, {
        job: updated,
        scope: {
          stops: to === "cancelled" ? "本地草稿，未提交任何请求" : "本地等待",
          doesNot: ["供应商侧撤销", "退款", "已产生费用的返还"],
          note: decision.ok ? null : decision.reason,
        },
      });
    }

    const jobEvents = urlPath.match(/^\/api\/v1\/jobs\/([^/]+)\/events$/);
    if (jobEvents && req.method === "GET") {
      return json(res, 200, { events: jobs.events(jobEvents[1]) });
    }

    /* -- cost --------------------------------------------------------- */
    if (urlPath === "/api/v1/cost" && req.method === "GET") {
      return json(res, 200, { summary: cost.summary(), budget: cost.budget(), scope: cost.budgetScope() });
    }

    if (urlPath === "/api/v1/cost/budget" && req.method === "POST") {
      const body = await readJsonBody(req);
      return json(res, 200, { budget: cost.setBudget(body) });
    }

    /* -- assets ------------------------------------------------------- */
    if (urlPath === "/api/v1/assets" && req.method === "GET") {
      return json(res, 200, { assets: assets.list(), usage: assets.usage() });
    }

    const assetFile = urlPath.match(/^\/api\/v1\/assets\/([^/]+)$/);
    if (assetFile && req.method === "GET") {
      const rec = assets.get(assetFile[1]);
      if (!rec) {
        return json(res, 404, { error: { code: "NOT_FOUND", message: "unknown asset" } });
      }
      // The path is resolved server-side; the client never sees one.
      const bytes = assets.read(assetFile[1]);
      if (!bytes) {
        return json(res, 404, { error: { code: "ASSET_IMPORT_FAILED", message: "file missing on disk" } });
      }
      res.writeHead(200, {
        "content-type": rec.mediaType,
        "content-length": bytes.byteLength,
        "x-content-type-options": "nosniff",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(rec.displayName)}`,
      });
      return res.end(Buffer.from(bytes));
    }

    /* -- projects ----------------------------------------------------- */
    if (urlPath === "/api/v1/projects" && req.method === "GET") {
      return json(res, 200, { projects: projects.list() });
    }
    if (urlPath === "/api/v1/projects" && req.method === "POST") {
      const body = await readJsonBody(req);
      return json(res, 201, { project: projects.create(body) });
    }

    const projectSave = urlPath.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (projectSave && req.method === "PUT") {
      const body = await readJsonBody(req);
      try {
        return json(res, 200, { project: projects.save(projectSave[1], body) });
      } catch (err) {
        if (err instanceof RevisionConflictError) {
          // Conflict is a real answer, not a server fault.
          return json(res, 409, {
            error: {
              code: err.code,
              safeMessage: err.message,
              expectedRevision: err.expectedRevision,
              actualRevision: err.actualRevision,
            },
          });
        }
        throw err;
      }
    }

    /* -- backup ------------------------------------------------------- */
    if (urlPath === "/api/v1/backup" && req.method === "POST") {
      const bundle = buildBundle({
        projects: projects.list(),
        assets: assets.list(),
        jobs: jobs.list(),
        cost: cost.summary(),
        generatedAt: new Date().toISOString(),
      });
      const out = writeBundle(joinPath(dataDir ?? process.cwd(), "exports"), bundle);
      log({ event: "backup.written", projects: bundle.counts.projects, assets: bundle.counts.assets });
      return json(res, 201, { bundle, sha256: out.sha256 });
    }

    if (urlPath === "/api/v1/backup/validate" && req.method === "POST") {
      const bundle = await readJsonBody(req, 64 * 1024 * 1024);
      try {
        const checked = validateBundle(bundle);
        return json(res, 200, {
          valid: true,
          counts: { projects: checked.projects.length, assets: checked.assets.length },
          totalBytes: checked.totalBytes,
        });
      } catch (err) {
        // A rejected bundle is a client answer, not a server fault.
        return json(res, 400, {
          valid: false,
          error: { code: "VALIDATION_ERROR", safeMessage: err.message },
        });
      }
    }

    /* -- vault health ------------------------------------------------ */
    if (urlPath === "/api/v1/vault" && req.method === "GET") {
      return json(res, 200, {
        persistent: vault.isPersistent,
        count: vault.size,
        // Proves the API surface cannot return secret material: no endpoint
        // anywhere calls useSecret().
        writeOnly: true,
      });
    }

    return json(res, 404, {
      error: { code: "NO_SUCH_ENDPOINT", message: "unknown local endpoint" },
    });
  };
}

/* ------------------------------------------------------------- server -- */

export function createLocalServer({
  root,
  vault,
  port: listenPort,
  dbPath = ":memory:",
  dataDir = null,
  log = safeLog,
  providerAdapters,
}) {
  const sessions = new SessionStore();
  const db = openDb(dbPath);
  const jobs = new JobStore({ db });
  const cost = new CostLedger({ db });
  // Assets and projects only need a real root when the server has a data dir;
  // tests run entirely in memory.
  const store = dataDir ? { db, root: dataDir } : { db, root: process.cwd() };
  const assets = new AssetStore(store);
  const projects = new ProjectStore({ db });

  // Anything caught mid-submit by a previous process is unresolvable until
  // someone checks upstream. Mark it before accepting new work.
  const reconciled = jobs.reconcileAfterRestart();
  if (reconciled) log({ event: "jobs.reconciled", count: reconciled });

  // The listener may bind an ephemeral port (0), so the Host allowlist cannot
  // be frozen at construction. One mutable value, shared by both closures.
  let actualPort = listenPort;
  const port = () => actualPort;

  const api = createApi({
    vault,
    sessions,
    log,
    providerAdapters,
    port,
    jobs,
    cost,
    assets,
    projects,
    dataDir,
  });

  const server = createServer(async (req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0];

    try {
      if (urlPath.startsWith("/api/")) {
        await api(req, res, urlPath);
      } else {
        assertHost(req, port());
        serveStatic(root, urlPath, res);
      }
    } catch (err) {
      if (err instanceof RequestRejected) {
        log({ event: "rejected", code: err.code, path: urlPath });
        return json(res, err.status, {
          error: { code: err.code, message: err.message },
        });
      }
      // Unexpected: report a safe message, keep the detail in the local log.
      log({ event: "error", path: urlPath, message: err?.message });
      return json(res, 500, {
        error: { code: "INTERNAL", message: "internal error" },
      });
    }
  });

  return {
    server,
    sessions,
    vault,
    /** Call after listen() when binding port 0, so Host checks use the real port. */
    /** Exposed for tests and for the CLI's startup summary. */
    jobs,
    cost,
    db,
    adoptActualPort() {
      const addr = server.address();
      if (addr && typeof addr === "object") actualPort = addr.port;
    },
  };
}

export { safeLog, parseCookies, SESSION_COOKIE, assertCsrf, toPublic };
