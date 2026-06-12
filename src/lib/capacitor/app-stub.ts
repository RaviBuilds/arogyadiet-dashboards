/**
 * Stub for @capacitor/app.
 *
 * Native-only plugin for Android back button, app state, and URL handling.
 * During web builds, this stub is resolved instead.
 * All actual usage is guarded by Capacitor.isNativePlatform() checks.
 */

type PluginListenerHandle = { remove: () => Promise<void> };

export const App = {
  addListener: async (
    _eventName: string,
    _listenerFunc: (data: any) => void,
  ): Promise<PluginListenerHandle> => {
    return { remove: async () => {} };
  },
  exitApp: async () => {},
  getInfo: async () => ({
    name: "ArogyaDiet",
    id: "com.arogyadiet.rider",
    build: "1",
    version: "1.0.0",
  }),
  getState: async () => ({ isActive: true }),
  getLaunchUrl: async () => ({ url: "" }),
  minimizeApp: async () => {},
};
