package com.arogyadiet.rider.location;

import androidx.annotation.NonNull;

/**
 * Callback interface for checking the authoritative (server-side) shift state.
 *
 * <p>The {@link SyncWorker} calls this on every drain cycle to determine whether
 * the rider's shift is still active on the backend. When the result is
 * {@link ShiftAuthority#INACTIVE}, the SyncWorker triggers a stop via the
 * configured {@link StopCallback}.
 *
 * <p>This is Layer 3 of the off-duty propagation mechanism (design Part J,
 * Requirement 12.3, 12.6): a fallback that guarantees tracking stops within
 * the drain interval (≤ 900s) even when the app is backgrounded/dead and
 * both realtime and push delivery have failed.
 *
 * <p><b>Contract:</b>
 * <ul>
 *   <li>Implementations MUST be non-blocking or have a bounded timeout
 *       (recommended ≤ 10s) so they don't stall the drain cycle.</li>
 *   <li>Implementations SHOULD return {@link ShiftAuthority#UNKNOWN} when
 *       the authoritative state cannot be determined (e.g. no network,
 *       timeout, or the native HTTP client is not yet wired).</li>
 *   <li>The SyncWorker treats UNKNOWN as "continue as-is" — it does NOT
 *       stop tracking on UNKNOWN.</li>
 * </ul>
 *
 * @see SyncWorker
 * @see StopCallback
 */
public interface ShiftAuthorityCallback {

    /**
     * Check the authoritative (server-side) shift state for the current rider.
     *
     * <p>Called on the SyncWorker's drain thread (Handler main looper) at the
     * start of each drain cycle. Implementations that perform network I/O
     * should use a bounded timeout.
     *
     * @return the authoritative shift state
     */
    @NonNull
    ShiftAuthority checkAuthoritativeShiftState();

    /**
     * Represents the authoritative server-side shift state.
     */
    enum ShiftAuthority {
        /**
         * The rider's shift is active on the backend ({@code is_online = true}).
         * Tracking should continue.
         */
        ACTIVE,

        /**
         * The rider's shift is inactive on the backend ({@code is_online = false}).
         * Tracking must stop via {@code ACTION_STOP_TRACKING}.
         */
        INACTIVE,

        /**
         * The authoritative state could not be determined (network error, timeout,
         * or the check is not yet implemented). Tracking continues as-is — no
         * stop is issued.
         */
        UNKNOWN
    }
}
