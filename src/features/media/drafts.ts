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

  // A mode switch changes the key mid-mount (image → video → lipsync). Adopt
  // the new key's own draft BEFORE any effect runs: otherwise the debounced
  // write below would file the OLD mode's value under the NEW key, silently
  // overwriting what that mode had saved. Render-phase adjustment, guarded so
  // it re-runs only when the key actually changes.
  const [prevKey, setPrevKey] = useState(storageKey);
  if (prevKey !== storageKey) {
    setPrevKey(storageKey);
    setValue(readDraft(storageKey, initial));
  }

  // The newest value and key are mirrored into refs so an unmount can flush
  // them; the cleanup must NOT read them, though; on a mode switch the refs
  // already point at the NEW mode while the cleanup's closure holds the OLD
  // key — mixing them files one mode's draft under the other's key.
  const latest = useRef(value);
  latest.current = value;
  const keyRef = useRef(storageKey);
  keyRef.current = storageKey;

  // Debounced so a slider drag or a fast typist does not write per keystroke.
  // The closure always pairs this render's key with this render's value.
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
      // Leaving this key (mode switch): flush the old pair so edits newer
      // than the debounce interval are not lost. A plain value change does
      // not flush — the next effect run re-schedules the write.
      if (keyRef.current !== storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(value));
        } catch {
          /* Same reason as above. */
        }
      }
    };
  }, [storageKey, value]);

  // Flush whatever is current when the page unmounts — typing a prompt and
  // clicking the 历史 tab to look something up must not lose the last edits.
  useEffect(
    () => () => {
      try {
        localStorage.setItem(keyRef.current, JSON.stringify(latest.current));
      } catch {
        /* Same reason as above; the in-memory value still drives the page. */
      }
    },
    [],
  );

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
