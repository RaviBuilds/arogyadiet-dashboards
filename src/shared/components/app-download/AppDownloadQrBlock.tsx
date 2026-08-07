// src/shared/components/app-download/AppDownloadQrBlock.tsx
// Async Server Component that renders a QR code for app download pages.
// Ships no client JavaScript — pure server rendering.
//
// Security note on dangerouslySetInnerHTML:
// The input to renderQrSvg is an internally constructed URL, never visitor input,
// and the `qrcode` package emits a fixed SVG grammar. No untrusted string reaches
// the markup, making innerHTML safe for this specific use case.

import { cn } from "@/lib/utils";
import type { AppSlug } from "@/lib/appDistribution/slug";
import { renderQrSvg, QR_DEFAULT_WIDTH_PX } from "@/lib/appDistribution/qr";
import { resolveDownloadBaseUrl } from "@/lib/appDistribution/config";

export interface AppDownloadQrBlockProps {
  slug: AppSlug;
  className?: string;
  /** Intrinsic QR edge length in CSS pixels. */
  size?: number;
  /**
   * Classes for the white frame around the code. Pass a width here (plus
   * `[&>svg]:h-auto [&>svg]:w-full`) to scale the code fluidly; the SVG is
   * vector, so `size` only sets its intrinsic dimensions.
   */
  frameClassName?: string;
  /**
   * Print the destination URL as selectable text beneath the code.
   * Off on space-constrained panels; the URL still reaches assistive tech
   * through the code's `aria-label`.
   */
  showUrl?: boolean;
}

/**
 * Renders a QR code block for app download pages.
 *
 * This is an async Server Component that:
 * 1. Resolves the download base URL from environment
 * 2. Returns null with a warning log if base URL is absent (Req 12.7)
 * 3. Builds the absolute Download_Page URL from base URL and slug
 * 4. Renders the QR code as inline SVG
 * 5. Displays the URL as selectable text beneath
 * 6. Includes accessibility text describing the destination
 *
 * Takes only a slug and has no storage access, so it structurally
 * cannot encode a signed URL (Req 12.5).
 *
 * @param props.slug - The app slug ("customer" or "rider")
 * @param props.className - Optional CSS class for the container
 * @returns The QR block element, or null if base URL is not configured
 */
export async function AppDownloadQrBlock({
  slug,
  className,
  size = QR_DEFAULT_WIDTH_PX,
  frameClassName,
  showUrl = true,
}: AppDownloadQrBlockProps): Promise<React.ReactElement | null> {
  // Resolve the download base URL from environment
  const baseUrl = resolveDownloadBaseUrl();

  // Return null with a warning log when base URL is absent (Req 12.7)
  if (!baseUrl) {
    console.warn(
      "[AppDownloadQrBlock] NEXT_PUBLIC_APP_DOWNLOAD_BASE_URL is not set. QR code will not be rendered."
    );
    return null;
  }

  // Build the absolute Download_Page URL from the base URL and slug
  const downloadUrl = `${baseUrl}/app/${slug}`;

  // Render the QR code SVG at an explicit pixel size
  const svgString = await renderQrSvg(downloadUrl, size);

  // Determine app name for accessibility text
  const appName = slug === "customer" ? "Customer" : "Rider";

  return (
    <div className={className}>
      {/* Title instructing the user to scan (Req 13.7) */}
      {/* Colours inherit from the host panel so the block reads correctly on
          both the dark customer brand panel and the light rider card. */}
      <p className="mb-2.5 text-[0.8125rem] font-medium text-current">
        Scan to download the {appName} App
      </p>

      {/* QR code SVG rendered inline (Req 12.4) */}
      {/* Text alternative describing the destination (Req 13.9) */}
      {/* The white padded frame widens the quiet zone beyond the single-module
          margin in the SVG, which is what keeps the code scannable when the
          surrounding panel is dark. */}
      <div
        className={cn(
          "w-fit rounded-lg bg-white p-2.5 shadow-sm [&>svg]:block",
          frameClassName
        )}
        dangerouslySetInnerHTML={{ __html: svgString }}
        aria-label={`QR code linking to the ${appName} app download page at ${downloadUrl}`}
        role="img"
      />

      {/* URL as selectable text beneath the QR code (Req 13.8) */}
      {showUrl && (
        <p className="mt-2 text-xs text-current opacity-70 select-all break-all">
          {downloadUrl}
        </p>
      )}
    </div>
  );
}
