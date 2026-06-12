/**
 * Stub for @capacitor-community/keep-awake.
 *
 * Native-only plugin. During web builds, this stub is resolved instead.
 * All actual usage is guarded by Capacitor.isNativePlatform() checks.
 */

export const KeepAwake = {
  keepAwake: async () => {},
  allowSleep: async () => {},
  isSupported: async () => ({ isSupported: false }),
  isKeptAwake: async () => ({ isKeptAwake: false }),
};
