/**
 * Dashboard loading boundary.
 *
 * Intentionally renders nothing. Its only job is to create the Suspense
 * boundary that lets the synchronous customer shell layout — and the branded
 * GlobalLoader inside it — stream to the browser immediately on a cold launch,
 * while the dashboard's data resolves behind it. The GlobalLoader overlay
 * covers this empty frame and crossfades directly into the fully-rendered
 * dashboard once the document is ready, so the user only ever perceives
 * Loader → Dashboard.
 *
 * No skeleton: the branded loader fulfils that role on cold launch, and on
 * internal navigation the persistent chrome (header, sidebar, ambient
 * background) plus the short navigation loader carry the transition.
 */
export default function DashboardLoading() {
  return null;
}
