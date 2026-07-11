package com.arogyadiet.rider.location;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.VisibleForTesting;

import com.arogyadiet.rider.location.ShiftAuthorityCallback.ShiftAuthority;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Drains the {@link LocationQueue} to the backend with retry and backoff, and
 * live-forwards delivered fixes to the Capacitor bridge when the WebView is
 * alive (design Part D / E.1 / E.2).
 *
 * <p><b>Guarantees:</b>
 * <ul>
 *   <li><b>At-least-once delivery</b>: every fix passing the accuracy gate
 *       reaches the backend at least once or remains queued as PENDING/FAILED
 *       until it does (Requirement 4.7).</li>
 *   <li><b>Never deletes an exhausted fix</b>: fixes that reach 10 failed
 *       attempts stay as FAILED forever (Requirement 15.5).</li>
 *   <li><b>Single-state invariant</b>: fixes are moved to IN_FLIGHT before
 *       delivery attempt, then to DELIVERED or FAILED (Requirement 4.3).</li>
 * </ul>
 *
 * <p><b>Retry / Backoff:</b> Exponential backoff with base 5s, doubling each
 * attempt, capped at 300s, with 0–5s random jitter added. Max 10 attempts
 * per fix (Requirements 4.5, 4.6).
 *
 * <p><b>Lifecycle:</b> Call {@link #start()} to begin periodic draining and
 * {@link #stop()} to cancel. The worker uses a {@link Handler} for scheduling.
 *
 * @see LocationQueue
 * @see DeliveryCallback
 */
public class SyncWorker {

    private static final String TAG = "SyncWorker";

    // -------------------------------------------------------------------------
    // Backoff constants (Requirements 4.5, 4.6)
    // -------------------------------------------------------------------------

    /** Base backoff delay in milliseconds. */
    static final long BACKOFF_BASE_MS = 5_000L;

    /** Maximum backoff delay in milliseconds (cap). */
    static final long BACKOFF_CAP_MS = 300_000L;

    /** Maximum random jitter added to backoff in milliseconds. */
    static final long JITTER_MAX_MS = 5_000L;

    /** Maximum delivery attempts per fix before it stays permanently FAILED. */
    static final int MAX_ATTEMPTS = 10;

    /** Maximum batch size for a single drain cycle. */
    static final int BATCH_SIZE = 100;

    /** Default periodic drain interval when idle (no failures). */
    static final long DEFAULT_DRAIN_INTERVAL_MS = 30_000L;

    // -------------------------------------------------------------------------
    // Fields
    // -------------------------------------------------------------------------

    @NonNull private final LocationQueue queue;
    @NonNull private final DeliveryCallback deliveryCallback;
    @NonNull private final Handler handler;
    @NonNull private final Random random;

    /**
     * Optional callback to check the authoritative (server-side) shift state.
     * When set and returning INACTIVE, the SyncWorker triggers a stop via
     * {@link #stopCallback} (Requirement 12.3, 12.6).
     */
    @Nullable private final ShiftAuthorityCallback shiftAuthorityCallback;

    /**
     * Optional callback to trigger ACTION_STOP_TRACKING when the authoritative
     * shift state is INACTIVE. Required when {@link #shiftAuthorityCallback} is
     * set; ignored otherwise.
     */
    @Nullable private final StopCallback stopCallback;

    private volatile boolean running = false;
    private volatile boolean drainScheduled = false;

    /**
     * Tracks whether the SyncWorker has already issued a stop due to an
     * INACTIVE authoritative state. Once set, the SyncWorker remains stopped
     * and emits no updates until started again (Requirement 12.7).
     */
    private volatile boolean stoppedByAuthority = false;

    /** The pending drain Runnable for cancellation. */
    @Nullable private Runnable pendingDrainRunnable;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * Creates a SyncWorker without shift-authority checking (backward-compatible).
     *
     * @param queue            the durable location queue to drain
     * @param deliveryCallback the pluggable delivery mechanism
     */
    public SyncWorker(@NonNull LocationQueue queue, @NonNull DeliveryCallback deliveryCallback) {
        this(queue, deliveryCallback, null, null, new Handler(Looper.getMainLooper()), new Random());
    }

    /**
     * Creates a SyncWorker with shift-authority checking (Requirement 12.3, 12.6).
     *
     * @param queue                   the durable location queue to drain
     * @param deliveryCallback        the pluggable delivery mechanism
     * @param shiftAuthorityCallback  checks server-side is_online state each drain cycle
     * @param stopCallback            triggers ACTION_STOP_TRACKING when INACTIVE
     */
    public SyncWorker(@NonNull LocationQueue queue,
                      @NonNull DeliveryCallback deliveryCallback,
                      @Nullable ShiftAuthorityCallback shiftAuthorityCallback,
                      @Nullable StopCallback stopCallback) {
        this(queue, deliveryCallback, shiftAuthorityCallback, stopCallback,
                new Handler(Looper.getMainLooper()), new Random());
    }

    /**
     * Constructor with injectable Handler and Random for testing.
     */
    @VisibleForTesting
    SyncWorker(@NonNull LocationQueue queue,
               @NonNull DeliveryCallback deliveryCallback,
               @Nullable ShiftAuthorityCallback shiftAuthorityCallback,
               @Nullable StopCallback stopCallback,
               @NonNull Handler handler,
               @NonNull Random random) {
        this.queue = queue;
        this.deliveryCallback = deliveryCallback;
        this.shiftAuthorityCallback = shiftAuthorityCallback;
        this.stopCallback = stopCallback;
        this.handler = handler;
        this.random = random;
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
     * Start the periodic drain cycle. If already started, this is a no-op.
     * The first drain is triggered immediately.
     * Resets the stopped-by-authority flag so drains resume normally.
     */
    public void start() {
        if (running) {
            return;
        }
        running = true;
        stoppedByAuthority = false;
        scheduleDrain(0);
    }

    /**
     * Stop the periodic drain cycle and cancel any pending scheduled drain.
     * In-progress drain calls will complete but no further drains are scheduled.
     */
    public void stop() {
        running = false;
        cancelPendingDrain();
    }

    /**
     * Returns whether the worker is currently running (started and not stopped).
     */
    public boolean isRunning() {
        return running;
    }

    // -------------------------------------------------------------------------
    // Drain logic
    // -------------------------------------------------------------------------

    /**
     * Execute a single drain cycle:
     * <ol>
     *   <li><b>Authoritative shift-state check (Req 12.3, 12.6):</b> If a
     *       {@link ShiftAuthorityCallback} is configured, query the server-side
     *       {@code is_online} state. If INACTIVE, trigger stop via
     *       {@link StopCallback} and abort the drain — no fixes are processed
     *       or emitted (Req 12.7).</li>
     *   <li>Peek up to 100 PENDING fixes.</li>
     *   <li>Also pick up FAILED fixes eligible for retry (backoff elapsed,
     *       attempts &lt; 10).</li>
     *   <li>Mark the combined batch IN_FLIGHT.</li>
     *   <li>Attempt delivery via the callback.</li>
     *   <li>On success: mark DELIVERED.</li>
     *   <li>On failure: mark FAILED with attempt increment.</li>
     * </ol>
     *
     * <p>After draining, schedules the next cycle — immediately if there are
     * more PENDING fixes, or after backoff if there were failures, or after
     * the default interval if idle.
     *
     * @return result describing what happened during the drain
     */
    @NonNull
    public DrainResult drain() {
        // ---------------------------------------------------------------
        // Step 0: Authoritative shift-state check (Req 12.3, 12.5, 12.6, 12.7).
        //
        // BEFORE processing any fixes, check whether the server says
        // is_online=false for this rider. If so, stop via the single
        // ACTION_STOP_TRACKING path and emit no updates.
        // ---------------------------------------------------------------
        if (shiftAuthorityCallback != null && stopCallback != null) {
            try {
                ShiftAuthority authority = shiftAuthorityCallback.checkAuthoritativeShiftState();
                Log.d(TAG, "Authoritative shift-state check: " + authority);

                if (authority == ShiftAuthority.INACTIVE) {
                    // The rider is off-duty server-side. Stop tracking via the
                    // single clean-stop path (Req 12.5) and cease all drain
                    // activity (Req 12.7 — remain stopped, emit no updates).
                    Log.i(TAG, "Authoritative state INACTIVE — triggering stop via ACTION_STOP_TRACKING.");
                    stoppedByAuthority = true;
                    running = false;
                    cancelPendingDrain();
                    stopCallback.stopTracking();
                    return new DrainResult(0, 0, 0, false);
                }
                // ACTIVE or UNKNOWN — continue with normal drain.
            } catch (Exception e) {
                // If the check throws, treat as UNKNOWN — continue as-is.
                // Don't let a broken authority check kill the drain cycle.
                Log.w(TAG, "Authoritative shift-state check failed — treating as UNKNOWN.", e);
            }
        }

        long now = System.currentTimeMillis();

        // 1. Collect fixes to process: PENDING first, then retryable FAILED.
        List<QueuedLocation> pendingFixes = queue.peekBatch(BATCH_SIZE);
        int remainingCapacity = BATCH_SIZE - pendingFixes.size();

        List<QueuedLocation> retryableFixes = new ArrayList<>();
        if (remainingCapacity > 0) {
            retryableFixes = queue.peekRetryableBatch(remainingCapacity, now);
        }

        // Combine into one batch.
        List<QueuedLocation> batch = new ArrayList<>(pendingFixes.size() + retryableFixes.size());
        batch.addAll(pendingFixes);
        batch.addAll(retryableFixes);

        if (batch.isEmpty()) {
            // Nothing to do — schedule next drain at the default interval.
            if (running) {
                scheduleDrain(DEFAULT_DRAIN_INTERVAL_MS);
            }
            return new DrainResult(0, 0, 0, false);
        }

        // 2. Extract IDs and mark IN_FLIGHT.
        List<Long> batchIds = new ArrayList<>(batch.size());
        for (QueuedLocation fix : batch) {
            batchIds.add(fix.getLocalId());
        }
        queue.markInFlight(batchIds);

        // 3. Attempt delivery.
        boolean deliverySuccess = false;
        boolean deliveryAttempted = false;

        if (deliveryCallback.isAvailable()) {
            deliveryAttempted = true;
            try {
                deliverySuccess = deliveryCallback.deliver(batch);
            } catch (DeliveryException e) {
                Log.w(TAG, "Delivery exception: " + e.getMessage(), e);
                deliverySuccess = false;
            } catch (Exception e) {
                Log.e(TAG, "Unexpected delivery error", e);
                deliverySuccess = false;
            }
        } else {
            Log.d(TAG, "Delivery path unavailable, returning batch to PENDING");
        }

        // 4. Mark results.
        int deliveredCount = 0;
        int failedCount = 0;

        if (deliverySuccess) {
            queue.markDelivered(batchIds);
            deliveredCount = batchIds.size();
            Log.d(TAG, "Delivered " + deliveredCount + " fixes");
        } else if (deliveryAttempted) {
            // Delivery was attempted but failed — mark FAILED with attempt increment.
            queue.markFailed(batchIds);
            failedCount = batchIds.size();
            Log.d(TAG, "Failed to deliver " + failedCount + " fixes");
        } else {
            // Delivery path unavailable — revert to PENDING (at-least-once:
            // fixes stay PENDING until delivered, no silent loss).
            queue.markPending(batchIds);
            Log.d(TAG, "Reverted " + batchIds.size() + " fixes to PENDING (path unavailable)");
        }

        // 5. Determine the highest attempt count in the failed batch for
        //    backoff scheduling.
        boolean hasMore = !queue.peekBatch(1).isEmpty();

        if (running) {
            if (deliverySuccess && hasMore) {
                // More to send — drain again immediately.
                scheduleDrain(0);
            } else if (!deliverySuccess && deliveryAttempted) {
                // Delivery attempted but failed — schedule retry with backoff
                // based on the batch's maximum attempt count.
                int maxAttempts = getMaxAttemptCount(batch);
                long backoff = calculateBackoffWithJitter(maxAttempts);
                scheduleDrain(backoff);
            } else if (!deliveryAttempted) {
                // Path unavailable — schedule retry at default interval.
                // Don't aggressively retry when the WebView is dead.
                scheduleDrain(DEFAULT_DRAIN_INTERVAL_MS);
            } else {
                // Success and nothing left — schedule at default interval.
                scheduleDrain(DEFAULT_DRAIN_INTERVAL_MS);
            }
        }

        return new DrainResult(batch.size(), deliveredCount, failedCount, hasMore);
    }

    /**
     * Trigger an immediate drain (e.g., when new fixes are enqueued).
     * If a drain is already pending or the worker was stopped by authority,
     * this is a no-op.
     */
    public void triggerDrain() {
        if (running && !drainScheduled && !stoppedByAuthority) {
            scheduleDrain(0);
        }
    }

    // -------------------------------------------------------------------------
    // Scheduling
    // -------------------------------------------------------------------------

    /**
     * Schedule the next drain attempt after {@code delayMs} milliseconds.
     *
     * <p>Uses exponential backoff: base 5000ms, doubling, capped at 300000ms,
     * with 0–5000ms random jitter (Requirements 4.5, 4.6).
     *
     * @param delayMs delay before next drain in milliseconds
     */
    public void scheduleRetry(long delayMs) {
        scheduleDrain(delayMs);
    }

    /**
     * Internal scheduling via Handler.
     */
    private void scheduleDrain(long delayMs) {
        cancelPendingDrain();
        drainScheduled = true;

        pendingDrainRunnable = () -> {
            drainScheduled = false;
            if (running) {
                try {
                    drain();
                } catch (Exception e) {
                    Log.e(TAG, "Drain cycle failed unexpectedly", e);
                    // Schedule a retry on unexpected errors.
                    if (running) {
                        scheduleDrain(BACKOFF_BASE_MS + randomJitter());
                    }
                }
            }
        };

        if (delayMs <= 0) {
            handler.post(pendingDrainRunnable);
        } else {
            handler.postDelayed(pendingDrainRunnable, delayMs);
        }
    }

    /**
     * Cancel any pending scheduled drain.
     */
    private void cancelPendingDrain() {
        if (pendingDrainRunnable != null) {
            handler.removeCallbacks(pendingDrainRunnable);
            pendingDrainRunnable = null;
        }
        drainScheduled = false;
    }

    // -------------------------------------------------------------------------
    // Backoff calculation
    // -------------------------------------------------------------------------

    /**
     * Calculate exponential backoff with jitter for scheduling.
     *
     * <p>Formula: base(5s) * 2^(attempts - 1) + random(0..5000ms),
     * capped at 300s + jitter.
     *
     * @param attemptCount the number of failed attempts
     * @return delay in milliseconds including jitter
     */
    long calculateBackoffWithJitter(int attemptCount) {
        long baseDelay = calculateBackoff(attemptCount);
        long jitter = randomJitter();
        return baseDelay + jitter;
    }

    /**
     * Calculate the base backoff delay without jitter.
     *
     * @param attemptCount the number of failed attempts
     * @return base delay in milliseconds (5s * 2^(n-1), capped at 300s)
     */
    static long calculateBackoff(int attemptCount) {
        if (attemptCount <= 0) {
            return BACKOFF_BASE_MS;
        }
        // 5000 * 2^(attemptCount - 1), capped at 300000
        long delay = BACKOFF_BASE_MS * (1L << Math.min(attemptCount - 1, 20));
        return Math.min(delay, BACKOFF_CAP_MS);
    }

    /**
     * Generate a random jitter value between 0 and {@link #JITTER_MAX_MS} ms.
     */
    private long randomJitter() {
        return (long) (random.nextDouble() * JITTER_MAX_MS);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Find the maximum attempt count among a batch of fixes.
     * Used to determine the backoff for the next scheduled retry.
     */
    private int getMaxAttemptCount(@NonNull List<QueuedLocation> batch) {
        int max = 0;
        for (QueuedLocation fix : batch) {
            if (fix.getAttemptCount() > max) {
                max = fix.getAttemptCount();
            }
        }
        // Add 1 because this attempt just failed (the markFailed incremented it).
        return max + 1;
    }

    // -------------------------------------------------------------------------
    // DrainResult
    // -------------------------------------------------------------------------

    /**
     * Result of a single drain cycle, useful for diagnostics and testing.
     */
    public static class DrainResult {
        private final int attempted;
        private final int delivered;
        private final int failed;
        private final boolean hasMore;

        public DrainResult(int attempted, int delivered, int failed, boolean hasMore) {
            this.attempted = attempted;
            this.delivered = delivered;
            this.failed = failed;
            this.hasMore = hasMore;
        }

        /** Total fixes attempted in this drain cycle. */
        public int getAttempted() {
            return attempted;
        }

        /** Fixes successfully delivered. */
        public int getDelivered() {
            return delivered;
        }

        /** Fixes that failed delivery. */
        public int getFailed() {
            return failed;
        }

        /** Whether there are more PENDING fixes to process. */
        public boolean hasMore() {
            return hasMore;
        }

        @Override
        @NonNull
        public String toString() {
            return "DrainResult{"
                    + "attempted=" + attempted
                    + ", delivered=" + delivered
                    + ", failed=" + failed
                    + ", hasMore=" + hasMore
                    + '}';
        }
    }
}
