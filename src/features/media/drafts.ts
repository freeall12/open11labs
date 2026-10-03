import { useEffect, useRef, useState } from "react";

/* ==========================================================================
   Drafts.

   Every media page keeps its parameters across a refresh: a half-written
   prompt is the most expensive thing to lose, because retyping it costs
   time and re-submitting it costs money.

   Only non-secret page state is stored — text, ids, slider positions. A
   provider key never reaches this path; it lives in the server-side proxy
   and is not part of any draft. A malformed or foreign entry falls back to
   the initial value rather than throwing, so an old draft cannot brick a
   page.
   ========================================================================== */

const PREFIX = "open11labs.draft";

function readDraft<T extends object>(storageKey: string, initial: T): T {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return initial;
    const parsed = JSON.parse(raw) as object;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return initial;
    return { ...initial, ...parsed } as T;
  } catch {
    return initial;
  }
}

export function useMediaDraft<T extends object>(key: string, initial: T) {
  const storageKey = `${PREFIX}:${key}`;

  const [value, setValue] = useState<T>(() => readDraft(storageKey, initial));

  // The newest value is mirrored into a ref so unmount can flush it. Without
  // this the debounced write below is cancelled by the effect cleanup, and the
  // last edits before a navigation are the ones that vanish — which is exactly
  // what happens when the user types a prompt and clicks the 历史 tab to look
  // something up and comes back.
  const latest = useRef(value);
  latest.current = value;

  // Debounced so a slider drag or a fast typist does not write per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        /* Private mode or a full quota: the page still works, it just forgets. */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      try {
        localStorage.setItem(storageKey, JSON.stringify(latest.current));
      } catch {
        /* Same reason as above; the in-memory value still drives the page. */
      }
    };
  }, [storageKey, value]);

  return [value, setValue] as const;
}

/** Drop a stored draft. Used by the "clear" affordance, never on a timer. */
export function clearMediaDraft(key: string) {
  try {
    localStorage.removeItem(`${PREFIX}:${key}`);
  } catch {
    /* Nothing to do: the page keeps working from memory either way. */
  }
}
