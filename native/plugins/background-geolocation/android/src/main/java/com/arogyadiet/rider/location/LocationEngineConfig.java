package com.arogyadiet.rider.location;

/**
 * Immutable configuration for {@link LocationEngine}, holding the request
 * parameters extracted from the start-tracking intent extras.
 *
 * <p>Parameters follow ADR-006 (adaptive cadence) and honour the 15-second
 * maximum interval cap (Requirement 1.x).
 */
public final class LocationEngineConfig {

    /** Maximum allowed interval — hard cap per requirements. */
    public static final long MAX_INTERVAL_MS = 15_000L;

    /** Default desired interval between fixes (ms). */
    public static final long DEFAULT_DESIRED_INTERVAL_MS = 10_000L;

    /** Default fastest acceptable interval between fixes (ms). */
    public static final long DEFAULT_FASTEST_INTERVAL_MS = 5_000L;

    /** Default minimum displacement between reported fixes (metres). */
    public static final float DEFAULT_DISTANCE_FILTER_M = 25.0f;

    /** Default accuracy threshold (metres). Fixes worse than this are discarded. */
    public static final float DEFAULT_ACCURACY_THRESHOLD_M = 100.0f;

    /** Timeout (ms) after which we retain last-known fix and retry on next interval. */
    public static final long FIX_TIMEOUT_MS = 30_000L;

    private final long desiredIntervalMs;
    private final long fastestIntervalMs;
    private final float distanceFilterM;
    private final float accuracyThresholdM;

    /**
     * Create a config with all parameters explicit.
     *
     * @param desiredIntervalMs  desired interval (capped at {@link #MAX_INTERVAL_MS})
     * @param fastestIntervalMs  fastest acceptable interval
     * @param distanceFilterM    smallest displacement in metres
     * @param accuracyThresholdM accuracy gate threshold in metres
     */
    public LocationEngineConfig(long desiredIntervalMs, long fastestIntervalMs,
                                float distanceFilterM, float accuracyThresholdM) {
        // Cap desired interval to the max allowed by requirements.
        this.desiredIntervalMs = Math.min(desiredIntervalMs, MAX_INTERVAL_MS);
        // Fastest interval must not exceed desired interval.
        this.fastestIntervalMs = Math.min(fastestIntervalMs, this.desiredIntervalMs);
        this.distanceFilterM = distanceFilterM;
        this.accuracyThresholdM = accuracyThresholdM;
    }

    /**
     * Create a config using defaults (10s desired, 5s fastest, 25m filter, 100m gate).
     */
    public LocationEngineConfig() {
        this(DEFAULT_DESIRED_INTERVAL_MS, DEFAULT_FASTEST_INTERVAL_MS,
             DEFAULT_DISTANCE_FILTER_M, DEFAULT_ACCURACY_THRESHOLD_M);
    }

    /**
     * Build a config from intent extras, falling back to defaults for missing values.
     *
     * @param desiredIntervalMs  from extras, or -1 to use default
     * @param fastestIntervalMs  from extras, or -1 to use default
     * @param distanceFilterM    from extras, or -1 to use default
     */
    public static LocationEngineConfig fromExtras(long desiredIntervalMs,
                                                  long fastestIntervalMs,
                                                  float distanceFilterM) {
        long desired = desiredIntervalMs > 0 ? desiredIntervalMs : DEFAULT_DESIRED_INTERVAL_MS;
        long fastest = fastestIntervalMs > 0 ? fastestIntervalMs : DEFAULT_FASTEST_INTERVAL_MS;
        float distance = distanceFilterM >= 0 ? distanceFilterM : DEFAULT_DISTANCE_FILTER_M;
        return new LocationEngineConfig(desired, fastest, distance, DEFAULT_ACCURACY_THRESHOLD_M);
    }

    public long getDesiredIntervalMs() {
        return desiredIntervalMs;
    }

    public long getFastestIntervalMs() {
        return fastestIntervalMs;
    }

    public float getDistanceFilterM() {
        return distanceFilterM;
    }

    public float getAccuracyThresholdM() {
        return accuracyThresholdM;
    }

    @Override
    public String toString() {
        return "LocationEngineConfig{"
                + "desiredIntervalMs=" + desiredIntervalMs
                + ", fastestIntervalMs=" + fastestIntervalMs
                + ", distanceFilterM=" + distanceFilterM
                + ", accuracyThresholdM=" + accuracyThresholdM
                + '}';
    }
}
