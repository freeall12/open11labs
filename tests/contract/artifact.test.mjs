import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { assertArtifact } from "../../server/lib/runner.mjs";

/* ==========================================================================
   The artifact guard.

   Every synchronous success funnels through this one check, so it decides
   whether a paid call produced a usable result. Two ways to get it wrong:
   rejecting good bytes (a realm-fragile `instanceof` does exactly that) and
   accepting non-bytes (a string or a 16-bit view would be written to disk as
   if it were an audio file).
   ========================================================================== */

describe("assertArtifact", () => {
  it("accepts a byte view", () => {
    const a = { bytes: new Uint8Array([1, 2, 3]) };
    expect(assertArtifact(a)).toBe(a);
  });

  it("accepts a Node Buffer, which is a byte view", () => {
    const a = { bytes: Buffer.from([1, 2, 3]) };
    expect(assertArtifact(a)).toBe(a);
  });

  it("accepts a byte view created in another realm", () => {
    // A genuine foreign realm, not a lookalike: a `instanceof Uint8Array`
    // guard rejects these even though the bytes are perfectly good, which is
    // what made a working adapter look broken.
    const foreign = vm.runInNewContext("new Uint8Array([1, 2, 3, 4])");
    expect(foreign instanceof Uint8Array).toBe(false);
    expect(foreign.byteLength).toBe(4);

    const a = { bytes: foreign };
    expect(assertArtifact(a)).toBe(a);
  });

  it("rejects an empty body instead of storing a zero-length success", () => {
    expect(() => assertArtifact({ bytes: new Uint8Array(0) })).toThrow(/empty/);
  });

  it("rejects a missing artifact or missing bytes", () => {
    expect(() => assertArtifact(undefined)).toThrow(/no bytes/);
    expect(() => assertArtifact({})).toThrow(/no bytes/);
    expect(() => assertArtifact({ bytes: null })).toThrow(/no bytes/);
  });

  it("rejects a string, so prose can never be written as media", () => {
    expect(() => assertArtifact({ bytes: "hello" })).toThrow(/no bytes/);
  });

  it("rejects a non-byte typed array", () => {
    // Uint16Array has the right shape and the wrong width; storing it as a
    // file would silently halve the content.
    expect(() => assertArtifact({ bytes: new Uint16Array([1, 2]) })).toThrow(/no bytes/);
    expect(() => assertArtifact({ bytes: new Float64Array([1.5]) })).toThrow(/no bytes/);
  });

  it("rejects an ArrayBuffer, which is a container and not a view", () => {
    expect(() => assertArtifact({ bytes: new ArrayBuffer(8) })).toThrow(/no bytes/);
  });
});
