import { PromptBar } from "@/components/PromptBar";
import { RecentsPanel } from "@/components/RecentsPanel";
import { ToolGrid } from "@/components/ToolGrid";

/* The marketing carousel that normally sits between the tool grid and the
   recents panel is intentionally not replicated here. */
export function HomePage() {
  return (
    <main className="relative mx-auto w-full max-w-6xl flex-[1_1_0] pb-8">
      <div className="mx-auto w-full">
        <div className="stack min-h-[min(40dvh,450px)] items-center gap-5 py-[9dvh]">
          <h1 className="text-balance text-center font-waldenburg text-3xl font-normal text-foreground">
            你想创建什么？
          </h1>

          <PromptBar />

          <div className="stack w-full gap-10">
            <ToolGrid />
            <RecentsPanel />
          </div>
        </div>
      </div>
    </main>
  );
}
