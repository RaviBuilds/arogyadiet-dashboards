/**
 * Public shell layout for APK download pages.
 *
 * This layout is deliberately minimal — no session read, no sidebar, no portal chrome.
 * It exists specifically so the download pages at `/app/customer` and `/app/rider`
 * inherit no session-dependent UI, which is critical because Requirement 1.4 requires
 * byte-identical output for anonymous and authenticated visitors.
 *
 * Unlike `(auth)` and `(main)`, this layout:
 * - Does NOT await cookies or headers (no session lookup)
 * - Does NOT render the GlobalLoader (page renders directly)
 * - Does NOT include any navigation or branding that varies with auth state
 *
 * The children render exactly what the page exports, nothing more.
 *
 * Requirements: 1.3, 1.4, 1.5
 */

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
