package com.arogyadiet.rider.location;

/**
 * Callback interface used by the {@link SyncWorker} to trigger a tracking stop
 * when the authoritative shift state indicates {@code is_online = false}.
 *
 * <p>The implementation MUST send {@code ACTION_STOP_TRACKING} to the
 * {@link LocationForegroundService} — this is the single clean-stop mechanism
 * (Requirement 8.2, 12.5). The SyncWorker does not stop tracking directly;
 * it delegates through this callback to preserve the single-stop-path invariant.
 *
 * <p><b>Contract:</b>
 * <ul>
 *   <li>The implementation SHOULD be non-blocking (fire-and-forget intent send).</li>
 *   <li>The implementation MUST route through {@code ACTION_STOP_TRACKING} so
 *       the full clean-stop sequence (engine stop, WakeLock release, ShiftState
 *       clear, stopSelf) executes.</li>
 * </ul>
 *
 * @see ShiftAuthorityCallback
 * @see SyncWorker
 * @see LocationConstants#ACTION_STOP_TRACKING
 */
public interface StopCallback {

    /**
     * Trigger an authoritative stop of tracking.
     *
     * <p>Called by the SyncWorker when the server-side shift state is
     * determined to be INACTIVE. The implementation sends
     * {@code ACTION_STOP_TRACKING} to the LocationForegroundService.
     */
    void stopTracking();
}
