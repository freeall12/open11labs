/* ==========================================================================
   Local media analysis — no model, no provider, no network.

   The point of this module: the app stays useful with zero keys configured.
   Duration, format validation, waveform peaks and silence detection are all
   computable from the bytes alone, so the UI can show real structure even
   before any Provider is set up — and can reject a bad file before spending
   money on it.

   Format support is deliberately explicit. An unknown container is reported
   as unknown rather than guessed at, because a wrong duration silently
   corrupts timeline work.
   ========================================================================== */

const AUDIO_CONTAINERS = [
  { ext: ".wav", mime: "audio/wav" },
  { ext: ".mp3", mime: "audio/mpeg" },
  { ext: ".m4a", mime: "audio/mp4" },
  { ext: ".ogg", mime: "audio/ogg" },
  { ext: ".flac", mime: "audio/flac" },
];

export function detectContainer(bytes) {
  if (!bytes || bytes.byteLength < 12) return { format: "unknown", reason: "文件过短" };

  const b = bytes;
  const tag = (o, n) => String.fromCharCode(...b.subarray(o, o + n));

  // RIFF....WAVE
  if (tag(0, 4) === "RIFF" && tag(8, 4) === "WAVE") {
    return { format: "wav", reason: null };
  }
  // fLaC
  if (tag(0, 4) === "fLaC") return { format: "flac", reason: null };
  // OggS
  if (tag(0, 4) === "OggS") return { format: "ogg", reason: null };
  // ID3 or an MPEG frame sync
  if (tag(0, 3) === "ID3") return { format: "mp3", reason: null };
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return { format: "mp3", reason: null };
  // ....ftyp (MP4/M4A)
  if (tag(4, 4) === "ftyp") return { format: "m4a", reason: null };

  return { format: "unknown", reason: "无法识别的音频容器，未做猜测" };
}

/* ------------------------------------------------------------------ WAV -- */

function parseWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataLength = Math.min(size, bytes.byteLength - dataOffset);
      break;
    }
    offset += 8 + size + (size % 2);
  }

  if (!channels || !sampleRate || dataOffset < 0) {
    return { format: "wav", error: "WAV 头缺少 fmt 或 data 块" };
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * channels));
  const durationSeconds = frameCount / sampleRate;

  return { format: "wav", channels, sampleRate, bitsPerSample, durationSeconds, dataOffset, dataLength };
}

/* ------------------------------------------------------------------ MP3 -- */

/** MPEG-1/2 layer III bitrate and sample-rate tables (kbps, Hz). */
const MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MP3_RATES = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

function parseMp3(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  // Skip an ID3v2 tag if present.
  if (
    view.getUint8(0) === 0x49 &&
    view.getUint8(1) === 0x44 &&
    view.getUint8(2) === 0x33
  ) {
    const size =
      ((view.getUint8(6) & 0x7f) << 21) |
      ((view.getUint8(7) & 0x7f) << 14) |
      ((view.getUint8(8) & 0x7f) << 7) |
      (view.getUint8(9) & 0x7f);
    offset = 10 + size;
  }

  // Find the first frame header, then sum frame durations.
  for (let i = offset; i < bytes.byteLength - 4; i++) {
    if (view.getUint8(i) !== 0xff || (view.getUint8(i + 1) & 0xe0) !== 0xe0) continue;

    const versionBits = (view.getUint8(i + 1) >> 3) & 0x03;
    const layerBits = (view.getUint8(i + 1) >> 1) & 0x03;
    if (versionBits === 1 || layerBits === 0) continue; // reserved

    const bitrateIndex = (view.getUint8(i + 2) >> 4) & 0x0f;
    const rateIndex = (view.getUint8(i + 2) >> 2) & 0x03;
    if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue;

    const isV1 = versionBits === 3;
    const bitrateKbps =
      (isV1 ? MP3_BITRATES_V1_L3 : MP3_BITRATES_V2_L3)[bitrateIndex];
    const sampleRate = MP3_RATES[versionBits][rateIndex];
    if (!bitrateKbps || !sampleRate) continue;

    const spf = isV1 ? 1152 : 576;
    const frameBytes = Math.floor((spf / 8) * bitrateKbps * 1000 / sampleRate) + 4;

    let frames = 0;
    let total = 0;
    for (let j = i; j + 4 <= bytes.byteLength; j += frameBytes) {
      if (view.getUint8(j) !== 0xff || (view.getUint8(j + 1) & 0xe0) !== 0xe0) break;
      frames += 1;
      total += (spf / sampleRate);
    }
    if (frames === 0) continue;

    return {
      format: "mp3",
      sampleRate,
      bitrateKbps: bitrateKbps,
      channels: 1,
      durationSeconds: Number(total.toFixed(3)),
      frames,
    };
  }

  return { format: "mp3", error: "未找到有效的 MPEG 帧" };
}

/* -------------------------------------------------------------- public -- */

/**
 * Duration and basic properties, computed locally.
 * @returns {{ ok: boolean, format: string, durationSeconds: number|null, reason?: string }}
 */
export function probeAudio(bytes) {
  const container = detectContainer(bytes);

  try {
    if (container.format === "wav") {
      const r = parseWav(bytes);
      if (r.error) return { ok: false, format: "wav", durationSeconds: null, reason: r.error };
      return {
        ok: true,
        format: "wav",
        durationSeconds: Number(r.durationSeconds.toFixed(3)),
        channels: r.channels,
        sampleRate: r.sampleRate,
        bitsPerSample: r.bitsPerSample,
      };
    }
    if (container.format === "mp3") {
      const r = parseMp3(bytes);
      if (r.error) return { ok: false, format: "mp3", durationSeconds: null, reason: r.error };
      return {
        ok: true,
        format: "mp3",
        durationSeconds: r.durationSeconds,
        sampleRate: r.sampleRate,
        bitrateKbps: r.bitrateKbps,
      };
    }
  } catch (err) {
    return {
      ok: false,
      format: container.format,
      durationSeconds: null,
      reason: `解析失败：${err?.message ?? "未知错误"}`,
    };
  }

  // m4a/ogg/flac would each need their own index parse. Rather than guess a
  // duration, say so — a wrong length silently corrupts timeline work.
  return {
    ok: false,
    format: container.format,
    durationSeconds: null,
    reason: `${container.format} 的本地时长解析尚未实现，未做猜测`,
  };
}

/**
 * Waveform peaks for a decoder-free preview.
 *
 * Only uncompressed PCM (WAV) is decoded here. Producing a plausible-looking
 * waveform from compressed bytes would be fabrication, so a format we cannot
 * decode returns null instead.
 *
 * @returns {number[]|null} `bars` normalised peaks in 0..1
 */
export function waveformPeaks(bytes, { bars = 160, silenceThreshold = 0.01 } = {}) {
  const container = detectContainer(bytes);
  if (container.format !== "wav") return null;

  const info = parseWav(bytes);
  if (info.error) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bytesPerSample = info.bitsPerSample / 8;
  const frameBytes = bytesPerSample * info.channels;
  const frameCount = Math.floor(info.dataLength / frameBytes);
  if (frameCount === 0) return null;

  const peaks = new Array(bars).fill(0);
  const framesPerBar = Math.max(1, Math.floor(frameCount / bars));
  const maxAbs = (1 << (info.bitsPerSample - 1)) - 1;

  for (let bar = 0; bar < bars; bar++) {
    const start = bar * framesPerBar;
    const end = Math.min(frameCount, start + framesPerBar);
    let peak = 0;
    for (let f = start; f < end; f++) {
      // First channel is enough for a peak envelope.
      const p = info.dataOffset + f * frameBytes;
      let v;
      if (info.bitsPerSample === 8) {
        v = (view.getUint8(p) - 128) / 128;
      } else if (info.bitsPerSample === 16) {
        v = view.getInt16(p, true) / 32768;
      } else if (info.bitsPerSample === 24) {
        const raw =
          (view.getUint8(p) |
            (view.getUint8(p + 1) << 8) |
            (view.getInt8(p + 2) << 16));
        v = raw / 8388608;
      } else if (info.bitsPerSample === 32) {
        v = view.getInt32(p, true) / 2147483648;
      } else {
        return null;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    peaks[bar] = peak;
  }
  void maxAbs;

  // Normalise so a quiet recording is still legible.
  const max = Math.max(...peaks);
  if (max > 0) for (let i = 0; i < peaks.length; i++) peaks[i] = peaks[i] / max;

  return {
    peaks,
    silenceThreshold,
    silenceSpans: findSilence(peaks, silenceThreshold),
  };
}

/** Contiguous runs quieter than the threshold — useful for trimming. */
function findSilence(peaks, threshold, minRun = 4) {
  const spans = [];
  let start = -1;
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] < threshold) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= minRun) spans.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0 && peaks.length - start >= minRun) spans.push([start, peaks.length - 1]);
  return spans;
}

export { AUDIO_CONTAINERS };
