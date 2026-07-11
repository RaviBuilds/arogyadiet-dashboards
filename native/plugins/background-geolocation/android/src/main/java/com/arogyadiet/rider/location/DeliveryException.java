package com.arogyadiet.rider.location;

/**
 * Exception thrown by a {@link DeliveryCallback} to indicate a delivery
 * failure that is not simply a timeout or transient network issue.
 *
 * <p>Examples: authentication failure, malformed payload rejection, or
 * server explicitly refusing the batch. The SyncWorker treats this the
 * same as a failed delivery (marks fixes FAILED, increments attempt count)
 * but implementations may use the exception type to log additional context.
 */
public class DeliveryException extends Exception {

    public DeliveryException(String message) {
        super(message);
    }

    public DeliveryException(String message, Throwable cause) {
        super(message, cause);
    }
}
