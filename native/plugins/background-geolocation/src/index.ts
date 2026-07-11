import { registerPlugin } from '@capacitor/core';

import type { BackgroundGeolocationPlugin } from './definitions';

/**
 * The plugin is registered under the name "BackgroundGeolocation" — the SAME
 * name used by upstream and matched by the native `@CapacitorPlugin(name =
 * "BackgroundGeolocation")` annotation. Keeping this name identical is what
 * makes the existing `import { BackgroundGeolocation } from
 * "@capacitor-community/background-geolocation"` JS imports resolve to this
 * fork with no JS edits.
 *
 * Upstream shipped no JS runtime entry (consumers were expected to call
 * `registerPlugin` themselves). This fork adds the runtime entry so the named
 * `BackgroundGeolocation` export the app already imports resolves correctly on
 * native builds.
 */
const BackgroundGeolocation =
  registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export * from './definitions';
export { BackgroundGeolocation };
