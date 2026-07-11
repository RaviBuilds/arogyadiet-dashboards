package com.arogyadiet.rider.location;

/**
 * The synchronization state of a {@link QueuedLocation} fix in the
 * {@link LocationQueue}.
 *
 * <p>Every queued fix is in exactly one of these states at any time
 * (single-state invariant, design Part D / Requirement 4.3).
 *
 * <p>Lifecycle:
 * <pre>
 *   PENDING → IN_FLIGHT → DELIVERED
 *                       ↘ FAILED (retry → IN_FLIGHT → ...)
 * </pre>
 */
public enum SyncState {

    /** Captured, not yet sent. Initial state on enqueue. */
    PENDING("PENDING"),

    /** Sync attempt in progress. */
    IN_FLIGHT("IN_FLIGHT"),

    /** Confirmed persisted on the backend. Eligible for pruning after retention. */
    DELIVERED("DELIVERED"),

    /** Delivery attempt failed. Awaits next drain cycle for retry. */
    FAILED("FAILED");

    private final String value;

    SyncState(String value) {
        this.value = value;
    }

    /** Returns the string representation stored in the database. */
    public String getValue() {
        return value;
    }

    /**
     * Parse a database-stored string back into a SyncState.
     *
     * @param value the stored string (e.g. "PENDING")
     * @return the corresponding enum value
     * @throws IllegalArgumentException if the value does not match any state
     */
    public static SyncState fromValue(String value) {
        for (SyncState state : values()) {
            if (state.value.equals(value)) {
                return state;
            }
        }
        throw new IllegalArgumentException("Unknown SyncState: " + value);
    }
}
