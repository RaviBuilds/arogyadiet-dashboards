package com.arogyadiet.rider.location;

import android.content.Context;
import android.os.PowerManager;
import android.util.Log;

/**
 * Acquires and releases a single partial {@link PowerManager.WakeLock} scoped
 * to the delivery shift, tagged {@code "ArogyaDiet:LocationShift"}.
 *
 * <p>Design references: Part E.1 / E.5, ADR-005.
 *
 * <h3>Behaviour contract (Requirements 6.1–6.5):</h3>
 * <ul>
 *   <li><b>Idempotent acquire</b> — acquires exactly one partial WakeLock after
 *       {@code startForeground}. If already held, does nothing (Req 6.1).</li>
 *   <li><b>Failsafe timeout</b> — WakeLock auto-releases after
 *       {@link #FAILSAFE_TIMEOUT_MS} (43 200 000 ms = 12 h max shift) (Req 6.2).</li>
 *   <li><b>Release within 1 s</b> — on stop/destroy/shift-end, release is
 *       synchronous and instant. If no lock held, completes without error (Req 6.3, 6.5).</li>
 *   <li><b>Retry on release failure</b> — up to {@link #MAX_RELEASE_RETRIES}
 *       attempts with error surfaced on final failure (Req 6.4).</li>
 * </ul>
 *
 * <p>Thread safety: all public methods are synchronized on the instance lock.
 */
public class WakeLockManager {

    private static final String TAG = "WakeLockManager";

    /** WakeLock tag visible in battery stats / dumpsys. */
    private static final String WAKELOCK_TAG = "ArogyaDiet:LocationShift";

    /** Failsafe timeout: 43 200 seconds (12 hours) in milliseconds. */
    static final long FAILSAFE_TIMEOUT_MS = 43_200L * 1_000L; // 43200s

    /** Maximum attempts to release the WakeLock on failure. */
    static final int MAX_RELEASE_RETRIES = 3;

    private final PowerManager powerManager;

    /**
     * The single held WakeLock, or {@code null} when none is held.
     * Guarded by {@code synchronized(this)}.
     */
    private PowerManager.WakeLock wakeLock;

    /**
     * Optional listener for surfacing release-failure errors.
     * When {@code null}, errors are logged via {@link Log#e}.
     */
    private ReleaseFailureListener releaseFailureListener;

    /**
     * Callback interface for surfacing WakeLock release failures to the
     * service layer.
     */
    public interface ReleaseFailureListener {
        /**
         * Called when all release retry attempts have been exhausted.
         *
         * @param error the last exception encountered during release
         */
        void onReleaseFailure(Exception error);
    }

    /**
     * Creates a new {@code WakeLockManager}.
     *
     * @param context application or service context (used to obtain
     *                {@link PowerManager})
     * @throws IllegalArgumentException if context is {@code null}
     */
    public WakeLockManager(Context context) {
        if (context == null) {
            throw new IllegalArgumentException("Context must not be null");
        }
        this.powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
    }

    /**
     * Sets an optional listener to receive release-failure notifications.
     *
     * @param listener the listener, or {@code null} to clear
     */
    public void setReleaseFailureListener(ReleaseFailureListener listener) {
        this.releaseFailureListener = listener;
    }

    /**
     * Acquires a single partial WakeLock with the failsafe timeout.
     *
     * <p>This method is <b>idempotent</b>: if a WakeLock is already held,
     * this call is a no-op. Must be called after {@code startForeground}.
     *
     * <p><b>Requirement 6.1:</b> Acquire a SINGLE partial WakeLock.
     * If already held, do NOT acquire another.<br>
     * <b>Requirement 6.2:</b> Failsafe timeout of 43 200 seconds.
     */
    public synchronized void acquire() {
        if (wakeLock != null && wakeLock.isHeld()) {
            // Already held — idempotent no-op (Req 6.1).
            Log.d(TAG, "acquire(): WakeLock already held, skipping.");
            return;
        }

        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG);
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(FAILSAFE_TIMEOUT_MS);

        Log.i(TAG, "acquire(): Partial WakeLock acquired with failsafe timeout "
                + FAILSAFE_TIMEOUT_MS + " ms.");
    }

    /**
     * Releases the held WakeLock within 1 second.
     *
     * <p>If no WakeLock is currently held, this completes without error
     * (no-op release — Req 6.3).
     *
     * <p>If release throws, retries up to {@link #MAX_RELEASE_RETRIES} times.
     * After exhausting retries, surfaces the error via the registered
     * {@link ReleaseFailureListener} or {@link Log#e} (Req 6.4).
     *
     * <p><b>Requirement 6.3:</b> Release within 1 s on stop/destroy.
     * No-op when none held.<br>
     * <b>Requirement 6.4:</b> Retry up to 3 times, surface error on failure.<br>
     * <b>Requirement 6.5:</b> Release within 1 s on shift-end.
     */
    public synchronized void release() {
        if (wakeLock == null || !wakeLock.isHeld()) {
            // No-op when none held (Req 6.3).
            Log.d(TAG, "release(): No WakeLock held, no-op.");
            return;
        }

        Exception lastError = null;

        for (int attempt = 1; attempt <= MAX_RELEASE_RETRIES; attempt++) {
            try {
                wakeLock.release();
                Log.i(TAG, "release(): WakeLock released on attempt " + attempt + ".");
                wakeLock = null;
                return; // Success
            } catch (Exception e) {
                lastError = e;
                Log.w(TAG, "release(): Attempt " + attempt + " of " + MAX_RELEASE_RETRIES
                        + " failed: " + e.getMessage());
            }
        }

        // All retries exhausted — surface error (Req 6.4).
        Log.e(TAG, "release(): Failed to release WakeLock after " + MAX_RELEASE_RETRIES
                + " attempts.", lastError);

        if (releaseFailureListener != null) {
            releaseFailureListener.onReleaseFailure(lastError);
        }

        // Null out reference to avoid leaking a stale lock object, even though
        // we couldn't confirm release. The failsafe timeout will auto-release.
        wakeLock = null;
    }

    /**
     * Returns whether a WakeLock is currently held.
     *
     * @return {@code true} if a WakeLock is acquired and held
     */
    public synchronized boolean isHeld() {
        return wakeLock != null && wakeLock.isHeld();
    }
}
