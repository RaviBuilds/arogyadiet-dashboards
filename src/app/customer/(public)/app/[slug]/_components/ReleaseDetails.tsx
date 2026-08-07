// src/app/customer/(public)/app/[slug]/_components/ReleaseDetails.tsx
// Version, size, release date and what's-new copy, rendered as a slim glass
// strip on the brand panel rather than a standalone white card — the release
// facts are supporting detail next to the download action, not a section of
// their own.
//
// Never receives or renders an APK object path or a signed URL, so the
// server-rendered markup cannot leak a storage location (Req 9.9).
//
// Requirements: 9.4, 9.5, 9.6, 9.7, 9.8, 9.9

import { Calendar, FileArchive, Hash } from "lucide-react";

import type { ReleaseManifest } from "@/lib/appDistribution/manifest";
import type { AppTheme } from "./theme";

interface ReleaseDetailsProps {
  /** The release manifest, or null when it could not be read. */
  manifest: ReleaseManifest | null;
  theme: AppTheme;
}

/** Human-readable file size — MB at or above a megabyte, KB below. */
function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/** Formats an ISO 8601 timestamp for display, falling back on a bad value. */
function formatReleaseDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ReleaseDetails({
  manifest,
  theme,
}: ReleaseDetailsProps): React.ReactElement {
  // Manifest unavailable — degrade to a notice, never fail the page (Req 9.8).
  if (!manifest) {
    return (
      <p className={`text-xs ${theme.mutedText}`}>
        Release details are temporarily unavailable.
      </p>
    );
  }

  const facts = [
    { icon: Hash, label: "Version", value: manifest.version, mono: true },
    { icon: FileArchive, label: "Size", value: formatFileSize(manifest.size), mono: false },
    {
      icon: Calendar,
      label: "Released",
      value: formatReleaseDate(manifest.releasedAt),
      mono: false,
    },
  ] as const;

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-wrap gap-2">
        {facts.map(({ icon: Icon, label, value, mono }) => (
          <div
            key={label}
            className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 ring-1 ring-white/15 backdrop-blur-sm"
          >
            <Icon className={`h-3.5 w-3.5 shrink-0 ${theme.accentText}`} aria-hidden="true" />
            <dt className={`text-[0.65rem] uppercase tracking-wide ${theme.mutedText}`}>
              {label}
            </dt>
            <dd
              className={`text-xs font-semibold text-white ${mono ? "font-mono" : ""}`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {/* What's new — rendered only when non-empty (Req 9.7). */}
      {manifest.whatsNew.trim() !== "" && (
        <p className={`text-xs leading-relaxed whitespace-pre-wrap ${theme.mutedText}`}>
          <span className={`font-semibold ${theme.accentText}`}>What&apos;s new: </span>
          {manifest.whatsNew}
        </p>
      )}
    </div>
  );
}
