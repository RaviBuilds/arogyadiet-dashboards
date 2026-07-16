/**
 * Profile loading boundary — mirrors the dashboard's boundary exactly.
 *
 * Renders nothing on purpose. It exists only to create the Suspense boundary
 * so the layout (and the branded AppLoaderOverlay) can stream immediately on a
 * cold launch while the profile data resolves behind it. On internal
 * navigation the persistent chrome + route progress bar carry the transition,
 * so there is no skeleton flash and no full-screen loader on tab switches.
 */
export default function ProfileLoading() {
  return null;
}
