import routesJson from "../../specs/routes.json";

/* ==========================================================================
   Route manifest.

   Derived directly from specs/routes.json so the spec file stays the single
   source of truth: mark a route `disposition: "excluded"` there and it stops
   being routable here with no second edit.

   Three classes are deliberately not routable:
     - `disposition: "excluded"`  — out of scope per SCOPE.md
     - `path: null`              — upstream URL not yet discovered; guessing
                                   one is explicitly forbidden
     - `kind: "modal-query"` / `"mode-query"` — not separate pages, they are
                                   query states of the page in the same
                                   `owner`, handled by that page's component
   ========================================================================== */

export type RouteKind =
  | "page"
  | "modal-query"
  | "mode-query"
  | "dynamic-page"
  | "local-extension"
  | "pending-discovery";

export interface RouteEntry {
  id: string;
  path: string | null;
  kind: RouteKind;
  owner: string;
  phase: string;
  coverage: string;
  spec: string;
  evidence: string[];
  /** Present only on out-of-scope routes. */
  disposition?: "excluded";
  excludeReason?: string;
  adaptation?: string;
  /** Human description of where a `pending-discovery` route is entered from. */
  entry?: string;
}

export const ALL_ROUTES = routesJson.routes as RouteEntry[];

/** Out of scope per SCOPE.md — never routed, never linked. */
export const EXCLUDED_ROUTES = ALL_ROUTES.filter(
  (r) => r.disposition === "excluded",
);

/**
 * Local dynamic routes.
 *
 * routes.json marks `studio-editor` as `path: null` because the upstream URL
 * was never captured, and guessing one is forbidden. This build does have a
 * studio editor — it is reached from a project the user just created, so its
 * URL is derived from a real local id rather than invented from the upstream
 * site. It is declared here, next to the other local-only routes, because it
 * is a local decision and not a replica of an upstream path.
 */
export const LOCAL_DYNAMIC_ROUTES = [
  { id: "studio-editor", pattern: "/app/studio/:id" },
];

/** Ids served by a local pattern, so they are not "awaiting evidence". */
const LOCAL_ROUTE_IDS = new Set(LOCAL_DYNAMIC_ROUTES.map((r) => r.id));

/**
 * Upstream URL not yet discovered. Blocked on research, not on guesswork.
 *
 * Routes this build reaches through a locally-derived path are excluded:
 * `studio-editor` is `path: null` upstream, but LOCAL_DYNAMIC_ROUTES below
 * gives it a real local URL, so listing it as "awaiting evidence" would be
 * false — and the sidebar renders this list verbatim as disabled rows.
 */
export const PENDING_ROUTES = ALL_ROUTES.filter(
  (r) => !r.disposition && r.path === null && !LOCAL_ROUTE_IDS.has(r.id),
);

/** Query-state routes resolve to the page component of the same `owner`. */
export const QUERY_STATE_ROUTES = ALL_ROUTES.filter(
  (r) => r.kind === "modal-query" || r.kind === "mode-query",
);

/** Which real page each query-state route belongs to. */
export const QUERY_STATE_OWNER: Record<string, string> = {
  "voice-create-query": "voices-explore",
  "instant-clone": "voices-explore",
  "voice-design": "voices-explore",
  "image-mode": "image-video",
  "video-mode": "image-video",
  "lipsync-mode": "image-video",
};


/**
 * Real navigable pages.
 *
 * Query-state routes are deliberately absent: `/app/image-video?modality=video`
 * is the image-video page in a different mode, not a second page. Registering
 * it as its own route is exactly the "many URLs, one component" shape that
 * R1-AC01 forbids.
 */
export const ROUTABLE_ROUTES = ALL_ROUTES.filter(
  (r) =>
    !r.disposition &&
    r.path !== null &&
    (r.kind === "page" || r.kind === "dynamic-page" || r.kind === "local-extension"),
);

export function routeById(id: string): RouteEntry | undefined {
  return ALL_ROUTES.find((r) => r.id === id);
}

export function isExcluded(id: string): boolean {
  return routeById(id)?.disposition === "excluded";
}

/** Every path the app must refuse to serve, with the reason recorded. */
export const EXCLUDED_PATHS = EXCLUDED_ROUTES.filter(
  (r): r is RouteEntry & { path: string } => r.path !== null,
).map((r) => ({ path: r.path, id: r.id, reason: r.excludeReason ?? "" }));

/* ------------------------------------------------------ local extensions -- */
/* Routes that exist only in the BYOK build. They are not part of the
   upstream surface, so they are declared here rather than in routes.json. */

export interface LocalRoute {
  id: string;
  path: string;
  title: string;
  summary: string;
}

export const LOCAL_ROUTES: LocalRoute[] = [
  {
    id: "local-provider-settings",
    path: "/local/settings/providers",
    title: "Provider 与密钥",
    summary: "录入你自己的 API 密钥、验证连通性、选择模型来源",
  },
  {
    id: "local-storage-settings",
    path: "/local/settings/storage",
    title: "存储设置",
    summary: "本地数据目录、容量、备份与恢复",
  },
  {
    id: "local-jobs",
    path: "/local/jobs",
    title: "任务队列",
    summary: "提交记录、状态、费用账本与未知提交处理",
  },
];
