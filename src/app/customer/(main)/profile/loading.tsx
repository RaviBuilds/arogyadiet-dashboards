/**
 * Profile loading boundary — mirrors the dashboard's boundary exactly.
 *
 * Renders nothing on purpose. It exists only to create the Suspense boundary
 * so the synchronous customer shell layout (and the branded GlobalLoader) can
 * stream immediately on a cold launch while the profile data resolves behind
 * it. No skeleton flash; navigation is carried by the persistent chrome and
 * the short navigation loader.
 */
export default function ProfileLoading() {
  return null;
}
