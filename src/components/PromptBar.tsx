import { useState } from "react";
import { AnimatedAvatar } from "@/components/AnimatedAvatar";
import { IconArrowUp, IconMic, IconPlus } from "@/lib/icons";

const PLACEHOLDER = "创建一则带旁白的产品广告…";

export function PromptBar() {
  const [value, setValue] = useState("");
  const canSend = value.trim().length > 0;

  return (
    <div className="stack relative w-full max-w-[650px] cursor-text rounded-[26px]">
      {/* Three stacked shadow layers produce the site's 1px ring + soft edge. */}
      <div className="absolute inset-0 bg-background shadow-natural-xs" />
      <div className="absolute inset-0 shadow-natural-xs" />
      <div className="absolute inset-0 shadow-natural-xs" />

      <div className="flex">
        <div className="m-2 mr-0 flex h-9 w-9 shrink-0 items-center justify-center">
          <AnimatedAvatar size={28} />
        </div>

        <div className="shrink-0">
          <button
            type="button"
            aria-label="添加引用"
            title="添加文件、生成内容等"
            className="center focus-ring text-foreground hover:bg-gray-alpha-100 active:bg-gray-alpha-200 my-2 ml-1 h-9 w-9 shrink-0 rounded-full p-0 transition-colors duration-75"
          >
            <IconPlus size={18} />
          </button>
        </div>

        <div className="ml-1 w-full min-w-0">
          <label className="sr-only" htmlFor="prompt">
            {PLACEHOLDER}
          </label>
          <textarea
            id="prompt"
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={PLACEHOLDER}
            className="scroll-subtle focus-ring block h-13 max-h-[200px] min-h-13 w-full resize-none overflow-hidden border-none! bg-transparent py-[15px] pr-2 text-base leading-normal text-foreground -translate-y-px outline-none placeholder:text-subtle"
          />
        </div>

        <div className="relative flex shrink-0">
          <div className="mr-1 inline-flex h-5 items-center self-center rounded-full border border-transparent bg-gray-alpha-100 px-2 text-xs font-medium text-foreground">
            Alpha
          </div>

          <button
            type="button"
            aria-label="开始听写"
            className="center focus-ring text-foreground hover:bg-gray-alpha-100 active:bg-gray-alpha-200 my-2 h-9 w-9 shrink-0 rounded-full p-0 transition-colors duration-75"
          >
            <IconMic size={18} />
          </button>

          <button
            type="button"
            aria-label="发送"
            disabled={!canSend}
            className="center focus-ring m-2 ml-2.5 h-9 w-9 shrink-0 rounded-full p-0 transition-colors duration-75 disabled:bg-gray-400 disabled:text-gray-100 enabled:bg-foreground enabled:text-background enabled:hover:bg-gray-800"
          >
            <IconArrowUp size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
