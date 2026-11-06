/**
 * APNGs keep animating even when the window is behind another app. CSS can
 * pause keyframe animations but not the decoder inside an `<img>`, so while
 * the app is inactive an animated card is swapped for a transparent still.
 * The original URL is restored on focus and the browser reuses its image
 * cache, so no network round-trip is repeated.
 */
export const TRANSPARENT_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function isAnimatedCardUrl(url: string): boolean {
  return /\.apng(?:[?#]|$)/i.test(url);
}

export function visibleImageSrc(url: string, active: boolean): string {
  return active || !isAnimatedCardUrl(url) ? url : TRANSPARENT_IMAGE;
}
