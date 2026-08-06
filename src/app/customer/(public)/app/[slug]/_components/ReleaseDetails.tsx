// src/app/customer/(public)/app/[slug]/_components/ReleaseDetails.tsx
// Server Component that renders release information: version, size, date,
// and what's new. Renders a degraded notice when manifest is null.
//
// Requirements: 9.4, 9.5, 9.6, 9.7, 9.8, 9.9

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Calendar, FileArchive, Hash, Info } from "lucide-react";
import type { ReleaseManifest } from "@/lib/appDistribution/manifest";

interface ReleaseDetailsProps {
  /** The release manifest, or null if unavailable */
  manifest: ReleaseManifest | null;
}

/**
 * Formats a file size in bytes to a human-readable string.
 * Uses MB for sizes >= 1 MB, KB for smaller sizes.
 *
 * @param bytes - The file size in bytes
 * @returns Human-readable file size string
 */
function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

/**
 * Formats an ISO 8601 timestamp to a readable date string.
 * Uses the user's locale for formatting.
 *
 * @param isoString - ISO 8601 timestamp string
 * @returns Formatted date string
 */
function formatReleaseDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-IN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "Unknown";
  }
}

/**
 * ReleaseDetails is a Server Component that renders release information
 * for the app download page.
 *
 * When the manifest is available, it displays:
 * - Version number (Req 9.4)
 * - Human-readable file size (Req 9.5)
 * - Formatted release date (Req 9.6)
 * - What's new section if non-empty (Req 9.7)
 *
 * When the manifest is null (unavailable or parse failed), it renders
 * a "Release details temporarily unavailable" notice instead (Req 9.8).
 *
 * This component never receives or renders:
 * - APK object storage paths
 * - Signed download URLs
 *
 * This ensures the server-rendered markup contains no sensitive paths (Req 9.9).
 *
 * @param props - Component props
 * @param props.manifest - The release manifest, or null if unavailable
 * @returns The release details component
 */
export function ReleaseDetails({ manifest }: ReleaseDetailsProps): React.ReactElement {
  // Manifest unavailable - render degraded notice (Req 9.8)
  if (!manifest) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            Release Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Release details are temporarily unavailable. Please try again later.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Manifest available - render full details
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5 text-primary" aria-hidden="true" />
          Release Details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-4">
          {/* Version */}
          <div className="flex items-start gap-3">
            <div
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center"
              aria-hidden="true"
            >
              <Hash className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Version
              </dt>
              <dd className="font-mono text-sm font-medium">
                {manifest.version}
              </dd>
            </div>
          </div>

          {/* File size */}
          <div className="flex items-start gap-3">
            <div
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center"
              aria-hidden="true"
            >
              <FileArchive className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Size
              </dt>
              <dd className="text-sm font-medium">
                {formatFileSize(manifest.size)}
              </dd>
            </div>
          </div>

          {/* Release date */}
          <div className="flex items-start gap-3">
            <div
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center"
              aria-hidden="true"
            >
              <Calendar className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Released
              </dt>
              <dd className="text-sm font-medium">
                {formatReleaseDate(manifest.releasedAt)}
              </dd>
            </div>
          </div>
        </dl>

        {/* What's new - only render if non-empty (Req 9.7) */}
        {manifest.whatsNew.trim() !== "" && (
          <div className="mt-6 pt-4 border-t">
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <span className="text-primary" aria-hidden="true">✦</span>
              What&apos;s New
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {manifest.whatsNew}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
