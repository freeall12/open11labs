import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconPanel, IconSearch } from "@/lib/icons";
import { GlobalSearch } from "@/components/GlobalSearch";

/* ==========================================================================
   Top bar.

   Reference layout, left to right: sidebar toggle, breadcrumb, centred
   search with the ⌘K hint, then the help cluster.

   Removed per SCOPE.md, not hidden: the credits pill, the account
   notification bell and the profile avatar. The feedback/docs entries are
   kept as **local** help — they open the in-app help panel rather than the
   upstream marketing site, because this build must not route a user out to
   an account-gated page.
   ========================================================================== */

export function TopBar({
  title,
  crumb,
  sidebarOpen,
  onToggleSidebar,
}: {
  title: string;
  /** Parent segment of the breadcrumb, e.g. "语音转文本" on the STT page. */
  crumb?: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const navigate = useNavigate();
  const searchRef = useRef<HTMLButtonElement>(null);

  // ⌘K / Ctrl+K opens search from anywhere, matching the hint in the field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header
      /* `pl-64` must not apply below `lg`: the rail does not exist there (the
         drawer does), so a 256px left inset there pushed the breadcrumb and
         search off-centre for a sidebar that was never painted. 10px is the
         collapsed-rail inset, and it is the right one for the drawer too since
         the drawer floats above the content. */
      className={`fixed top-0 right-0 left-0 z-30 flex h-[50px] items-center pr-2.5 pl-[10px] transition-[padding] duration-150 ${
        sidebarOpen ? "lg:pl-64" : ""
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

      <nav aria-label="面包屑" className="ml-2 flex min-w-0 items-center gap-1.5">
        {crumb && (
          <>
            <button
              type="button"
              onClick={() => navigate("/app/home")}
              className="focus-ring truncate text-sm text-secondary transition-colors hover:text-foreground"
            >
              {crumb}
            </button>
            <span aria-hidden="true" className="text-subtle">
              ›
            </span>
          </>
        )}
        <p className="truncate text-sm font-medium text-foreground">{title}</p>
      </nav>

      <div className="flex flex-1 justify-center px-4">
        <button
          ref={searchRef}
          type="button"
          onClick={() => setSearchOpen(true)}
          data-testid="topbar-search"
          className="focus-ring flex h-8 w-full max-w-[255px] items-center gap-2 rounded-[10px] border border-gray-alpha-150 bg-background px-3 text-sm text-subtle transition-colors hover:border-gray-alpha-200 hover:text-secondary"
        >
          <IconSearch size={15} />
          <span className="flex-1 text-left">搜索所有内容…</span>
          <kbd className="rounded border border-gray-alpha-150 px-1 text-[10px] leading-4 text-subtle">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="focus-ring hidden h-8 items-center rounded-[10px] px-2.5 text-sm text-secondary transition-colors hover:bg-gray-alpha-50 hover:text-foreground sm:flex"
        >
          本地帮助
        </button>
        <button
          type="button"
          onClick={() => navigate("/local/jobs")}
          className="focus-ring hidden h-8 items-center rounded-[10px] px-2.5 text-sm text-secondary transition-colors hover:bg-gray-alpha-50 hover:text-foreground sm:flex"
        >
          任务与费用
        </button>
      </div>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </header>
  );
}

/* -------------------------------------------------------------- help -- */

function HelpPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="本地帮助">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-background p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-waldenburg text-xl text-foreground">本地帮助</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="focus-ring rounded-[10px] p-1 text-secondary hover:bg-gray-alpha-50"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="mt-6 stack gap-5 text-sm">
          <section className="stack gap-1.5">
            <h3 className="font-medium text-foreground">这个版本是什么</h3>
            <p className="text-secondary">
              本地运行、用户自带密钥（BYOK）的创作工具复刻。界面、编排与存储在你的设备上，
              模型推理仍然走你自己的 Provider 账户，需要网络。
            </p>
          </section>

          <section className="stack gap-1.5">
            <h3 className="font-medium text-foreground">先配置密钥</h3>
            <p className="text-secondary">
              在「本地配置 → Provider 与密钥」录入你自己的 API 密钥，验证通过后才能真实生成。
              密钥只经本地服务端使用，不会进入前端 bundle 或浏览器存储。
            </p>
          </section>

          <section className="stack gap-1.5">
            <h3 className="font-medium text-foreground">费用</h3>
            <p className="text-secondary">
              本应用不知道你的 Provider 会收多少。任何生成都记为「费用未知」，不会显示为 0。
              详见「任务与费用」。
            </p>
          </section>

          <section className="stack gap-1.5">
            <h3 className="font-medium text-foreground">已排除的内容</h3>
            <p className="text-secondary">
              按范围裁剪，原站的营销、账号、订阅、工作区与收益相关界面在本版本中不存在。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
