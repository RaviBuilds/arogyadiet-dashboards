package com.arogyadiet.rider.location;

/**
 * Shared constants for the hardened background-location service (project-owned
 * fork of {@code @capacitor-community/background-geolocation}).
 *
 * <p>These define the intent contract between the Capacitor bridge and the
 * native {@link LocationForegroundService} (design Part E.3) plus the
 * foreground-notification id. Values only — no behaviour lives here.
 *
 * <p>Skeleton created by task 1.2. Consumers are implemented in tasks 2.x.
 */
public final class LocationConstants {

    private LocationConstants() {
        // No instances — constants holder only.
    }

    // ---------------------------------------------------------------------
    // Intent actions (Capacitor bridge -> service, and internal boot re-arm).
    // Fully-qualified to avoid collisions with other apps' broadcasts.
    // ---------------------------------------------------------------------

    /** Start / continue a shift. Extras carry rider id, notification text and cadence config. */
    public static final String ACTION_START_TRACKING = "com.arogyadiet.rider.location.action.START_TRACKING";

    /** Explicit clean stop of the current shift (the only clean-stop trigger). */
    public static final String ACTION_STOP_TRACKING = "com.arogyadiet.rider.location.action.STOP_TRACKING";

    /** Internal action used by {@link BootReceiver} to request a policy-safe re-arm after reboot. */
    public static final String ACTION_BOOT_REARM = "com.arogyadiet.rider.location.action.BOOT_REARM";

    /**
     * LocalBroadcast action sent by the service when a location fix should be
     * forwarded to the Capacitor bridge (live-forward path, Req 7.5).
     *
     * <p>Extras:
     * <ul>
     *   <li>{@code "latitude"} — double</li>
     *   <li>{@code "longitude"} — double</li>
     *   <li>{@code "accuracy"} — float</li>
     *   <li>{@code "altitude"} — double (0 if unavailable)</li>
     *   <li>{@code "bearing"} — float (0 if unavailable, with "hasBearing" flag)</li>
     *   <li>{@code "speed"} — float (0 if unavailable, with "hasSpeed" flag)</li>
     *   <li>{@code "time"} — long (ms since epoch)</li>
     *   <li>{@code "hasSpeed"} — boolean</li>
     *   <li>{@code "hasBearing"} — boolean</li>
     *   <li>{@code "callbackId"} — String (the saved PluginCall callback id)</li>
     * </ul>
     */
    public static final String ACTION_LOCATION_BROADCAST = "com.arogyadiet.rider.location.action.LOCATION_BROADCAST";

    // ---------------------------------------------------------------------
    // Intent extras keys (start-tracking payload; design Part E.3).
    // ---------------------------------------------------------------------

    /** {@code String} — the rider whose shift this tracking session belongs to. */
    public static final String EXTRA_RIDER_ID = "riderId";

    /** {@code String} — foreground-notification title. */
    public static final String EXTRA_NOTIF_TITLE = "notifTitle";

    /** {@code String} — foreground-notification body text. */
    public static final String EXTRA_NOTIF_MESSAGE = "notifMessage";

    /** {@code float} — smallest displacement (metres) between reported fixes. */
    public static final String EXTRA_DISTANCE_FILTER_M = "distanceFilterM";

    /** {@code long} — desired interval between fixes, in milliseconds. */
    public static final String EXTRA_DESIRED_INTERVAL_MS = "desiredIntervalMs";

    /** {@code long} — fastest acceptable interval between fixes, in milliseconds. */
    public static final String EXTRA_FASTEST_INTERVAL_MS = "fastestIntervalMs";

    /** {@code boolean} — whether the bridge should request runtime permissions. */
    public static final String EXTRA_REQUEST_PERMISSIONS = "requestPermissions";

    /** {@code boolean} — whether stale/last-known fixes are acceptable. */
    public static final String EXTRA_STALE = "stale";

    /** {@code String} — the bridge PluginCall callback ID for live-forwarding location events to JS. */
    public static final String EXTRA_BRIDGE_CALLBACK_ID = "bridgeCallbackId";

    // ---------------------------------------------------------------------
    // Notification.
    // ---------------------------------------------------------------------

    /** Foreground-service notification id. Must be unique within this application. */
    public static final int NOTIFICATION_ID = 28352;
}
