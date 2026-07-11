package com.arogyadiet.rider.location;

import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/**
 * Wraps {@link FusedLocationProviderClient} and produces location fixes on an
 * adaptive cadence (design Part D, E.2, ADR-006).
 *
 * <p>Responsibilities:
 * <ul>
 *   <li>Build an adaptive {@link LocationRequest} from {@link LocationEngineConfig},
 *       capped so fixes are produced at intervals not exceeding 15 seconds
 *       (Requirements 1.1–1.6).</li>
 *   <li>Route each fix to {@link Listener#onLocationFix(Location)} after applying
 *       the accuracy gate (Requirement 4.1, 4.2).</li>
 *   <li>Retain the last known good fix. If no acceptable fix arrives within the
 *       timeout (30 s), the last-known fix remains available (Requirement 1.8).</li>
 *   <li>Surface Play Services errors via {@link Listener#onEngineError(int, String)}
 *       without crashing (Requirement 15.2, 15.3).</li>
 *   <li>Detect mid-shift permission revocation within 5 seconds, emit an error
 *       event, pause location capture, and resume within 5 seconds when
 *       permission is re-granted (Requirement 1.10, 15.1).</li>
 * </ul>
 *
 * <p>This class does NOT decide when to start/stop — that is the responsibility
 * of {@link LocationForegroundService}.
 */
public class LocationEngine {

    private static final String TAG = "LocationEngine";

    // -------------------------------------------------------------------------
    // Listener interface
    // -------------------------------------------------------------------------

    /**
     * Callback interface for the {@link LocationForegroundService} to receive
     * accepted fixes and error events from the engine.
     */
    public interface Listener {
        /**
         * Called when a location fix passes the accuracy gate and is accepted.
         * The service should enqueue this into {@link LocationQueue}.
         *
         * @param location the accepted fix (never null)
         */
        void onLocationFix(@NonNull Location location);

        /**
         * Called when the engine encounters a non-fatal error (e.g., Play
         * Services unavailable). The service may surface this to the bridge
         * or post a notification.
         *
         * @param code    an application-defined error code
         * @param message human-readable description
         */
        void onEngineError(int code, @NonNull String message);
    }

    // -------------------------------------------------------------------------
    // Error codes surfaced via Listener.onEngineError
    // -------------------------------------------------------------------------

    /** Play Services is not available on this device. */
    public static final int ERROR_PLAY_SERVICES_UNAVAILABLE = 1;

    /** Location permission was not granted at start time. */
    public static final int ERROR_PERMISSION_MISSING = 2;

    /** A SecurityException was thrown when requesting updates. */
    public static final int ERROR_SECURITY_EXCEPTION = 3;

    // -------------------------------------------------------------------------
    // Instance state
    // -------------------------------------------------------------------------

    private final Context context;
    private final Listener listener;
    private final Handler mainHandler;

    @Nullable
    private FusedLocationProviderClient fusedClient;

    @Nullable
    private LocationCallback locationCallback;

    @Nullable
    private LocationEngineConfig config;

    /** Last accepted fix (passes accuracy gate). Retained across timeouts. */
    @Nullable
    private volatile Location lastKnownFix;

    /** Elapsed realtime (ms) of the last accepted fix for timeout detection. */
    private volatile long lastFixElapsedMs;

    /** Whether the engine is currently requesting updates. */
    private volatile boolean running;

    /**
     * Whether location capture is paused due to permission revocation (Req 15.1).
     * When paused, the LocationCallback is removed but the engine remains
     * "logically running" — the permission checker continues and will resume
     * capture when permission is re-granted.
     */
    private volatile boolean paused;

    /** Timeout runnable that checks for fix staleness. */
    @Nullable
    private Runnable timeoutRunnable;

    /**
     * Periodic runnable that checks for mid-shift permission revocation (Req 15.1).
     * Runs every {@link #PERMISSION_CHECK_INTERVAL_MS} while the engine is running
     * (including while paused, to detect re-grant).
     */
    @Nullable
    private Runnable permissionChecker;

    /** Interval (ms) between permission revocation checks (Req 15.1: within 5s). */
    private static final long PERMISSION_CHECK_INTERVAL_MS = 5_000L;

    // -------------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------------

    /**
     * Create a new LocationEngine.
     *
     * @param context  application context (used to obtain FusedLocationProviderClient)
     * @param listener callback receiver for accepted fixes and errors
     */
    public LocationEngine(@NonNull Context context, @NonNull Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Begin requesting location updates using the supplied configuration.
     *
     * <p>Builds an adaptive {@link LocationRequest} from the config, registers
     * a {@link LocationCallback} with the fused provider, and starts the
     * fix-timeout watchdog.
     *
     * <p>Preconditions: location permission is held; Play Services is available.
     * Violations are reported via {@link Listener#onEngineError} rather than
     * throwing, so the service can handle gracefully.
     *
     * @param engineConfig the cadence/accuracy configuration
     */
    public void start(@NonNull LocationEngineConfig engineConfig) {
        if (running) {
            Log.w(TAG, "start() called while already running; ignoring.");
            return;
        }

        this.config = engineConfig;

        // Obtain the fused location provider client.
        try {
            fusedClient = LocationServices.getFusedLocationProviderClient(context);
        } catch (Exception e) {
            Log.e(TAG, "Play Services unavailable", e);
            listener.onEngineError(ERROR_PLAY_SERVICES_UNAVAILABLE,
                    "FusedLocationProviderClient could not be obtained: " + e.getMessage());
            return;
        }

        // Build the adaptive LocationRequest per ADR-006.
        LocationRequest locationRequest = buildLocationRequest(engineConfig);

        // Create the callback that routes fixes through the accuracy gate.
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult result) {
                handleLocationResult(result);
            }
        };

        // Request updates. Guard against SecurityException (permission revoked).
        try {
            fusedClient.requestLocationUpdates(locationRequest, locationCallback,
                    Looper.getMainLooper());
        } catch (SecurityException se) {
            Log.e(TAG, "SecurityException requesting location updates", se);
            listener.onEngineError(ERROR_SECURITY_EXCEPTION,
                    "Location permission not granted: " + se.getMessage());
            fusedClient = null;
            locationCallback = null;
            return;
        }

        running = true;
        lastFixElapsedMs = SystemClock.elapsedRealtime();
        paused = false;

        // Start the fix-timeout watchdog.
        scheduleTimeoutCheck();

        // Start the periodic permission checker (Req 15.1).
        startPermissionChecker();

        Log.i(TAG, "Location engine started with config: " + engineConfig);
    }

    /**
     * Stop requesting location updates and remove callbacks.
     *
     * <p>After this call, no further fixes are delivered to the listener.
     * The last-known fix is retained for potential use on resume.
     */
    public void stop() {
        if (!running) {
            Log.w(TAG, "stop() called while not running; ignoring.");
            return;
        }

        running = false;
        paused = false;

        // Cancel timeout watchdog.
        if (timeoutRunnable != null) {
            mainHandler.removeCallbacks(timeoutRunnable);
            timeoutRunnable = null;
        }

        // Cancel permission checker.
        if (permissionChecker != null) {
            mainHandler.removeCallbacks(permissionChecker);
            permissionChecker = null;
        }

        // Remove location updates.
        if (fusedClient != null && locationCallback != null) {
            try {
                fusedClient.removeLocationUpdates(locationCallback);
            } catch (Exception e) {
                Log.w(TAG, "Error removing location updates", e);
            }
        }

        locationCallback = null;
        fusedClient = null;
        config = null;

        Log.i(TAG, "Location engine stopped.");
    }

    /**
     * Returns the last accepted fix that passed the accuracy gate, or null if
     * none has been received yet in this session.
     */
    @Nullable
    public Location getLastKnownFix() {
        return lastKnownFix;
    }

    /**
     * Returns whether the engine is currently requesting location updates.
     */
    public boolean isRunning() {
        return running;
    }

    /**
     * Returns whether location capture is paused due to permission revocation.
     * While paused, {@link #isRunning()} is still true (the engine is logically
     * running) but no location updates are being requested until permission
     * is re-granted.
     */
    public boolean isPaused() {
        return paused;
    }

    // -------------------------------------------------------------------------
    // Internal: LocationResult handling and accuracy gate
    // -------------------------------------------------------------------------

    /**
     * Handle a delivered batch of fixes from the fused provider.
     * Applies the accuracy gate and routes accepted fixes to the listener.
     *
     * @param result the batch of locations from FusedLocationProviderClient
     */
    private void handleLocationResult(@NonNull LocationResult result) {
        if (!running || config == null) {
            return;
        }

        for (Location location : result.getLocations()) {
            if (location == null) {
                continue;
            }

            // Accuracy gate: discard fixes worse than the threshold.
            // Requirement 4.2: fixes failing the gate are NOT enqueued.
            if (location.hasAccuracy()
                    && location.getAccuracy() > config.getAccuracyThresholdM()) {
                Log.d(TAG, "Fix discarded by accuracy gate: accuracy="
                        + location.getAccuracy() + "m > threshold="
                        + config.getAccuracyThresholdM() + "m");
                continue;
            }

            // Fix passes the gate — accept it.
            lastKnownFix = location;
            lastFixElapsedMs = SystemClock.elapsedRealtime();

            // Route the accepted fix to the listener (service → queue).
            listener.onLocationFix(location);
        }
    }

    // -------------------------------------------------------------------------
    // Internal: Adaptive LocationRequest construction (ADR-006)
    // -------------------------------------------------------------------------

    /**
     * Build a {@link LocationRequest} from the engine config following ADR-006:
     * <ul>
     *   <li>Priority: HIGH_ACCURACY (GPS + network triangulation).</li>
     *   <li>Interval: capped at 15 s (MAX_INTERVAL_MS).</li>
     *   <li>Fastest interval: configurable, default 5 s.</li>
     *   <li>Smallest displacement (distance filter): configurable, default 25 m.</li>
     * </ul>
     */
    @NonNull
    private LocationRequest buildLocationRequest(@NonNull LocationEngineConfig cfg) {
        return new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY,
                cfg.getDesiredIntervalMs())
                .setMinUpdateIntervalMillis(cfg.getFastestIntervalMs())
                .setMinUpdateDistanceMeters(cfg.getDistanceFilterM())
                .setWaitForAccurateLocation(false)
                .build();
    }

    // -------------------------------------------------------------------------
    // Internal: Fix timeout watchdog (Requirement 1.8)
    // -------------------------------------------------------------------------

    /**
     * Schedule a periodic check for fix timeout. If no acceptable fix has been
     * received within {@link LocationEngineConfig#FIX_TIMEOUT_MS}, the engine
     * retains the last-known fix and logs the timeout. The next interval will
     * attempt a fresh fix automatically (the fused provider keeps requesting).
     */
    private void scheduleTimeoutCheck() {
        timeoutRunnable = new Runnable() {
            @Override
            public void run() {
                if (!running) {
                    return;
                }

                long elapsed = SystemClock.elapsedRealtime() - lastFixElapsedMs;
                if (elapsed >= LocationEngineConfig.FIX_TIMEOUT_MS) {
                    Log.w(TAG, "Fix timeout: " + elapsed + "ms since last accepted fix. "
                            + "Retaining last-known fix.");
                    // The fused provider continues requesting; next fix will
                    // reset the timeout clock. Last-known fix remains available.
                }

                // Re-schedule the check.
                mainHandler.postDelayed(this, LocationEngineConfig.FIX_TIMEOUT_MS);
            }
        };

        mainHandler.postDelayed(timeoutRunnable, LocationEngineConfig.FIX_TIMEOUT_MS);
    }

    // -------------------------------------------------------------------------
    // Internal: Mid-shift permission revocation detection (Req 1.10, 15.1)
    // -------------------------------------------------------------------------

    /**
     * Starts the periodic permission checker that runs every
     * {@link #PERMISSION_CHECK_INTERVAL_MS} (5 seconds) while the engine is running.
     *
     * <p>When permission is revoked:
     * <ul>
     *   <li>Emits {@link #ERROR_PERMISSION_MISSING} via the listener.</li>
     *   <li>Removes the LocationCallback (pauses capture) but keeps the engine
     *       logically running and the service alive.</li>
     *   <li>Sets the {@link #paused} flag.</li>
     * </ul>
     *
     * <p>When permission is re-granted while paused:
     * <ul>
     *   <li>Re-registers the LocationCallback with the fused provider (resumes
     *       capture within 5 seconds of re-grant).</li>
     *   <li>Clears the {@link #paused} flag.</li>
     * </ul>
     */
    private void startPermissionChecker() {
        permissionChecker = new Runnable() {
            @Override
            public void run() {
                if (!running) {
                    return;
                }

                boolean hasPermission = ContextCompat.checkSelfPermission(context,
                        android.Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;

                if (!paused && !hasPermission) {
                    // Permission was just revoked — pause capture (Req 15.1).
                    Log.w(TAG, "Permission revoked mid-shift — pausing location capture.");
                    pauseCapture();
                    listener.onEngineError(ERROR_PERMISSION_MISSING,
                            "Location permission revoked during active shift. "
                                    + "Tracking paused until permission is restored.");
                } else if (paused && hasPermission) {
                    // Permission restored — resume capture (Req 15.1).
                    Log.i(TAG, "Permission restored — resuming location capture.");
                    resumeCapture();
                }

                // Re-schedule regardless of state (keeps checking while paused).
                mainHandler.postDelayed(this, PERMISSION_CHECK_INTERVAL_MS);
            }
        };

        mainHandler.postDelayed(permissionChecker, PERMISSION_CHECK_INTERVAL_MS);
    }

    /**
     * Pauses location capture by removing the LocationCallback from the fused
     * provider. The engine remains logically running (service stays alive) and
     * the permission checker continues to detect when permission is restored.
     */
    private void pauseCapture() {
        paused = true;

        // Remove the location callback to stop receiving updates.
        if (fusedClient != null && locationCallback != null) {
            try {
                fusedClient.removeLocationUpdates(locationCallback);
            } catch (Exception e) {
                Log.w(TAG, "Error removing location updates during pause", e);
            }
        }

        // Cancel timeout watchdog (not meaningful while paused).
        if (timeoutRunnable != null) {
            mainHandler.removeCallbacks(timeoutRunnable);
        }
    }

    /**
     * Resumes location capture by re-registering the LocationCallback with the
     * fused provider. Called when permission is detected as restored after a
     * revocation pause.
     */
    private void resumeCapture() {
        if (!running || config == null) {
            Log.w(TAG, "resumeCapture() called in invalid state — ignoring.");
            return;
        }

        // Re-obtain the fused client if needed.
        if (fusedClient == null) {
            try {
                fusedClient = LocationServices.getFusedLocationProviderClient(context);
            } catch (Exception e) {
                Log.e(TAG, "Cannot obtain FusedLocationProviderClient on resume", e);
                listener.onEngineError(ERROR_PLAY_SERVICES_UNAVAILABLE,
                        "Play Services unavailable on resume: " + e.getMessage());
                return;
            }
        }

        // Re-build the location request from the stored config.
        LocationRequest locationRequest = buildLocationRequest(config);

        // Re-create the callback (the old one was removed during pause).
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult result) {
                handleLocationResult(result);
            }
        };

        // Re-register for updates.
        try {
            fusedClient.requestLocationUpdates(locationRequest, locationCallback,
                    Looper.getMainLooper());
        } catch (SecurityException se) {
            // Permission check said OK but request still failed — stay paused.
            Log.e(TAG, "SecurityException on resume — staying paused", se);
            listener.onEngineError(ERROR_SECURITY_EXCEPTION,
                    "SecurityException on resume: " + se.getMessage());
            return;
        }

        paused = false;
        lastFixElapsedMs = SystemClock.elapsedRealtime();

        // Restart timeout watchdog.
        scheduleTimeoutCheck();

        Log.i(TAG, "Location capture resumed successfully after permission restore.");
    }
}
