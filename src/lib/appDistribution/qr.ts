// src/lib/appDistribution/qr.ts
// QR code SVG generation using the `qrcode` npm package.
// Pure computation, no network call at render time (Req 12.3).
// Wraps qrcode's toString with fixed options for consistent output.

import * as qrcode from "qrcode";

/** Default rendered edge length in CSS pixels. */
export const QR_DEFAULT_WIDTH_PX = 160;

/**
 * Renders an inline SVG QR code for the given URL.
 *
 * Uses medium error correction level and a small margin, optimized for
 * display in a UI context where the code will be scanned from a screen.
 *
 * `width` is passed through deliberately: without it the `qrcode` package
 * emits an SVG carrying only a `viewBox`, which collapses to zero size in
 * any container that does not impose its own dimensions.
 *
 * @param url - The absolute URL to encode in the QR code
 * @param widthPx - Rendered edge length in CSS pixels
 * @returns Promise resolving to an SVG markup string
 * @throws Rejected promise if the URL is invalid or encoding fails
 */
export async function renderQrSvg(
  url: string,
  widthPx: number = QR_DEFAULT_WIDTH_PX
): Promise<string> {
  return qrcode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: widthPx,
  });
}
