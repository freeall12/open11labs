import { IconPanel } from "@/lib/icons";

/* Per SCOPE.md the app shell keeps creation navigation, search, the local
   player and local help. Account notifications, the profile avatar, the
   platform switcher and sign-out are removed outright — not hidden, not
   disabled, gone. */

export function TopBar({
  title,
  sidebarOpen,
  onToggleSidebar,
}: {
  title: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <header
      className={`fixed top-0 right-0 left-0 z-30 flex h-[50px] items-center pr-2.5 transition-[padding] duration-150 ${
        sidebarOpen ? "pl-64" : "pl-[10px]"
      }`}
    >
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "关闭侧边栏" : "打开侧边栏"}
        aria-expanded={sidebarOpen}
        data-testid="topbar-sidebar-toggle"
        className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-secondary transition-colors duration-100 hover:bg-gray-alpha-100 hover:text-gray-950"
      >
        <IconPanel size={20} />
      </button>

      <p className="ml-2 whitespace-nowrap text-sm font-medium text-foreground">
        {title}
      </p>
    </header>
  );
}
