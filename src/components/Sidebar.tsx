import { PINNED_NAV, PRIMARY_NAV, type NavItem } from "@/data/navigation";
import { IconMore } from "@/lib/icons";

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <li className="group/item w-full">
      <div className="relative w-fit rounded-[10px] group/navitem hover:bg-gray-alpha-100">
        <a
          href={item.href}
          /* Width comes from the rail variable only — a competing `w-fit`
             here would win on cascade order and collapse the row. */
          className={`focus-ring block rounded-lg w-[calc(var(--eleven-sidebar-width)-1.5625rem)] ${
            active
              ? "bg-gray-alpha-100 text-gray-950"
              : "text-secondary hover:text-gray-950"
          }`}
        >
          <div
            className={`flex items-center gap-2 px-2 ${
              active ? "text-gray-950" : "text-secondary"
            }`}
          >
            <div className="center -mx-0.5 h-8 min-w-5">
              <Icon size={20} className="shrink-0" />
            </div>
            {/* Labels are hidden while the rail is collapsed. */}
            <div className="flex h-8 flex-1 items-center justify-between opacity-0 transition-all duration-150 group-aria-expanded/sidebar:translate-x-0 group-aria-expanded/sidebar:opacity-100 translate-x-1">
              <p className="max-w-[168px] truncate whitespace-nowrap text-sm font-medium">
                {item.label}
              </p>
            </div>
          </div>
        </a>
      </div>
    </li>
  );
}

export function Sidebar({ open }: { open: boolean }) {
  return (
    <aside
      aria-expanded={open}
      /* Width is owned by .app-sidebar in index.css — a `w-0` utility here
         would sit in a later cascade layer and win over it. */
      className="app-sidebar group/sidebar fixed top-0 left-0 z-40 hidden h-full cursor-e-resize overflow-hidden border-r bg-background/90 backdrop-blur-md transition-[width] duration-150 group-aria-expanded:cursor-default lg:block"
    >
      <div className="relative stack h-full w-full overflow-hidden">
        <nav id="main-nav" className="relative flex h-full flex-1 flex-col">
          <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto overflow-x-hidden pt-1.5">
            <ul className="stack w-full grow shrink-0 gap-4 px-3 lg:gap-5">
              <li>
                <ul className="stack cursor-default gap-1">
                  {PRIMARY_NAV.map((item) => (
                    <NavLink
                      key={item.href}
                      item={item}
                      active={item.label === "主页"}
                    />
                  ))}
                </ul>
              </li>

              <li aria-label="已置顶">
                <h2 className="mb-1.5 ml-1.5 whitespace-nowrap text-sm font-medium text-secondary opacity-0 transition-opacity duration-150 group-aria-expanded/sidebar:opacity-100">
                  已置顶
                </h2>
                <ul className="stack cursor-default gap-1">
                  {PINNED_NAV.map((item) => (
                    <NavLink key={item.href} item={item} active={false} />
                  ))}
                  <li className="group w-full">
                    <button
                      type="button"
                      aria-label="更多工具"
                      className="focus-ring relative block w-fit rounded-lg text-secondary outline-foreground hover:bg-gray-alpha-100 hover:text-gray-950 w-[calc(var(--eleven-sidebar-width)-1.5625rem)]"
                    >
                      <div className="flex items-center gap-2 px-2 text-secondary">
                        <div className="center -mx-0.5 h-8 w-5">
                          <IconMore size={20} className="shrink-0" />
                        </div>
                        <div className="flex h-8 flex-1 translate-x-1 items-center justify-between opacity-0 transition-all duration-150 group-aria-expanded/sidebar:translate-x-0 group-aria-expanded/sidebar:opacity-100">
                          <p className="text-sm font-medium">更多工具</p>
                        </div>
                      </div>
                    </button>
                  </li>
                </ul>
              </li>
            </ul>
          </div>
        </nav>
      </div>
    </aside>
  );
}
