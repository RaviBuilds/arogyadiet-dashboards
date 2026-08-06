// src/lib/appDistribution/qr.ts
// QR code SVG generation using the `qrcode` npm package.
// Pure computation, no network call at render time (Req 12.3).
// Wraps qrcode's toString with fixed options for consistent output.

import * as qrcode from "qrcode";

/**
 * Renders an inline SVG QR code for the given URL.
 *
 * Uses medium error correction level and a small margin, optimized for
 * display in a UI context where the code will be scanned from a screen.
 *
 * @param url - The absolute URL to encode in the QR code
 * @returns Promise resolving to an SVG markup string
 * @throws Rejected promise if the URL is invalid or encoding fails
 */
export async function renderQrSvg(url: string): Promise<string> {
  return qrcode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
  });
}
