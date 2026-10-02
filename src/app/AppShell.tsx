import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { titleForPath } from "@/app/nav-titles";

/** Fixed header height, measured from the live top bar. */
const HEADER_HEIGHT = 50;

/**
 * Global shell. Owns the one thing every route shares: the sidebar, the top
 * bar, and the offset between them. Pages render through <Outlet />.
 *
 * Per SCOPE.md there is no profile avatar, no account notification bell, no
 * platform switcher and no sign-out — those surfaces are removed, not hidden.
 */
export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <div
      data-sidebar-open={sidebarOpen}
      className="flex min-h-100dvh flex-col lg:p-3"
    >
      <Sidebar open={sidebarOpen} />

      <div
        style={{ paddingTop: HEADER_HEIGHT }}
        className="app-content flex min-h-100dvh flex-1 flex-col transition-[padding] duration-150"
      >
        <TopBar
          title={titleForPath(pathname)}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />

        <Outlet />
      </div>
    </div>
  );
}
