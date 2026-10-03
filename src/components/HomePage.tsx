import { PromptBar } from "@/components/PromptBar";
import { RecentsPanel } from "@/components/RecentsPanel";
import { ToolGrid } from "@/components/ToolGrid";

/* The marketing carousel that normally sits between the tool grid and the
   recents panel is intentionally not replicated here. */
export function HomePage() {
  return (
    /* `px-4 lg:px-0`: below `lg` the rail is a drawer, so the content reaches
       the viewport edge and the recents heading sat flush against it. At `lg`
       the content is inset by the rail and centred in its own max width, where
       extra padding would only shift the geometry verified against 001/002. */
    <main className="relative mx-auto w-full max-w-6xl flex-[1_1_0] px-4 pb-8 lg:px-0">
      <div className="mx-auto w-full">
        <div className="stack min-h-[min(40dvh,450px)] items-center gap-5 py-[9dvh]">
          <h1 className="text-balance text-center font-waldenburg text-3xl font-normal text-foreground">
            你想创建什么？
          </h1>

          <PromptBar />

          {/* Measured on 001/002: the tool row's top edge sits 123px below the
              composer's bottom edge. The surrounding `gap-5` only accounts for
              20px, which pulled the whole row up against the prompt bar. The
              margin tracks viewport width so it collapses sensibly below the
              desktop width the reference was captured at. */}
          <div className="stack mt-[clamp(40px,8.1vw,123px)] w-full gap-10">
            <ToolGrid />
            <RecentsPanel />
          </div>
        </div>
      </div>
    </main>
  );
}
