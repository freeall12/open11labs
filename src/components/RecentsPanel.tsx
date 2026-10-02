import { useState } from "react";
import { RECENT_ITEMS } from "@/data/recents";
import { IconGrid, IconList, IconSearch } from "@/lib/icons";

/* Quick-start templates. The upstream grid is three columns of 311x175 cards
   with 12px gutters and a title scrim pinned to the bottom edge. */
const QUICK_STARTS = [
  { id: "q1", title: "Product shot library", href: "/app/templates/1" },
  { id: "q2", title: "Product image to UGC ad", href: "/app/templates/2" },
  { id: "q3", title: "Model photoshoot", href: "/app/templates/3" },
  { id: "q4", title: "Moodboard generator", href: "/app/templates/4" },
  { id: "q5", title: "Batch Editor", href: "/app/templates/5" },
  { id: "q6", title: "Product to lifestyle", href: "/app/templates/6" },
  { id: "q7", title: "Brand mockup studio", href: "/app/templates/7" },
  { id: "q8", title: "Dubbing starter kit", href: "/app/templates/8" },
  { id: "q9", title: "Podcast intro music", href: "/app/templates/9" },
];

type Tab = "recents" | "quick-starts";
type Layout = "list" | "grid";

const TABS: { id: Tab; label: string }[] = [
  { id: "recents", label: "最近" },
  { id: "quick-starts", label: "快速入门" },
];

function SearchField({ placeholder }: { placeholder: string }) {
  return (
    <div className="group relative col-span-full flex h-9 w-full rounded-xl bg-background">
      <IconSearch
        size={20}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle group-focus-within:text-foreground"
      />
      <input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        className="focus-ring h-full w-full rounded-xl bg-transparent pr-9 pl-9 text-sm font-medium text-foreground placeholder:text-subtle [&::-webkit-search-cancel-button]:appearance-none"
      />
    </div>
  );
}

function LayoutToggle({
  layout,
  onChange,
}: {
  layout: Layout;
  onChange: (next: Layout) => void;
}) {
  return (
    <div
      role="group"
      aria-label="查看布局"
      className="flex shrink-0 rounded-xl bg-gray-75 p-0.5"
    >
      {(
        [
          { id: "list", label: "列表视图", Icon: IconList },
          { id: "grid", label: "网格视图", Icon: IconGrid },
        ] as const
      ).map(({ id, label, Icon }) => {
        const active = layout === id;
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={`focus-ring relative flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors duration-200 ${
              active ? "text-foreground" : "text-secondary"
            }`}
          >
            {active && (
              <div className="absolute inset-0 rounded-[10px] bg-background shadow-natural-xs" />
            )}
            <Icon className="relative z-1 shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

function RecentsList() {
  return (
    <ul className="grid grid-cols-[32px_1fr_auto] gap-x-3 divide-y border-y sm:grid-cols-[32px_1fr_auto_auto] lg:grid-cols-[32px_1fr_200px_auto]">
      {RECENT_ITEMS.map((item) => (
        <li
          key={item.id}
          className="group relative col-span-3 grid grid-cols-subgrid items-center gap-3 bg-transparent! py-2.5 transition-colors duration-75 hover:bg-gray-alpha-50 sm:col-span-4"
        >
          <a
            href={item.href}
            aria-label={item.title}
            className="focus-ring absolute inset-0 -inset-x-2.5 inset-y-0.5 rounded-xl text-left transition-colors duration-100 group-hover:bg-gray-alpha-50"
          />
          <div className="center relative h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-gray-75">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 text-secondary"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
            </svg>
          </div>
          <div className="relative col-span-2 grid min-w-0 flex-1 grid-cols-subgrid sm:col-span-3">
            <p className="line-clamp-1 text-sm font-medium text-foreground">
              {item.title}
            </p>
            <p className="hidden text-sm font-medium text-secondary sm:inline-block">
              {item.category}
            </p>
            <span className="shrink-0 whitespace-nowrap text-right text-sm text-secondary">
              {item.time}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function QuickStartGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {QUICK_STARTS.map((t) => (
        <a
          key={t.id}
          href={t.href}
          className="focus-ring group block min-w-0 rounded-xl"
        >
          <div className="group relative aspect-[311/175] cursor-pointer overflow-hidden rounded-xl bg-gray-100">
            {/* Placeholder art. Drop a real thumbnail in when assets exist. */}
            <div className="h-full w-full bg-linear-to-br from-gray-150 to-gray-250" />
            <p className="absolute inset-x-0 bottom-0 z-20 truncate px-3 pb-2.5 text-sm font-medium text-white">
              {t.title}
            </p>
          </div>
        </a>
      ))}
    </div>
  );
}

export function RecentsPanel() {
  const [tab, setTab] = useState<Tab>("recents");
  const [layout, setLayout] = useState<Layout>("list");

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div dir="ltr" className="stack w-full gap-3.5">
      <div className="border-b">
        <div
          role="tablist"
          aria-orientation="horizontal"
          className="no-scrollbar -mb-px inline-flex h-10 w-full justify-around gap-1.5 overflow-x-auto border-b border-none pt-0.5 text-secondary lg:h-11 lg:w-auto lg:justify-start lg:overflow-x-visible"
        >
          {TABS.map((t) => {
            const isActive = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(t.id)}
                className={`focus-ring mb-0 inline-flex w-full items-center justify-center whitespace-nowrap border-b-[1.5px] border-transparent px-4 py-1 text-sm font-medium transition-all md:px-0 lg:w-auto lg:pb-2.5 ${
                  isActive
                    ? "border-gray-alpha-800 text-foreground"
                    : "text-secondary"
                }`}
              >
                <div className="hstack items-center rounded-[10px] border border-transparent px-2.5 py-1">
                  {t.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex w-full items-stretch justify-between gap-1.5">
        <SearchField
          placeholder={tab === "recents" ? "搜索最近内容..." : "搜索快速入门…"}
        />
        {tab === "recents" && (
          <LayoutToggle layout={layout} onChange={setLayout} />
        )}
      </div>

      <div
        role="tabpanel"
        aria-label={active.label}
        className="focus-ring mt-0 min-h-[80dvh]"
      >
        {tab === "recents" ? (
          layout === "list" ? (
            <RecentsList />
          ) : (
            <div className="rounded-xl border-y py-2 text-sm text-secondary">
              网格视图尚未还原。
            </div>
          )
        ) : (
          <QuickStartGrid />
        )}
      </div>
    </div>
  );
}
