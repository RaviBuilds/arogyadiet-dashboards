/**
 * Dashboard loading boundary.
 *
 * Intentionally renders nothing. Its only job is to create the Suspense
 * boundary that lets the customer layout — and the branded AppLoaderOverlay
 * inside it — stream to the browser immediately on a cold launch, while the
 * dashboard's data resolves behind it. The overlay then covers this empty
 * frame and hands off directly to the fully-rendered dashboard (signalled by
 * AppReadyBeacon), so the user only ever perceives Loader → Dashboard.
 *
 * No skeleton: the branded loader already fulfils that role on cold launch,
 * and on internal navigation the persistent app chrome (header, sidebar,
 * ambient background) plus the route progress bar carry the transition — a
 * lightweight, native tab-switch feel rather than a jarring skeleton.
 */
export default function DashboardLoading() {
  return null;
}
