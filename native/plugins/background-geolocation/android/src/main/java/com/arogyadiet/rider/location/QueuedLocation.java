package com.arogyadiet.rider.location;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/**
 * Immutable data holder for a single buffered location fix in the
 * {@link LocationQueue}.
 *
 * <p>Maps 1:1 to a row in the {@code location_queue} SQLite table.
 * Every instance is in exactly one {@link SyncState} (design Part D,
 * Requirement 4.3).
 *
 * <p>The {@code localId} is assigned by the database (autoincrement) on
 * insert; use {@code 0} for new fixes that have not been persisted yet.
 */
public final class QueuedLocation {

    private final long localId;
    @NonNull private final String riderId;
    private final double lat;
    private final double lng;
    private final float accuracyM;
    @Nullable private final Float speedMps;
    @Nullable private final Float bearingDeg;
    private final long capturedAtEpoch;
    @NonNull private final SyncState state;
    private final int attemptCount;
    @Nullable private final Long lastAttemptAt;

    /**
     * Constructs a QueuedLocation.
     *
     * @param localId         autoincrement primary key (0 for unsaved)
     * @param riderId         rider id from the shift
     * @param lat             latitude in degrees
     * @param lng             longitude in degrees
     * @param accuracyM       horizontal accuracy in metres
     * @param speedMps        speed in m/s (nullable)
     * @param bearingDeg      bearing in degrees (nullable)
     * @param capturedAtEpoch capture time in ms since Unix epoch (UTC)
     * @param state           current sync state
     * @param attemptCount    number of failed delivery attempts
     * @param lastAttemptAt   epoch ms of last attempt (nullable)
     */
    public QueuedLocation(
            long localId,
            @NonNull String riderId,
            double lat,
            double lng,
            float accuracyM,
            @Nullable Float speedMps,
            @Nullable Float bearingDeg,
            long capturedAtEpoch,
            @NonNull SyncState state,
            int attemptCount,
            @Nullable Long lastAttemptAt) {
        this.localId = localId;
        this.riderId = riderId;
        this.lat = lat;
        this.lng = lng;
        this.accuracyM = accuracyM;
        this.speedMps = speedMps;
        this.bearingDeg = bearingDeg;
        this.capturedAtEpoch = capturedAtEpoch;
        this.state = state;
        this.attemptCount = attemptCount;
        this.lastAttemptAt = lastAttemptAt;
    }

    /** Database-assigned local id (autoincrement primary key). */
    public long getLocalId() {
        return localId;
    }

    /** The rider this fix belongs to. */
    @NonNull
    public String getRiderId() {
        return riderId;
    }

    /** Latitude in degrees. */
    public double getLat() {
        return lat;
    }

    /** Longitude in degrees. */
    public double getLng() {
        return lng;
    }

    /** Horizontal accuracy in metres. */
    public float getAccuracyM() {
        return accuracyM;
    }

    /** Speed in metres per second, or null if unavailable. */
    @Nullable
    public Float getSpeedMps() {
        return speedMps;
    }

    /** Bearing in degrees, or null if unavailable. */
    @Nullable
    public Float getBearingDeg() {
        return bearingDeg;
    }

    /** Capture time in milliseconds since Unix epoch (UTC). */
    public long getCapturedAtEpoch() {
        return capturedAtEpoch;
    }

    /** Current synchronization state. */
    @NonNull
    public SyncState getState() {
        return state;
    }

    /** Number of failed delivery attempts for this fix. */
    public int getAttemptCount() {
        return attemptCount;
    }

    /** Epoch ms of last delivery attempt, or null if never attempted. */
    @Nullable
    public Long getLastAttemptAt() {
        return lastAttemptAt;
    }

    @Override
    @NonNull
    public String toString() {
        return "QueuedLocation{"
                + "localId=" + localId
                + ", riderId='" + riderId + '\''
                + ", lat=" + lat
                + ", lng=" + lng
                + ", accuracyM=" + accuracyM
                + ", state=" + state.getValue()
                + ", attemptCount=" + attemptCount
                + '}';
    }
}
