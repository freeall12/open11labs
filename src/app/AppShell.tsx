import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { titleForPath } from "@/app/nav-titles";
import { ALL_ROUTES } from "@/app/route-manifest";

/** Fixed header height, measured from the live top bar. */
const HEADER_HEIGHT = 50;

/**
 * Global shell. Owns the one thing every route shares: the sidebar, the top
 * bar, and the offset between them. Pages render through <Outlet />.
 *
 * Per SCOPE.md there is no profile avatar, no account notification bell, no
 * credits pill, no platform switcher and no sign-out — those surfaces are
 * removed, not hidden, and nothing is left behind as an empty slot.
 */
export function AppShell() {
  // Two independent states, because "open" means different things either side
  // of the `lg` breakpoint and conflating them broke narrow viewports: the rail
  // starts expanded on desktop, but the same default would have opened an
  // overlay drawer on top of the home page on first load.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const [railOpen, setRailOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches);
      // Leaving the drawer behind on the way up would cover the page, and
      // opening the rail would leave a stale overlay on the way down.
      if (e.matches) setDrawerOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // A drawer is transient: arriving at a destination dismisses it, which is
  // also what clicking a row inside it does.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const open = isDesktop ? railOpen : drawerOpen;

  // Breadcrumb parent = the route group, taken from the route entry so it
  // follows routes.json instead of a second hard-coded list.
  //
  // Local BYOK pages are the one exception: they are grouped by where the
  // sidebar files them, not by the `owner` field. routes.json tags
  // local-storage-settings as STORAGE, which put "素材 › 存储设置" above a page
  // the sidebar lists under 本地配置 — and the sidebar is the frame every page
  // is read against. Deriving the crumb from the same grouping keeps the two
  // from disagreeing.
  const route = ALL_ROUTES.find((r) => r.path === pathname);
  const crumb = route ? crumbFor(route.id) : undefined;
  const title = titleForPath(pathname);

  // The static <title> in index.html is a single hardcoded string, so without
  // this every route reports itself as the home page in the tab, the history
  // and any screenshot. Follows the same source of truth as the top bar.
  useEffect(() => {
    document.title = `${title} | ElevenLabs`;
  }, [title]);

  return (
    /* `data-sidebar-open` drives the rail width and the content offset, and
       index.css scopes both to `lg` and above — so it tracks the rail alone. */
    <div data-sidebar-open={railOpen} className="flex min-h-100dvh flex-col lg:p-3">
      <Sidebar
        open={open}
        drawer={!isDesktop}
        onCloseDrawer={() => setDrawerOpen(false)}
      />

      <div
        style={{ paddingTop: HEADER_HEIGHT }}
        className="app-content flex min-h-100dvh flex-1 flex-col transition-[padding] duration-150"
      >
        <TopBar
          title={title}
          crumb={crumb}
          sidebarOpen={open}
          onToggleSidebar={() =>
            isDesktop ? setRailOpen((v) => !v) : setDrawerOpen((v) => !v)
          }
        />

        <Outlet />
      </div>
    </div>
  );
}

/**
 * Breadcrumb parents, per route — not per owner.
 *
 * Grouping by owner produced "图像和视频 › 音效", which is wrong: 音效 is a
 * top-level tool in the sidebar, not a page inside the image/video tool. Only
 * the routes the reference actually nests get a parent crumb; everything else
 * shows a single crumb, which is what the reference does on 音效 / 工作室 /
 * Flows / 图像和视频. The three 本地配置 pages are one sidebar section, so they
 * nest under it.
 */
const CRUMB_PARENT: Record<string, string> = {
  "voices-explore": "音色",
  "voice-create-query": "音色",
  "instant-clone": "音色",
  "voice-design": "音色",
  "voice-create-alias": "音色",
  "my-voices": "音色",
  "voice-collection": "音色",
  stt: "语音转文本",
  speakers: "语音转文本",
  "local-provider-settings": "本地配置",
  "local-storage-settings": "本地配置",
  "local-jobs": "本地配置",
};

function crumbFor(id: string): string | undefined {
  return CRUMB_PARENT[id];
}
