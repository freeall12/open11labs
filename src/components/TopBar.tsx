import { IconBell, IconPanel } from "@/lib/icons";

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
        className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-secondary transition-colors duration-100 hover:bg-gray-alpha-100 hover:text-gray-950"
      >
        <IconPanel size={20} />
      </button>

      <p className="ml-2 whitespace-nowrap text-sm font-medium text-foreground">
        {title}
      </p>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label="通知"
          className="focus-ring relative flex h-9 w-9 items-center justify-center rounded-full text-secondary transition-colors duration-100 hover:bg-gray-alpha-100 hover:text-gray-950"
        >
          <IconBell size={18} />
          {/* Unread marker. Hide this when the notification count is zero. */}
          <span className="absolute top-[7px] right-[7px] size-2 rounded-full bg-blue-500" />
        </button>

        <button
          type="button"
          aria-label="个人资料"
          className="focus-ring flex h-9 w-9 items-center justify-center rounded-full"
        >
          <span className="flex size-[23px] items-center justify-center overflow-hidden rounded-full bg-linear-to-br from-orange-300 to-rose-400 text-[10px] font-semibold text-white">
            C
          </span>
        </button>
      </div>
    </header>
  );
}
