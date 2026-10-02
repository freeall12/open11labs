import { describe, expect, it } from "vitest";
import { detectContainer, probeAudio, waveformPeaks } from "../../server/lib/media.mjs";

/* ==========================================================================
   Local media analysis.

   These run with no provider and no key, which is the whole point: the app
   can show real structure and reject a bad file before anything costs money.
   The critical property is honesty — an undecodable format returns null or a
   reason, never a fabricated duration.
   ========================================================================== */

/** Build a real 16-bit PCM WAV of `seconds` at `sampleRate`, optionally gated. */
function makeWav({ seconds = 1, sampleRate = 8000, channels = 1, tone = true } = {}) {
  const frames = Math.floor(seconds * sampleRate);
  const dataBytes = frames * channels * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);

  const ascii = (off, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);

  for (let f = 0; f < frames; f++) {
    // Second half silent, so silence detection has something real to find.
    const loud = f < frames / 2;
    const sample = loud && tone ? Math.round(Math.sin((f / sampleRate) * 440 * 2 * Math.PI) * 20000) : 0;
    for (let c = 0; c < channels; c++) v.setInt16(44 + (f * channels + c) * 2, sample, true);
  }
  return new Uint8Array(buf);
}

/** A minimal but structurally valid MPEG-1 Layer III frame. */
function makeMp3Frames({ frames = 10, bitrateIndex = 9, rateIndex = 0 } = {}) {
  const bitrateKbps = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0][bitrateIndex];
  const sampleRate = [44100, 48000, 32000][rateIndex];
  const spf = 1152;
  const frameBytes = Math.floor((spf / 8) * bitrateKbps * 1000 / sampleRate) + 4;

  const out = new Uint8Array(frames * frameBytes);
  for (let i = 0; i < frames; i++) {
    const o = i * frameBytes;
    out[o] = 0xff;
    out[o + 1] = 0xfb; // MPEG1, Layer III, no CRC
    out[o + 2] = (bitrateIndex << 4) | (rateIndex << 2);
    out[o + 3] = 0xc0; // stereo-ish; not used for duration
  }
  return out;
}

describe("container detection", () => {
  it("recognises WAV, FLAC, Ogg and MP4", () => {
    expect(detectContainer(makeWav()).format).toBe("wav");
    expect(detectContainer(new TextEncoder().encode("fLaC\0\0\0\0\0\0\0\0")).format).toBe("flac");
    expect(detectContainer(new TextEncoder().encode("OggS\0\0\0\0\0\0\0\0")).format).toBe("ogg");
    expect(
      detectContainer(new TextEncoder().encode("\0\0\0\x18ftypM4A \0\0\0\0")).format,
    ).toBe("m4a");
  });

  it("says unknown rather than guessing", () => {
    const r = detectContainer(new TextEncoder().encode("not audio at all"));
    expect(r.format).toBe("unknown");
    expect(r.reason).toBeTruthy();
  });

  it("handles a truncated file without throwing", () => {
    expect(() => detectContainer(new Uint8Array(4))).not.toThrow();
  });
});

describe("duration probing", () => {
  it("computes WAV duration from the header and data size", () => {
    const r = probeAudio(makeWav({ seconds: 2, sampleRate: 8000 }));
    expect(r.ok).toBe(true);
    expect(r.format).toBe("wav");
    expect(r.durationSeconds).toBeCloseTo(2, 2);
    expect(r.channels).toBe(1);
    expect(r.sampleRate).toBe(8000);
  });

  it("computes MP3 duration by summing frame durations", () => {
    const r = probeAudio(makeMp3Frames({ frames: 100 }));
    expect(r.ok).toBe(true);
    expect(r.format).toBe("mp3");
    // 100 frames x 1152 samples at 44100 Hz.
    expect(r.durationSeconds).toBeCloseTo((100 * 1152) / 44100, 2);
  });

  it("reports 'not implemented' for a format it cannot decode", () => {
    const r = probeAudio(new TextEncoder().encode("OggS\0\0\0\0\0\0\0\0"));
    expect(r.ok).toBe(false);
    expect(r.durationSeconds).toBeNull();
    // Explicitly says what is missing rather than inventing a number.
    expect(r.reason).toContain("未做猜测");
  });

  it("reports unknown input without throwing", () => {
    const r = probeAudio(new TextEncoder().encode("hello world"));
    expect(r.ok).toBe(false);
    expect(r.durationSeconds).toBeNull();
  });
});

describe("waveform peaks", () => {
  it("returns a normalised envelope for decodable PCM", () => {
    const out = waveformPeaks(makeWav({ seconds: 1, sampleRate: 8000 }), { bars: 32 });
    expect(out).not.toBeNull();
    expect(out.peaks).toHaveLength(32);
    for (const p of out.peaks) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("finds the silent half it was given", () => {
    const out = waveformPeaks(makeWav({ seconds: 2, sampleRate: 8000 }), {
      bars: 40,
      silenceThreshold: 0.02,
    });
    expect(out.silenceSpans.length).toBeGreaterThan(0);
    // The tail is the silent half.
    const last = out.silenceSpans[out.silenceSpans.length - 1];
    expect(last[1]).toBeGreaterThan(out.peaks.length * 0.4);
  });

  it("returns null for a format it cannot decode, never a fake shape", () => {
    // A compressed container would need a real decoder; a plausible-looking
    // envelope drawn from compressed bytes would be fabricated data.
    expect(waveformPeaks(makeMp3Frames({ frames: 20 }))).toBeNull();
  });

  it("returns null for unknown input", () => {
    expect(waveformPeaks(new TextEncoder().encode("nope"))).toBeNull();
  });
});
