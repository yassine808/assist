/**
 * base64 -> bytes decoding for profile exports.
 *
 * Kept out of the component so it can be tested directly. The bug this exists
 * to prevent: the backend returns base64 *text*, and handing that string to
 * `new Uint8Array(str)` treats it as array-like, coerces each element to
 * NaN -> 0, and yields a 0-byte file. A backup that looks successful but is
 * empty is worse than a visible failure, because the user discovers the loss
 * only when they need to restore.
 */

/** Decode a base64 string into raw bytes. */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Build a Blob from a base64 string, ready for an object-URL download. */
export function base64ToBlob(base64: string): Blob {
  return new Blob([base64ToBytes(base64)], { type: "application/octet-stream" });
}
