import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatedAvatar } from "@/components/AnimatedAvatar";
import { IconArrowUp, IconMic, IconPlus } from "@/lib/icons";
import { ApiError, assets as assetsApi } from "@/lib/api";

/* ==========================================================================
   Home prompt bar.

   Every control here does something observable. The three buttons used to be
   decorative, which is the exact failure `specs/ACCEPTANCE.md` calls out.

   What each one does, and why it is not more:

   - **发送** hands the text to the TTS page rather than generating here. The
     reference generates straight from this bar, but that is a paid call. The
     TTS page already carries the cost gate, the parameter rail and the
     result panel, so routing there is both honest and the destination the
     user actually needs.

   - **添加引用** uploads the chosen file into the local asset store and shows
     it as an attachment chip. It is a real upload against the local server,
     not a decorative "+".

   - **开始听写** is disabled with a stated reason. Browser dictation is not
     part of the captured evidence and there is no transcript endpoint behind
     it; a button that opens a permission prompt and then goes nowhere is worse
     than one that says so.
   ========================================================================== */

const PLACEHOLDER = "创建一则带旁白的产品广告…";

/** Where the composer hands off. Kept here so both sides agree. */
export const PROMPT_HANDOFF_KEY = "open11labs.prompt.handoff";

export function PromptBar() {
  const [value, setValue] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const canSend = value.trim().length > 0;

  function send() {
    const text = value.trim();
    if (!text) return;
    // One-shot handoff: the TTS page consumes and clears it, so a later visit
    // never resurrects a prompt the user already sent.
    try {
      sessionStorage.setItem(PROMPT_HANDOFF_KEY, text);
    } catch {
      /* storage disabled — fall through, the navigation still works */
    }
    setValue("");
    navigate("/app/speech-synthesis/text-to-speech");
  }

  async function attach(file: File) {
    setUploading(true);
    setNote(null);
    try {
      const { asset } = await assetsApi.upload(file);
      setAttachment(asset.displayName);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="stack relative w-full max-w-[650px] cursor-text rounded-[32px]">
      {/* Three stacked shadow layers produce the site's 1px ring + soft edge.
          Each layer carries the radius itself: an absolutely positioned child
          does not inherit the parent's border-radius, so without this the
          shadow paints a square box around a pill. */}
      <div className="absolute inset-0 rounded-[32px] bg-background shadow-natural-xs" />
      <div className="absolute inset-0 rounded-[32px] shadow-natural-xs" />
      <div className="absolute inset-0 rounded-[32px] shadow-natural-xs" />

      <div className="relative flex">
        <div className="m-2 mr-0 flex h-9 w-9 shrink-0 items-center justify-center">
          <AnimatedAvatar size={28} />
        </div>

        <div className="shrink-0">
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            aria-label="选择要引用的文件"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void attach(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            aria-label="添加引用"
            title={attachment ? `已引用：${attachment}` : "上传文件到本机素材库并作为引用"}
            className="focus-ring text-foreground hover:bg-gray-alpha-100 active:bg-gray-alpha-200 my-2 ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-0 transition-colors duration-75 disabled:opacity-50"
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={PLACEHOLDER}
            className="scroll-subtle focus-ring block h-13 max-h-[200px] min-h-13 w-full resize-none overflow-hidden border-none! bg-transparent py-[15px] pr-2 text-base leading-normal text-foreground -translate-y-px outline-none placeholder:text-subtle"
          />
          {attachment && (
            <p className="-mt-1 truncate pb-2 pl-1 text-xs text-secondary">
              已引用：{attachment}
            </p>
          )}
        </div>

        <div className="relative flex shrink-0">
          <div className="mr-1 inline-flex h-5 items-center self-center rounded-full border border-transparent bg-gray-alpha-100 px-2 text-xs font-medium text-foreground">
            Alpha
          </div>

          <button
            type="button"
            // Disabled with a reason, not silently inert: see the file header.
            aria-label="开始听写"
            disabled
            title="听写需要浏览器语音识别，本版本未接入；请直接输入文本"
            className="focus-ring text-foreground my-2 flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-full p-0 opacity-40"
          >
            <IconMic size={18} />
          </button>

          <button
            type="button"
            onClick={send}
            aria-label="发送到文本转语音"
            disabled={!canSend || uploading}
            className="focus-ring m-2 ml-2.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-0 transition-colors duration-75 disabled:cursor-not-allowed disabled:bg-gray-400 disabled:text-gray-100 enabled:bg-foreground enabled:text-background enabled:hover:bg-gray-800"
          >
            <IconArrowUp size={18} />
          </button>
        </div>
      </div>

      {note && <p className="px-4 pb-3 text-xs text-amber-700">{note}</p>}
    </div>
  );
}
