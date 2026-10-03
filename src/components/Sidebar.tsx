import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LOCAL_NAV,
  PINNED_NAV,
  PENDING_TOOL_LABELS,
  PRIMARY_NAV,
  type NavItem,
} from "@/data/navigation";
import { IconMore } from "@/lib/icons";
import { PENDING_ROUTES } from "@/app/route-manifest";

/* ==========================================================================
   Sidebar.

   Order, glyphs and row geometry follow the reference. Three things are
   removed rather than hidden, per SCOPE.md: the account avatar, the
   platform switcher ("ElevenCreative / 切换") and the credits pill. Nothing
   is left as an empty slot — the rail closes after 更多工具, and the local
   BYOK configuration sits below it because those pages are additions.

   Rows are real router links. A row that is not the current page must not
   reload the document, and the current row must be derived from the URL
   rather than hard-coded.

   Pinning: the reference shows a 取消固定 <name> control on every row of the
   已置顶 section and a 置顶 <name> control on every 更多工具 entry — buttons.csv
   records all ten unpin controls on all 30 observed routes, and
   interaction-findings.md records the four pin controls on the home page. This
   build implements both, and keeps an unpinned tool reachable from 更多工具 so
   unpinning never removes a destination. Upstream never exercised pin
   persistence (it is on interaction-findings' not-tested list), so the
   persistence here is a local decision, not a replica of observed behaviour.
   ========================================================================== */

/** Destinations with no place in the main rail but a real route in this build. */
const MORE_TOOLS: { label: string; href: string }[] = [
  { label: "音频检测", href: "/app/audio-detector" },
  { label: "生成历史", href: "/app/image-video/history" },
  { label: "音乐历史", href: "/app/music/history" },
  { label: "音效历史", href: "/app/sound-effects/history" },
  { label: "音效收藏", href: "/app/sound-effects/favorites" },
  { label: "音乐收藏", href: "/app/music/saved" },
];

/**
 * Pin state is a UI preference, not data, so localStorage is the right place
 * for it. Keys stay namespaced and hold nothing but tool labels.
 */
const PIN_STORE = "11labs.sidebar.pinned";

function readPinned(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PIN_STORE);
    if (!raw) return new Set(PINNED_NAV.map((i) => i.label));
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("bad shape");
    const known = new Set(PINNED_NAV.map((i) => i.label));
    // Unknown labels are dropped rather than rendered: a stale key must not be
    // able to conjure a row for a tool that no longer exists.
    return new Set(parsed.filter((v): v is string => typeof v === "string" && known.has(v)));
  } catch {
    // Private-mode or corrupt value: fall back to the reference default, in
    // which every tool starts pinned.
    return new Set(PINNED_NAV.map((i) => i.label));
  }
}

function isCurrent(pathname: string, href: string): boolean {
  const [path] = href.split("?");
  return pathname === path;
}

function NavRow({
  item,
  onUnpin,
  onNavigate,
}: {
  item: NavItem;
  onUnpin?: (label: string) => void;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const active = isCurrent(pathname, item.href);

  return (
    <li className="w-full">
      <Link
        to={item.href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={`focus-ring group/row flex items-center gap-2 rounded-lg px-2 transition-colors ${
          active
            ? "bg-gray-alpha-100 text-gray-950"
            : "text-secondary hover:bg-gray-alpha-50 hover:text-gray-950"
        }`}
      >
        <span className="flex h-8 w-5 shrink-0 items-center justify-center">
          <item.icon size={20} />
        </span>
        <span className="flex h-8 flex-1 items-center justify-between">
          <span className="truncate text-sm font-medium">{item.label}</span>

          {item.action && (
            <span
              role="presentation"
              onClick={(e) => {
                // The "+" is its own destination; stop it from also firing the
                // parent row's navigation.
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <Link
                to={item.action.href}
                aria-label={item.action.label}
                title={item.action.label}
                className="focus-ring rounded p-0.5 text-secondary hover:text-gray-950"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M8 3.5v9M3.5 8h9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </Link>
            </span>
          )}

          {onUnpin && (
            <span
              role="presentation"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <button
                type="button"
                onClick={() => onUnpin(item.label)}
                /* Label copied from the reference a11y tree, which uses exactly
                   this string on every pinned row. */
                aria-label={`取消固定 ${item.label}`}
                title={`取消固定 ${item.label}`}
                className="focus-ring rounded p-0.5 text-subtle transition-colors hover:text-gray-950"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M8 2.2l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.9l-3.8 2.1.7-4.3-3.1-3 4.3-.6L8 2.2z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function Sidebar({
  open,
  drawer,
  onCloseDrawer,
}: {
  open: boolean;
  /** True below `lg`, where the rail becomes a modal drawer instead. */
  drawer: boolean;
  onCloseDrawer: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [pinned, setPinned] = useState<Set<string>>(() => readPinned());
  const { pathname } = useLocation();

  // Escape closes the drawer, and the page behind it must not scroll while it
  // is up. The rail needs neither: it is always on screen at `lg`.
  useEffect(() => {
    if (!drawer || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseDrawer();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [drawer, open, onCloseDrawer]);

  // Read on mount only; writing is explicit, so this cannot loop.
  useEffect(() => {
    setPinned(readPinned());
  }, []);

  const persist = useCallback((next: Set<string>) => {
    setPinned(next);
    try {
      window.localStorage.setItem(PIN_STORE, JSON.stringify([...next]));
    } catch {
      // A blocked or full store must not break navigation; the state simply
      // does not survive a reload this session.
    }
  }, []);

  const unpin = useCallback(
    (label: string) => {
      const next = new Set(pinned);
      next.delete(label);
      persist(next);
      // Open 更多工具 so the tool it removed is visibly still reachable rather
      // than looking deleted.
      setMoreOpen(true);
    },
    [pinned, persist],
  );

  const pin = useCallback(
    (label: string) => {
      const next = new Set(pinned);
      next.add(label);
      persist(next);
    },
    [pinned, persist],
  );

  const pinnedItems = PINNED_NAV.filter((i) => pinned.has(i.label));
  const unpinnedItems = PINNED_NAV.filter((i) => !pinned.has(i.label));

  /* Following a link must dismiss the drawer. On the rail there is nothing to
     dismiss, so this collapses to closing the sub-list. */
  const afterNavigate = useCallback(() => {
    setMoreOpen(false);
    if (drawer) onCloseDrawer();
  }, [drawer, onCloseDrawer]);

  return (
    <>
      {drawer && open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={onCloseDrawer}
          aria-hidden="true"
        />
      )}

      <aside
        aria-expanded={open}
        aria-label="主导航"
        /* Width is owned by .app-sidebar in index.css, and that declaration is
           unlayered, so a `w-*` utility cannot override it. The drawer's width
           therefore has to be inline — an inline style outranks the stylesheet
           — and is passed only while the drawer is showing, leaving the rail's
           collapse behaviour untouched at `lg`. */
        style={drawer ? { width: 256 } : undefined}
        className={`app-sidebar group/sidebar fixed top-0 left-0 z-40 h-full overflow-hidden border-r bg-background/90 backdrop-blur-md transition-[width] duration-150 ${
          drawer ? (open ? "block" : "hidden") : "hidden lg:block"
        }`}
      >
      <div className="stack h-full w-full overflow-hidden">
        <div className="flex h-[50px] shrink-0 items-center px-4">
          <Link
            to="/app/home"
            className="focus-ring font-waldenburg text-[15px] font-medium tracking-tight text-foreground"
          >
            11Labs
          </Link>
        </div>

        {/* `min-h-0 flex-1`, not `h-full`: `h-full` under the 50px header
            overflowed the viewport by 50px, which pushed the drawer's footer
            below the fold. */}
        <nav className="flex min-h-0 flex-1 flex-col">
          <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
            <ul className="stack w-full grow gap-4 px-3 pt-1">
              <li>
                <ul className="stack gap-1">
                  {PRIMARY_NAV.map((item) => (
                    <NavRow key={item.href} item={item} onNavigate={afterNavigate} />
                  ))}
                </ul>
              </li>

              <li aria-label="已置顶">
                {/* Section label copied verbatim from the reference a11y tree
                    (001/002: list_item "已置顶" > heading "已置顶"). */}
                <h2 className="mb-1.5 ml-2 text-sm font-medium text-secondary">已置顶</h2>
                <ul className="stack gap-1">
                  {pinnedItems.map((item) => (
                    <NavRow key={item.href} item={item} onUnpin={unpin} onNavigate={afterNavigate} />
                  ))}

                  <li>
                    <button
                      type="button"
                      onClick={() => setMoreOpen((v) => !v)}
                      aria-expanded={moreOpen}
                      aria-label="更多工具"
                      className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 text-secondary transition-colors hover:bg-gray-alpha-50 hover:text-gray-950"
                    >
                      <span className="flex h-8 w-5 shrink-0 items-center justify-center">
                        <IconMore size={20} />
                      </span>
                      <span className="flex h-8 flex-1 items-center justify-between">
                        <span className="text-sm font-medium">更多工具</span>
                        {/* 001/002 show the row as icon + label only; the chevron
                            is an added affordance and appears in 003, where the
                            sub-list is expanded. Rendering it at rest would claim
                            a disclosure the closed row does not have. */}
                        {moreOpen && (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="none"
                            aria-hidden="true"
                            className="transition-transform"
                          >
                            <path
                              d="M4.5 3L7.5 6l-3 3"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                    </button>

                    {moreOpen && (
                      <ul className="mt-1 ml-7 stack gap-0.5 border-l border-gray-alpha-150 pl-2">
                        {/* The reference lists these four first (003-more-tools),
                            sourced from the pending routes themselves. */}
                        {PENDING_ROUTES.map((r) => (
                          <li key={r.id}>
                            <span
                              title="上游路径尚未采集，按 routes.json 规则不猜 URL"
                              className="block cursor-not-allowed rounded px-2 py-1.5 text-sm text-subtle"
                            >
                              {PENDING_TOOL_LABELS[r.id] ?? r.id}
                              <span className="ml-1 text-xs">（待补采）</span>
                            </span>
                          </li>
                        ))}

                        {/* Unpinned tools live here so unpinning a row relocates
                            the destination instead of deleting it. */}
                        {unpinnedItems.map((item) => {
                          // An unpinned row must not cost the page its active
                          // state: if the URL is this tool, the submenu entry is
                          // the row that should read as current.
                          const active = isCurrent(pathname, item.href);
                          return (
                            <li key={item.href} className="flex items-center gap-1">
                              <Link
                                to={item.href}
                                aria-current={active ? "page" : undefined}
                                onClick={afterNavigate}
                                className={`focus-ring block flex-1 rounded px-2 py-1.5 text-sm transition-colors ${
                                  active
                                    ? "bg-gray-alpha-100 font-medium text-gray-950"
                                    : "text-secondary hover:bg-gray-alpha-50 hover:text-gray-950"
                                }`}
                              >
                                {item.label}
                              </Link>
                              <button
                                type="button"
                                onClick={() => pin(item.label)}
                                aria-label={`置顶 ${item.label}`}
                                title={`置顶 ${item.label}`}
                                className="focus-ring shrink-0 rounded p-1 text-subtle transition-colors hover:text-gray-950"
                              >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                  <path
                                    d="M8 2.2l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.9l-3.8 2.1.7-4.3-3.1-3 4.3-.6L8 2.2z"
                                    stroke="currentColor"
                                    strokeWidth="1.3"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            </li>
                          );
                        })}

                        {MORE_TOOLS.map((t) => (
                          <li key={t.href}>
                            <Link
                              to={t.href}
                              onClick={afterNavigate}
                              className="focus-ring block rounded px-2 py-1.5 text-sm text-secondary transition-colors hover:bg-gray-alpha-50 hover:text-gray-950"
                            >
                              {t.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                </ul>
              </li>

              <li aria-label="本地配置">
                <h2 className="mb-1.5 ml-2 text-sm font-medium text-secondary">本地配置</h2>
                <ul className="stack gap-1">
                  {LOCAL_NAV.map((item) => (
                    <NavRow key={item.href} item={item} onNavigate={afterNavigate} />
                  ))}
                </ul>
                <p className="mt-2 ml-2 text-xs text-subtle">
                  本地 BYOK 配置，非原站页面。
                </p>
              </li>
            </ul>
          </div>

          {/* Reference 001 keeps a close control in a second list at the foot of
              the drawer. It has no place on the permanent rail, which is not
              dismissible. It sits outside the scroll container so the long
              navigation list scrolls behind it instead of pushing it off
              screen. */}
          {drawer && open && (
            <ul className="shrink-0 border-t border-gray-alpha-100 p-2">
              <li>
                <button
                  type="button"
                  onClick={onCloseDrawer}
                  aria-label="关闭"
                  className="focus-ring flex h-9 w-full items-center justify-center rounded-lg text-sm text-secondary transition-colors hover:bg-gray-alpha-50 hover:text-gray-950"
                >
                  关闭
                </button>
              </li>
            </ul>
          )}
        </nav>
      </div>
    </aside>
    </>
  );
}
