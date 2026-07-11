package com.arogyadiet.rider.location;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/**
 * Immutable data holder representing a persisted shift state.
 *
 * <p>This is the single source of truth used by recovery components
 * ({@link BootReceiver}, {@code onTaskRemoved}, null-action redelivery)
 * to decide whether to re-arm the {@link LocationForegroundService}.
 *
 * <p>All fields are required and non-empty for a valid state. The
 * {@link ShiftStateStore} enforces this invariant on read: if any field
 * is missing or empty the store returns {@code null}.
 *
 * @see ShiftStateStore
 */
public final class ShiftState {

    private final boolean isActive;
    @NonNull private final String riderId;
    private final long startedAtEpoch;
    @NonNull private final String watcherId;
    @NonNull private final String notifTitle;
    @NonNull private final String notifMessage;

    /**
     * Constructs a new ShiftState.
     *
     * @param isActive       whether the shift is currently active
     * @param riderId        the rider whose shift this belongs to (non-empty)
     * @param startedAtEpoch shift start time in milliseconds since Unix epoch
     * @param watcherId      the watcher id returned to the JS bridge (non-empty)
     * @param notifTitle     foreground notification title (non-empty)
     * @param notifMessage   foreground notification body text (non-empty)
     */
    public ShiftState(
            boolean isActive,
            @NonNull String riderId,
            long startedAtEpoch,
            @NonNull String watcherId,
            @NonNull String notifTitle,
            @NonNull String notifMessage) {
        this.isActive = isActive;
        this.riderId = riderId;
        this.startedAtEpoch = startedAtEpoch;
        this.watcherId = watcherId;
        this.notifTitle = notifTitle;
        this.notifMessage = notifMessage;
    }

    /** Whether the shift is currently active. */
    public boolean isActive() {
        return isActive;
    }

    /** The rider whose shift this tracking session belongs to. */
    @NonNull
    public String getRiderId() {
        return riderId;
    }

    /** Shift start time in milliseconds since the Unix epoch. */
    public long getStartedAtEpoch() {
        return startedAtEpoch;
    }

    /** The watcher id that maps to the JS bridge callback. */
    @NonNull
    public String getWatcherId() {
        return watcherId;
    }

    /** Foreground notification title text. */
    @NonNull
    public String getNotifTitle() {
        return notifTitle;
    }

    /** Foreground notification body text. */
    @NonNull
    public String getNotifMessage() {
        return notifMessage;
    }

    /**
     * Validates that all required string fields are present and non-empty,
     * and that {@code startedAtEpoch} is positive.
     *
     * @return {@code true} if the state is valid for recovery use
     */
    public boolean isValid() {
        return isActive
                && riderId != null && !riderId.trim().isEmpty()
                && startedAtEpoch > 0
                && watcherId != null && !watcherId.trim().isEmpty()
                && notifTitle != null && !notifTitle.trim().isEmpty()
                && notifMessage != null && !notifMessage.trim().isEmpty();
    }

    @Override
    @NonNull
    public String toString() {
        return "ShiftState{"
                + "isActive=" + isActive
                + ", riderId='" + riderId + '\''
                + ", startedAtEpoch=" + startedAtEpoch
                + ", watcherId='" + watcherId + '\''
                + ", notifTitle='" + notifTitle + '\''
                + ", notifMessage='" + notifMessage + '\''
                + '}';
    }
}
