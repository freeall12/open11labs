/**
 * Local API client.
 *
 * The server never sets CORS headers, so the only way to reach it is
 * same-origin. In development that is arranged by the Vite proxy; in
 * production the server serves the built app and the API from one port.
 *
 * Session handling: the session cookie is HttpOnly, so JavaScript cannot see
 * it and does not need to. The CSRF token is readable and must be echoed in a
 * header on every mutating request.
 */

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** A conflict is a normal answer, not a failure to hide. */
  get isConflict() {
    return this.status === 409;
  }
  get isAuth() {
    return this.status === 401 || this.status === 403;
  }
}

const BASE = "/api/v1";

let csrfToken: string | null = null;
let bootstrapping: Promise<string> | null = null;

async function bootstrap(): Promise<string> {
  const res = await fetch(`${BASE}/session`, {
    method: "GET",
    // Same-origin only; the cookie comes back HttpOnly and rides along.
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new ApiError(res.status, "SESSION_BOOTSTRAP_FAILED", "无法建立本地会话");
  }
  const body = await res.json();
  csrfToken = body.csrfToken;
  return csrfToken as string;
}

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!bootstrapping) {
    bootstrapping = bootstrap().finally(() => {
      bootstrapping = null;
    });
  }
  return bootstrapping;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Set for endpoints that need the CSRF token echoed. */
  mutate?: boolean;
  /** Send a multipart body instead of JSON. */
  multipart?: boolean;
}

export async function request<T = unknown>(
  path: string,
  {
    method = "GET",
    body,
    mutate = method !== "GET",
    multipart = false,
  }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};

  // The session must exist before *any* request, not just writes: the server
  // requires it for reads too, and the cookie only arrives from the bootstrap.
  const token = await ensureCsrf();

  // FormData must set its own boundary, so no content-type here.
  if (body !== undefined && !multipart) headers["content-type"] = "application/json";
  if (mutate) headers["x-csrf-token"] = token;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const err = (data as { error?: Record<string, unknown> } | null)?.error;
    throw new ApiError(
      res.status,
      (err?.code as string) ?? "UNKNOWN",
      (err?.safeMessage as string) ?? `请求失败（HTTP ${res.status}）`,
      err ?? {},
    );
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/** Drop the cached token so the next call re-bootstraps. */
export function resetSession() {
  csrfToken = null;
}

/* -------------------------------------------------------------- domain -- */

export interface ProviderRecord {
  id: string;
  type: string;
  displayName: string;
  baseURL: string;
  maskedSecret: string;
  validationState:
    | "unconfigured"
    | "unverified"
    | "validating"
    | "available"
    | "auth_failed"
    | "insufficient_scope"
    | "network_error"
    | "removed";
  validatedAt: string | null;
  lastError: string | null;
  createdAt: string;
  rotatedAt: string | null;
}

export interface JobRecord {
  id: string;
  intentId: string;
  type: string;
  providerId: string;
  modelId: string | null;
  status: string;
  revision: number;
  requestId: string | null;
  outputAssetIds: string[];
  error: { code: string; safeMessage: string; submissionCertainty: string } | null;
  createdAt: string;
  updatedAt: string;
}

export const providers = {
  list: () => request<{ providers: ProviderRecord[] }>("/providers").then((r) => r.providers),

  add: (input: { type: string; displayName: string; baseURL: string; secret: string }) =>
    request<{ provider: ProviderRecord }>("/providers", { method: "POST", body: input }).then(
      (r) => r.provider,
    ),

  validate: (id: string) =>
    request<{ provider: ProviderRecord }>(`/providers/${id}/validate`, { method: "POST" }).then(
      (r) => r.provider,
    ),

  rotate: (id: string, secret: string) =>
    request<{ provider: ProviderRecord }>(`/providers/${id}/rotate`, {
      method: "POST",
      body: { secret },
    }).then((r) => r.provider),

  remove: (id: string) => request<{ removed: boolean }>(`/providers/${id}`, { method: "DELETE" }),
};

export interface VoiceRecord {
  voiceId: string;
  name: string;
  category: string | null;
  previewUrl: string | null;
  labels: Record<string, string>;
  availableForTiers: string[] | null;
  unverified: boolean;
}

export const voices = {
  list: () =>
    request<{
      voices: VoiceRecord[];
      reason: string | null;
      needsProvider?: boolean;
    }>("/voices"),
};

export const jobs = {
  list: () => request<{ jobs: JobRecord[] }>("/jobs").then((r) => r.jobs),

  create: (input: {
    intentId: string;
    type: string;
    providerId: string;
    modelId?: string;
    credentialRef: string;
    input: Record<string, unknown>;
  }) =>
    request<{ job: JobRecord; created: boolean }>("/jobs", { method: "POST", body: input }),

  cancel: (id: string) =>
    request<{ job: JobRecord; scope: { stops: string; doesNot: string[] } }>(
      `/jobs/${id}/cancel`,
      { method: "POST" },
    ),

  /**
   * Execute one step. The server refuses to run a job that is in flight,
   * already succeeded, or of unknown submission, so a double click is safe.
   */
  run: (id: string) =>
    request<{ job: JobRecord; asset: AssetRecord | null; reason: string | null }>(
      `/jobs/${id}/run`,
      { method: "POST" },
    ),

  /** One polling step for an asynchronous job. */
  poll: (id: string) =>
    request<{
      job: JobRecord;
      asset: AssetRecord | null;
      reason: string | null;
      stillRunning: boolean;
      remoteSucceeded: boolean;
    }>(`/jobs/${id}/poll`, { method: "POST" }),
};

export interface AssetRecord {
  id: string;
  url: string;
  displayName: string;
  mediaType: string;
  byteSize: number;
  origin: string;
  licenseSource: string | null;
}

export interface CostSummary {
  money: { currency: string; total: number; entries: number }[];
  usage: { unit: string; total: number; entries: number }[];
  unknown: { count: number; note: string | null };
}

export const cost = {
  summary: () =>
    request<{
      summary: CostSummary;
      budget: { limit: number | null; currency: string };
      scope: { controls: string; doesNotControl: string[] };
    }>("/cost"),
  setBudget: (limit: number | null, currency = "USD") =>
    request<{ budget: { limit: number | null; currency: string } }>("/cost/budget", {
      method: "POST",
      body: { limit, currency },
    }),
};

export const assets = {
  list: () =>
    request<{ assets: AssetRecord[]; usage: { totalBytes: number; count: number } }>(
      "/assets",
    ).then((r) => ({ ...r, assets: r.assets })),

  /**
   * Upload a file. Uses FormData so the browser sets the multipart boundary;
   * the session cookie rides along and CSRF is echoed because this is a write.
   */
  remove: (id: string) => request<{ removed: boolean }>(`/assets/${id}`, { method: "DELETE" }),

  /** Read a stored text asset (transcript) through the controlled URL. */
  readText: async (id: string) => {
    const res = await fetch(`${BASE}/assets/${id}`, { credentials: "same-origin" });
    if (!res.ok) throw new ApiError(res.status, "ASSET_READ_FAILED", "无法读取产物");
    return res.text();
  },

  /** Local analysis — no provider involved. */
  probe: (id: string) =>
    request<{
      supported: boolean;
      format: string;
      durationSeconds: number | null;
      reason: string | null;
      waveform: number[] | null;
      silenceSpans: [number, number][] | null;
      computedBy: "local";
    }>(`/assets/${id}/probe`),

  folders: () =>
    request<{ folders: { id: string; name: string; parentId: string | null }[] }>(
      "/folders",
    ).then((r) => r.folders),

  createFolder: (name: string) =>
    request<{ folder: { id: string; name: string } }>("/folders", {
      method: "POST",
      body: { name },
    }).then((r) => r.folder),

  upload: (file: File) => {
    const form = new FormData();
    form.set("file", file, file.name);
    return request<{ asset: AssetRecord; created: boolean }>("/assets", {
      method: "POST",
      body: form,
    });
  },
};

export const projects = {
  list: () => request<{ projects: ProjectRecord[] }>("/projects").then((r) => r.projects),

  create: (input: { kind: string; name: string; content?: Record<string, unknown> }) =>
    request<{ project: ProjectRecord }>("/projects", { method: "POST", body: input }).then(
      (r) => r.project,
    ),

  /**
   * Derive a variant: same structure, a few variables swapped. Reuses existing
   * assets and does not re-run any generation.
   */
  deriveVariant: (id: string, variables: Record<string, unknown>, name?: string) =>
    request<{ project: ProjectRecord }>(`/projects/${id}/variants`, {
      method: "POST",
      body: { variables, name },
    }).then((r) => r.project),
};

export interface ProjectRecord {
  id: string;
  kind: string;
  name: string;
  revision: number;
  schemaVersion: number | null;
  content: Record<string, unknown> & {
    variables?: Record<string, unknown>;
    derivedFrom?: { id: string; revision: number; changed: string[] };
  };
  assetRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export const backup = {
  create: () => request<{ bundle: unknown; sha256: string }>("/backup", { method: "POST" }),
  validate: (bundle: unknown) =>
    request<{ valid: boolean; counts?: { projects: number; assets: number } }>(
      "/backup/validate",
      { method: "POST", body: bundle },
    ),
};
