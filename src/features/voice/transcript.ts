/* ==========================================================================
   Transcript shapes, local editing and subtitle export.

   The rule that shapes this file: **nothing is invented**. A transcript
   without word timings cannot produce a truthful SRT, so this module refuses
   to emit one and says which input it is missing. Fabricating evenly spaced
   timestamps would produce a file that opens in a player and is wrong, which
   is worse than not offering the format.

   Local edits never re-run transcription. Editing a transcript is a local
   operation; only re-submitting the job costs money.
   ========================================================================== */

/** What the provider adapter hands back. Field presence varies by provider. */
export interface RawTranscript {
  text: string;
  languageCode?: string | null;
  /** Adapters may return a count or the full array; both are accepted. */
  words?: unknown;
  characters?: unknown;
}

/** A single timed word. Only present when the provider actually returned it. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
  speaker?: string | null;
}

export interface Transcript {
  text: string;
  languageCode: string | null;
  /** Null when the provider returned none. Never synthesised. */
  words: TimedWord[] | null;
}

/**
 * Parse whatever the provider returned into one shape.
 *
 * Unrecognised input yields an empty transcript with a reason, not a guess.
 */
export function parseTranscript(raw: unknown): { transcript: Transcript | null; reason: string | null } {
  const obj = (typeof raw === "string" ? safeParse(raw) : raw) as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") {
    return { transcript: null, reason: "转写结果不是可识别的 JSON 结构" };
  }

  // Some providers wrap the payload; accept one level of unwrapping.
  const body = (obj.transcript && typeof obj.transcript === "object"
    ? (obj.transcript as Record<string, unknown>)
    : obj) as Record<string, unknown>;

  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim() && !hasUsableWords(body.words)) {
    return { transcript: null, reason: "供应商返回了空转写" };
  }

  return {
    transcript: {
      text,
      languageCode: typeof body.languageCode === "string" ? body.languageCode : null,
      words: normalizeWords(body.words),
    },
    reason: null,
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    // A bare string is still a valid transcript — it is just plain text.
    return { text: s };
  }
}

function hasUsableWords(words: unknown): boolean {
  return Array.isArray(words) && words.length > 0;
}

/**
 * Accept either a full word array or a bare count.
 *
 * A count is a real answer about the provider but carries no timing, so it
 * maps to `null` words rather than to `[]`. `[]` would mean "no words", which
 * is a different and wrong claim.
 */
function normalizeWords(words: unknown): TimedWord[] | null {
  if (!Array.isArray(words) || words.length === 0) return null;
  const out: TimedWord[] = [];
  for (const w of words) {
    if (!w || typeof w !== "object") return null;
    const r = w as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text : typeof r.word === "string" ? r.word : null;
    const start = num(r.start ?? r.start_time);
    const end = num(r.end ?? r.end_time);
    if (text === null || start === null || end === null) return null;
    out.push({ text, start, end, speaker: typeof r.speaker === "string" ? r.speaker : null });
  }
  return out.length > 0 ? out : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ---------------------------------------------------------------- export -- */

export type SubtitleFormat = "txt" | "srt" | "vtt";

export interface ExportResult {
  ok: boolean;
  body: string;
  mediaType: string;
  filename: string;
  /** Why an export was refused. Never silently empty. */
  reason: string | null;
}

/**
 * Serialise a transcript.
 *
 * SRT and VTT need real timings. When the provider did not return them the
 * export is refused with a reason instead of emitting invented timestamps.
 */
export function exportTranscript(
  transcript: Transcript,
  format: SubtitleFormat,
  editedText?: string,
): ExportResult {
  const text = editedText ?? transcript.text;
  const base = { filename: "transcript", body: "", mediaType: "text/plain", reason: null as string | null };

  if (!text.trim()) {
    return { ...base, ok: false, reason: "转写内容为空，没有可导出的文本" };
  }

  if (format === "txt") {
    return { ...base, ok: true, body: text, filename: "transcript.txt" };
  }

  const words = transcript.words;
  if (!words || words.length === 0) {
    return {
      ...base,
      ok: false,
      reason:
        format === "srt"
          ? "导出 SRT 需要逐词时间戳，但该 Provider 本次没有返回时间戳；不会编造时间轴"
          : "导出 VTT 需要逐词时间戳，但该 Provider 本次没有返回时间戳；不会编造时间轴",
    };
  }

  // Group words into cues on sentence-ish boundaries, but only where the
  // timings themselves justify it.
  const cues = buildCues(words, format === "srt" ? 42 : 84);
  if (cues.length === 0) {
    return { ...base, ok: false, reason: "时间戳无法构成有效字幕区间" };
  }

  const invalid = cues.find((c) => !(c.end > c.start));
  if (invalid) {
    return { ...base, ok: false, reason: "存在 end 不晚于 start 的时间戳，已拒绝导出" };
  }

  const body =
    format === "srt"
      ? cues.map((c, i) => renderSrtCue(c, i)).join("\n")
      : `WEBVTT\n\n${cues.map((c) => renderVttCue(c)).join("\n")}`;

  return {
    ...base,
    ok: true,
    body,
    mediaType: format === "srt" ? "application/x-subrip" : "text/vtt",
    filename: `transcript.${format}`,
  };
}

interface Cue {
  start: number;
  end: number;
  lines: string[];
}

function buildCues(words: TimedWord[], maxChars: number): Cue[] {
  const cues: Cue[] = [];
  let current: Cue | null = null;
  for (const w of words) {
    if (!current) {
      current = { start: w.start, end: w.end, lines: [] };
    }
    const candidate = [...current.lines, w.text].join(" ");
    if (candidate.length > maxChars && current.lines.length > 0) {
      cues.push(current);
      current = { start: w.start, end: w.end, lines: [w.text] };
    } else {
      current.lines.push(w.text);
      current.end = w.end;
    }
  }
  if (current && current.lines.length > 0) cues.push(current);
  return cues;
}

/** `HH:MM:SS,mmm` for SRT; the comma is part of the spec, not a typo. */
function srtTimestamp(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${p2(h)}:${p2(m)}:${p2(sec)},${String(milli).padStart(3, "0")}`;
}

/** `HH:MM:SS.mmm` for WebVTT. */
function vttTimestamp(s: number): string {
  return srtTimestamp(s).replace(",", ".");
}

function p2(n: number): string {
  return String(n).padStart(2, "0");
}

function renderSrtCue(c: Cue, index: number): string {
  return `${index + 1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(c.end)}\n${c.lines.join("\n")}\n`;
}

function renderVttCue(c: Cue): string {
  return `${vttTimestamp(c.start)} --> ${vttTimestamp(c.end)}\n${c.lines.join("\n")}\n`;
}

/* ------------------------------------------------------------ speakers -- */

/** Group transcript words into speakers. Requires diarization output. */
export function speakersFromWords(words: TimedWord[] | null): { id: string; words: number; text: string }[] {
  if (!words) return [];
  const map = new Map<string, { words: number; text: string }>();
  for (const w of words) {
    const id = w.speaker ?? "未标注";
    const cur = map.get(id) ?? { words: 0, text: "" };
    cur.words += 1;
    cur.text = cur.text ? `${cur.text} ${w.text}` : w.text;
    map.set(id, cur);
  }
  return [...map.entries()]
    .map(([id, v]) => ({ id, words: v.words, text: v.text }))
    .sort((a, b) => b.words - a.words);
}

/** Trigger a browser download for an already-serialised export. */
export function downloadText(filename: string, body: string, mediaType: string) {
  const blob = new Blob([body], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
