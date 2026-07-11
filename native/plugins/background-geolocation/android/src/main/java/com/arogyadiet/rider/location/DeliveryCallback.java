package com.arogyadiet.rider.location;

import androidx.annotation.NonNull;

import java.util.List;

/**
 * Pluggable delivery mechanism for the {@link SyncWorker}.
 *
 * <p>Per design (Part D, ADR-002): the PRIMARY delivery path forwards live
 * fixes to the Capacitor bridge, which then uses the existing JS Supabase
 * upsert. When the WebView is alive, the service provides a bridge-backed
 * implementation. When dead, the queue holds fixes until the WebView returns
 * or an optional native direct-sync path is wired.
 *
 * <p>The actual delivery mechanism is wired in task 4.5; the SyncWorker is
 * agnostic to whether delivery goes through the bridge, direct HTTPS, or
 * both.
 */
public interface DeliveryCallback {

    /**
     * Attempt to deliver a batch of location fixes.
     *
     * <p>The implementation must be synchronous and blocking — it should
     * return only after the delivery attempt completes (success or failure).
     * The SyncWorker processes batches sequentially within a single drain
     * cycle.
     *
     * @param fixes non-empty batch of fixes to deliver (1–100 items)
     * @return {@code true} if delivery was confirmed successful (all fixes
     *         in the batch are persisted on the backend); {@code false} if
     *         delivery failed or could not be confirmed within the timeout
     * @throws DeliveryException if a non-retryable error occurs (e.g.,
     *         authentication failure). The SyncWorker will still mark fixes
     *         as FAILED but may choose to stop retrying.
     */
    boolean deliver(@NonNull List<QueuedLocation> fixes) throws DeliveryException;

    /**
     * Returns whether the delivery path is currently available.
     *
     * <p>For a bridge-backed implementation, this returns true when the
     * WebView is alive and the bridge is connected. The SyncWorker uses
     * this as a fast pre-check before attempting delivery.
     *
     * @return {@code true} if delivery can be attempted
     */
    boolean isAvailable();
}
