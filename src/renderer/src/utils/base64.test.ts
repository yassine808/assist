import { describe, it, expect } from "vitest";
import { base64ToBytes, base64ToBlob } from "./base64";

/**
 * Regression test for the 0-byte profile export.
 *
 * Original bug: the backend returns base64 *text*. The renderer handed that
 * string to `new Uint8Array(base64String)`, which treats a string as
 * array-like, coerces each element to NaN -> 0, and produces a 0-byte
 * `.rsprofile`. The download looked successful but was worthless.
 *
 * These tests import the real helper, so reverting the fix in
 * `utils/base64.ts` (or swapping it back to the inline version in
 * SettingsView) fails here.
 */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

describe("base64ToBytes", () => {
  it("decodes a short payload to the right length", () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array([1, 2, 3, 4]))).length).toBe(4);
  });

  it("reproduces the original bug, proving this test can fail", () => {
    // new Uint8Array(string) yields a 0-length array. This is the exact
    // expression the old code used.
    const buggy = new Uint8Array("AQIDBA==" as unknown as number[]);
    expect(buggy.length).toBe(0);
  });

  it("round-trips the full 0-255 byte range", () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    expect(Array.from(base64ToBytes(bytesToBase64(original)))).toEqual(
      Array.from(original)
    );
  });

  it("round-trips null and 0xff bytes, which encrypted profiles contain", () => {
    const original = new Uint8Array([0x00, 0x01, 0x00, 0xff, 0x00]);
    expect(Array.from(base64ToBytes(bytesToBase64(original)))).toEqual([
      0x00, 0x01, 0x00, 0xff, 0x00,
    ]);
  });

  it("round-trips a payload that needs no base64 padding", () => {
    const original = new Uint8Array([0xfb, 0xff, 0xbf]);
    expect(Array.from(base64ToBytes(bytesToBase64(original)))).toEqual([
      0xfb, 0xff, 0xbf,
    ]);
  });

  it("handles an empty payload without throwing", () => {
    expect(base64ToBytes("").length).toBe(0);
  });
});

describe("base64ToBlob", () => {
  it("produces a non-empty blob for a real payload", async () => {
    const original = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const blob = base64ToBlob(bytesToBase64(original));
    expect(blob.size).toBe(original.length);
    expect(blob.type).toBe("application/octet-stream");
  });

  it("preserves byte values through the Blob", async () => {
    const original = new Uint8Array([0x00, 0xff, 0x0a, 0x7f]);
    const blob = base64ToBlob(bytesToBase64(original));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0x00, 0xff, 0x0a, 0x7f]);
  });
});
