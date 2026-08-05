/**
 * Per-browser preference for the on-screen "new notification" popup (toast)
 * that accompanies the notification bell badge.
 *
 * Back-office users (admin / master / franchise) can work on long,
 * concentration-heavy flows where a burst of incoming notifications would be
 * disruptive. The toggle lets them silence the popups without losing the bell
 * badge or the notification list itself.
 *
 * Stored in localStorage keyed per user id so a shared workstation does not
 * leak one operator's preference to the next. Default is enabled.
 *
 * Exposed as a tiny external store so components can read it via
 * `useSyncExternalStore` — that keeps the server render deterministic
 * (always enabled) and avoids a setState-in-effect hydration dance.
 */

const STORAGE_PREFIX = "arogya:notification-popups";

function storageKey(userId?: string): string {
  return userId ? `${STORAGE_PREFIX}:${userId}` : STORAGE_PREFIX;
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Subscribes to preference changes, including changes made in another tab
 * (via the native `storage` event) so multiple open dashboards stay in sync.
 */
export function subscribePopupPreference(onChange: () => void): () => void {
  listeners.add(onChange);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(STORAGE_PREFIX)) {
      onChange();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }

  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

/** Returns the stored preference, defaulting to `true` (popups enabled). */
export function readPopupPreference(userId?: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw === null) return true;
    return raw !== "off";
  } catch {
    // Private mode / storage disabled — fall back to the default.
    return true;
  }
}

/** Server/hydration snapshot: popups are considered enabled by default. */
export function getPopupPreferenceServerSnapshot(): boolean {
  return true;
}

export function writePopupPreference(enabled: boolean, userId?: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), enabled ? "on" : "off");
  } catch {
    // Non-fatal: the preference simply won't persist across reloads.
  }
  emit();
}
