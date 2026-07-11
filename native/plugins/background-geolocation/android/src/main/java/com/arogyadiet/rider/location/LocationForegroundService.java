package com.arogyadiet.rider.location;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import java.util.List;

/**
 * Started + Foreground Service that owns the shift's location lifecycle
 * (design Part E.1 / E.2).
 *
 * <p>Unlike the audited bound-service baseline, this service is started with
 * {@code startForegroundService} and returns {@code START_STICKY}, so it
 * outlives the WebView Activity binding and is recreated by the OS after a
 * low-memory kill. Clean teardown happens only on {@code ACTION_STOP_TRACKING}.
 *
 * <p>Implements {@link LocationEngine.Listener} to receive accepted fixes from
 * the engine (routed to the queue in later tasks).
 *
 * <h3>Task 2.3 scope:</h3>
 * <ul>
 *   <li>{@code onCreate()}: instantiate collaborators, create notification channel.</li>
 *   <li>{@code onStartCommand()}: dispatch on intent action —
 *       ACTION_START_TRACKING, ACTION_STOP_TRACKING, null (OS redelivery).</li>
 *   <li>{@code promoteToForeground()}: build notification + call startForeground
 *       with type=location.</li>
 * </ul>
 *
 * @see LocationConstants
 * @see ShiftStateStore
 * @see LocationEngine
 * @see WakeLockManager
 */
public class LocationForegroundService extends Service implements LocationEngine.Listener {

    private static final String TAG = "LocationFGService";

    /** Notification channel ID for the foreground service notification. */
    private static final String CHANNEL_ID = "arogyadiet_location_tracking";

    /** Notification channel ID for re-arm / error alerts (higher importance). */
    private static final String CHANNEL_ALERTS_ID = "arogyadiet_location_alerts";

    /** Notification ID for the policy-safe re-arm tap notification. */
    private static final int REARM_NOTIFICATION_ID = 28353;

    /** Notification ID for the "could not resume" failure notification (Req 3.6). */
    private static final int RESUME_FAILED_NOTIFICATION_ID = 28354;

    /** Maximum number of redelivery retry attempts before giving up (Req 3.6). */
    private static final int MAX_REDELIVERY_RETRIES = 3;

    /** Interval between redelivery retry attempts in milliseconds (Req 3.6). */
    private static final long REDELIVERY_RETRY_INTERVAL_MS = 10_000L; // 10 seconds

    // -------------------------------------------------------------------------
    // Redelivery retry state (Req 3.6)
    // -------------------------------------------------------------------------

    /**
     * Tracks the number of consecutive failed redelivery attempts.
     * Reset to 0 on successful resume; incremented on each failure.
     * After reaching {@link #MAX_REDELIVERY_RETRIES}, a rider-visible
     * "could not resume" notification is posted and no further retries occur.
     */
    private int redeliveryAttemptCount = 0;

    /**
     * Handler on the main looper used to schedule delayed redelivery retries
     * at 10-second intervals.
     */
    private Handler retryHandler;

    /**
     * Runnable that re-invokes {@link #handleNullActionRedelivery()} for retry.
     */
    private final Runnable redeliveryRetryRunnable = new Runnable() {
        @Override
        public void run() {
            Log.i(TAG, "Redelivery retry triggered (attempt "
                    + (redeliveryAttemptCount + 1) + "/" + MAX_REDELIVERY_RETRIES + ").");
            handleNullActionRedelivery();
        }
    };

    // -------------------------------------------------------------------------
    // Collaborators (instantiated in onCreate)
    // -------------------------------------------------------------------------

    private ShiftStateStore shiftStateStore;
    private LocationEngine engine;
    private WakeLockManager wakeLockManager;
    private LocationQueue queue;
    private SyncWorker syncWorker;

    // -------------------------------------------------------------------------
    // Live-forwarding state
    // -------------------------------------------------------------------------

    /**
     * Indicates whether the WebView Activity is currently bound.
     * When false, live-forwarding to the Capacitor bridge is paused but
     * the engine and queue keep running.
     */
    private volatile boolean isWebViewBound = false;

    // -------------------------------------------------------------------------
    // Play Services retry state (Req 15.2, 15.3)
    // -------------------------------------------------------------------------

    /** Maximum number of Play Services availability retries. */
    private static final int PLAY_SERVICES_MAX_RETRIES = 10;

    /** Interval between Play Services retry attempts (ms). */
    private static final long PLAY_SERVICES_RETRY_INTERVAL_MS = 30_000L;

    /** Notification ID for the "Play Services unavailable" alert. */
    private static final int PLAY_SERVICES_NOTIFICATION_ID = 28354;

    /** Notification ID for the "Permission required" alert (Req 15.1). */
    private static final int PERMISSION_NOTIFICATION_ID = 28355;

    /** Current number of Play Services retry attempts. */
    private int playServicesRetryCount = 0;

    /**
     * When true, the service is awaiting a Play Services retry and should NOT
     * stop itself even though the engine isn't running. This prevents the
     * stop-on-failure paths in handleStartTracking/handleNullActionRedelivery
     * from killing the service before the retry fires.
     */
    private volatile boolean awaitingPlayServicesRetry = false;

    /** The Runnable for the scheduled Play Services retry, if any. */
    @Nullable
    private Runnable playServicesRetryRunnable;

    /**
     * The Capacitor bridge callback ID for forwarding location events to JS.
     * Set by the bridge via {@link #setBridgeCallbackId(String)} when a watcher
     * is registered (task 6.2, Req 7.5). Null when no watcher is active.
     */
    @Nullable
    private volatile String bridgeCallbackId = null;

    // -------------------------------------------------------------------------
    // Service lifecycle
    // -------------------------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "onCreate()");

        // Initialize the retry handler on the main looper (Req 3.6).
        retryHandler = new Handler(Looper.getMainLooper());

        // Instantiate collaborators.
        shiftStateStore = new ShiftStateStore(this);
        engine = new LocationEngine(this, this);
        wakeLockManager = new WakeLockManager(this);
        queue = new LocationQueue(this);

        // Create SyncWorker with a bridge-backed DeliveryCallback (Req 4.9)
        // and a ShiftAuthorityCallback for the authoritative shift-state check
        // (Req 12.3, 12.6, 12.7).
        //
        // DeliveryCallback: When the WebView is alive, deliver() sends a
        // LocalBroadcast with the location fix data so the bridge's
        // ServiceReceiver forwards it to JS (Req 7.5). When the WebView is
        // dead, delivery is unavailable and fixes stay queued (Req 7.6).
        DeliveryCallback deliveryCallback = new DeliveryCallback() {
            @Override
            public boolean deliver(@NonNull List<QueuedLocation> fixes) {
                // Only forward when the WebView is alive (Req 7.5, 7.6).
                if (!isWebViewBound || bridgeCallbackId == null) {
                    return false;
                }

                // Broadcast each fix to the bridge's ServiceReceiver via
                // LocalBroadcastManager. The receiver matches on
                // ACTION_LOCATION_BROADCAST and forwards to the saved PluginCall.
                LocalBroadcastManager broadcastManager =
                        LocalBroadcastManager.getInstance(LocationForegroundService.this);

                for (QueuedLocation fix : fixes) {
                    Intent intent = new Intent(LocationConstants.ACTION_LOCATION_BROADCAST);
                    intent.putExtra("latitude", fix.getLat());
                    intent.putExtra("longitude", fix.getLng());
                    intent.putExtra("accuracy", fix.getAccuracyM());
                    intent.putExtra("altitude", 0.0); // altitude not stored in queue
                    intent.putExtra("speed", fix.getSpeedMps() != null ? fix.getSpeedMps() : 0f);
                    intent.putExtra("hasSpeed", fix.getSpeedMps() != null);
                    intent.putExtra("bearing", fix.getBearingDeg() != null ? fix.getBearingDeg() : 0f);
                    intent.putExtra("hasBearing", fix.getBearingDeg() != null);
                    intent.putExtra("time", fix.getCapturedAtEpoch());
                    intent.putExtra("callbackId", bridgeCallbackId);
                    broadcastManager.sendBroadcast(intent);
                }

                return true;
            }

            @Override
            public boolean isAvailable() {
                return isWebViewBound && bridgeCallbackId != null;
            }
        };

        // ShiftAuthorityCallback (Req 12.3, 12.6): Layer 3 of off-duty
        // propagation. Checks the server-side is_online state on each drain
        // cycle. When INACTIVE, the SyncWorker triggers stop via StopCallback.
        //
        // Current implementation: stub returning UNKNOWN. This is the pragmatic
        // approach per design — Layers 1 (realtime subscription) and 2 (push
        // notification) handle the fast path. Layer 3 is the bounded-window
        // fallback. When a native HTTP client is wired to check
        // rider_profiles.is_online from Supabase REST API, this will return
        // ACTIVE or INACTIVE.
        ShiftAuthorityCallback shiftAuthority = new ShiftAuthorityCallback() {
            @NonNull
            @Override
            public ShiftAuthorityCallback.ShiftAuthority checkAuthoritativeShiftState() {
                // TODO: Wire native HTTP GET to Supabase REST API:
                // GET /rest/v1/rider_profiles?select=is_online&id=eq.{riderId}
                // with apikey header and service-role key.
                // Return ACTIVE if is_online=true, INACTIVE if false.
                // Use a 10s timeout to avoid stalling the drain cycle.
                //
                // For now, return UNKNOWN (continue as-is). Layers 1 and 2
                // handle off-duty propagation via realtime/push.
                return ShiftAuthorityCallback.ShiftAuthority.UNKNOWN;
            }
        };

        // StopCallback (Req 12.5): sends ACTION_STOP_TRACKING to this service.
        // Preserves the single-stop-path invariant — all off-duty triggers
        // converge on ACTION_STOP_TRACKING for the clean-stop sequence.
        StopCallback stopAction = new StopCallback() {
            @Override
            public void stopTracking() {
                Log.i(TAG, "StopCallback: sending ACTION_STOP_TRACKING "
                        + "(authoritative off-duty, Req 12.3).");
                Intent stopIntent = new Intent(LocationForegroundService.this,
                        LocationForegroundService.class);
                stopIntent.setAction(LocationConstants.ACTION_STOP_TRACKING);
                startService(stopIntent);
            }
        };

        syncWorker = new SyncWorker(queue, deliveryCallback, shiftAuthority, stopAction);

        // Create notification channel (required for Android O+).
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        String action = (intent != null) ? intent.getAction() : null;
        Log.i(TAG, "onStartCommand() action=" + action + " flags=" + flags
                + " startId=" + startId);

        if (LocationConstants.ACTION_START_TRACKING.equals(action)) {
            handleStartTracking(intent);
        } else if (LocationConstants.ACTION_STOP_TRACKING.equals(action)) {
            handleStopTracking();
            return START_NOT_STICKY;
        } else {
            // Null action = OS redelivery after process kill (START_STICKY).
            handleNullActionRedelivery();
        }

        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        // TODO(task 6.x): return a binder for the Capacitor bridge live-forwarding path.
        isWebViewBound = true;
        Log.i(TAG, "onBind() — WebView bound, live-forwarding enabled.");
        return null;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        // Corrected behaviour (design Part E.2, Req 2.1, 2.2):
        // Do NOT remove location updates or call stopSelf().
        // Only pause live-forwarding; keep the foreground notification and engine running.
        isWebViewBound = false;
        Log.i(TAG, "onUnbind() — live-forwarding paused, service stays alive.");
        return false;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.i(TAG, "onTaskRemoved() — app swiped from Recents.");

        // Read persisted ShiftState to determine if the shift is active (Req 3.2, 3.3).
        ShiftState persisted = shiftStateStore.get();

        if (persisted != null && persisted.isActive()) {
            // Shift is active — schedule a restart within 5 seconds (Req 3.2).
            // Use a null-action intent so the service resumes from persisted
            // ShiftState via the handleNullActionRedelivery() path. This is
            // simpler and correct because the persisted state has all the config.
            Log.i(TAG, "onTaskRemoved: shift active — scheduling restart in 5s.");
            scheduleRestartAlarm();
        } else {
            // Shift is NOT active — normal teardown with no restart (Req 3.3).
            Log.i(TAG, "onTaskRemoved: shift inactive — normal teardown, no restart.");
        }

        // NEVER remove location updates or stop the engine here (Req 8.3).
        // The engine and queue continue running; only an explicit
        // ACTION_STOP_TRACKING performs a clean stop.

        // Always call super (ensures proper OS cleanup of the task record).
        super.onTaskRemoved(rootIntent);
    }

    /**
     * Schedules a restart of this service within 5 seconds using AlarmManager.
     *
     * <p>Uses {@link AlarmManager#setExactAndAllowWhileIdle} to fire even in
     * Doze mode. The PendingIntent uses a null action (no explicit action set)
     * so the service's {@code onStartCommand} receives it as an OS redelivery
     * and resumes from persisted {@link ShiftState}.
     *
     * <p>This provides a complementary recovery mechanism to START_STICKY:
     * on some OEM ROMs, START_STICKY redelivery is delayed or not honored
     * after swipe-away. The alarm guarantees the 5-second bound (Req 3.2).
     */
    private void scheduleRestartAlarm() {
        AlarmManager alarmManager = (AlarmManager) getSystemService(ALARM_SERVICE);
        if (alarmManager == null) {
            Log.e(TAG, "scheduleRestartAlarm: AlarmManager unavailable — relying on START_STICKY.");
            return;
        }

        // Build an explicit intent targeting this service with no action (null action).
        // The null-action redelivery handler will resume from persisted ShiftState.
        Intent restartIntent = new Intent(this, LocationForegroundService.class);

        // PendingIntent.getForegroundService() requires API 26 (Android O). On
        // API 24/25 there are no background-start restrictions, so a plain
        // getService() PendingIntent restarts the service correctly. Guard the
        // call so the module compiles and runs on minSdk 24.
        PendingIntent pendingIntent;
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            pendingIntent = PendingIntent.getForegroundService(
                    this,
                    LocationConstants.NOTIFICATION_ID, // request code — reuse notification id for uniqueness
                    restartIntent,
                    piFlags
            );
        } else {
            pendingIntent = PendingIntent.getService(
                    this,
                    LocationConstants.NOTIFICATION_ID,
                    restartIntent,
                    piFlags
            );
        }

        long triggerAtMillis = System.currentTimeMillis() + 5000; // 5 seconds from now

        // setExactAndAllowWhileIdle works through Doze and is available on API 23+.
        alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                triggerAtMillis,
                pendingIntent
        );

        Log.i(TAG, "scheduleRestartAlarm: alarm set for " + triggerAtMillis
                + " (~5s from now).");
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "onDestroy() — cleaning up resources.");

        // 0. Cancel any pending redelivery retry callbacks (Req 3.6).
        if (retryHandler != null) {
            retryHandler.removeCallbacks(redeliveryRetryRunnable);
            // Also cancel any pending Play Services retry (Req 15.2).
            if (playServicesRetryRunnable != null) {
                retryHandler.removeCallbacks(playServicesRetryRunnable);
                playServicesRetryRunnable = null;
            }
            awaitingPlayServicesRetry = false;
            Log.d(TAG, "onDestroy: pending retries cancelled.");
        }

        // 1. Stop the Location Engine and remove callbacks (Req 2.8).
        if (engine != null) {
            engine.stop();
            Log.d(TAG, "onDestroy: engine stopped.");
        }

        // 2. Release WakeLock (Req 2.8).
        if (wakeLockManager != null) {
            wakeLockManager.release();
            Log.d(TAG, "onDestroy: WakeLock released.");
        }

        // 3. Stop SyncWorker to cancel any pending drain callbacks.
        if (syncWorker != null) {
            syncWorker.stop();
            Log.d(TAG, "onDestroy: SyncWorker stopped.");
        }

        // 4. Flush pending queue to durable storage (Req 2.8, 2.9).
        //    Since LocationQueue uses SQLite with synchronous transactions,
        //    all enqueued fixes are already on disk. Calling close() ensures
        //    any open database connections are cleanly shut down and no
        //    in-memory state is lost. The 5-second bound from the design spec
        //    is inherently met by SQLite's synchronous write model.
        if (queue != null) {
            queue.close();
            Log.d(TAG, "onDestroy: queue flushed and closed.");
        }

        // 5. Do NOT clear ShiftState here (Req 8.3).
        //    onDestroy is NOT an explicit stop — ShiftState stays persisted
        //    so START_STICKY / onTaskRemoved scheduling can resume the service.

        // 6. Reset live-forwarding state.
        isWebViewBound = false;

        super.onDestroy();
        Log.i(TAG, "onDestroy() — complete. ShiftState preserved for recovery.");
    }

    // -------------------------------------------------------------------------
    // Transient lifecycle events — explicit no-ops (Req 8.3)
    //
    // These methods are overridden solely to document that they NEVER perform
    // a clean stop. Only ACTION_STOP_TRACKING triggers a clean stop (Req 8.2).
    // ShiftState is always preserved so recovery paths can resume the service.
    // -------------------------------------------------------------------------

    /**
     * Called when the system is running low on memory.
     *
     * <p><b>Explicit no-op (Req 8.3):</b> This is a transient lifecycle event.
     * We NEVER perform a clean stop here. The service remains running with
     * ShiftState preserved. The OS may kill us, but START_STICKY will bring
     * us back.
     */
    @Override
    public void onLowMemory() {
        super.onLowMemory();
        Log.w(TAG, "onLowMemory() — transient event, NOT performing clean stop. "
                + "ShiftState preserved for recovery (Req 8.3).");
        // Intentionally empty — no clean stop, no ShiftState clear.
    }

    /**
     * Called when the system requests that processes trim their memory usage.
     *
     * <p><b>Explicit no-op (Req 8.3):</b> This is a transient lifecycle event.
     * We NEVER perform a clean stop here. The service continues tracking with
     * ShiftState preserved regardless of memory trim level.
     *
     * @param level the trim level hint from the system
     */
    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        Log.w(TAG, "onTrimMemory(level=" + level + ") — transient event, NOT performing "
                + "clean stop. ShiftState preserved for recovery (Req 8.3).");
        // Intentionally empty — no clean stop, no ShiftState clear.
    }

    // -------------------------------------------------------------------------
    // LocationEngine.Listener implementation
    // -------------------------------------------------------------------------

    @Override
    public void onLocationFix(@NonNull Location location) {
        Log.d(TAG, "onLocationFix: lat=" + location.getLatitude()
                + " lng=" + location.getLongitude()
                + " acc=" + location.getAccuracy());

        // Dismiss the permission-required notification if it was posted (Req 15.1).
        // A fix arriving means capture has resumed successfully.
        dismissPermissionNotificationIfNeeded();

        // Get the riderId from the persisted ShiftState. If no valid state
        // exists (shouldn't happen while engine is running), use "unknown".
        String riderId = "unknown";
        ShiftState currentState = shiftStateStore.get();
        if (currentState != null) {
            riderId = currentState.getRiderId();
        }

        // Build a QueuedLocation from the Location fix (Req 4.1).
        // The localId is 0 (assigned by DB on insert), state is PENDING,
        // attemptCount is 0, lastAttemptAt is null.
        QueuedLocation fix = new QueuedLocation(
                0L,                                          // localId (assigned by DB)
                riderId,
                location.getLatitude(),
                location.getLongitude(),
                location.getAccuracy(),
                location.hasSpeed() ? location.getSpeed() : null,
                location.hasBearing() ? location.getBearing() : null,
                location.getTime(),                          // capturedAtEpoch (UTC ms)
                SyncState.PENDING,
                0,                                           // attemptCount
                null                                         // lastAttemptAt
        );

        // Enqueue the fix into the durable queue.
        queue.enqueue(fix);

        // Trigger an opportunistic drain to deliver the fix ASAP (Req 4.9).
        if (syncWorker != null) {
            syncWorker.triggerDrain();
        }
    }

    @Override
    public void onEngineError(int code, @NonNull String message) {
        Log.e(TAG, "Engine error [" + code + "]: " + message);

        // Surface the error to the Capacitor bridge when the WebView is alive
        // (Req 15.3).
        if (bridgeErrorListener != null && isWebViewBound) {
            bridgeErrorListener.onServiceError(code, message);
        }

        // Handle specific error codes with resilience mechanisms.
        switch (code) {
            case LocationEngine.ERROR_PLAY_SERVICES_UNAVAILABLE:
                // Play Services retry (Req 15.2, 15.3): retry at 30s intervals
                // up to 10 attempts without crashing.
                handlePlayServicesUnavailable();
                break;

            case LocationEngine.ERROR_PERMISSION_MISSING:
                // Mid-shift permission revocation (Req 15.1): post a notification
                // informing the rider that location permission is required.
                // The engine's own permission checker handles pause/resume;
                // the service just posts the notification here.
                postPermissionRequiredNotification();
                break;

            default:
                // Other errors are surfaced above and logged.
                break;
        }
    }

    // -------------------------------------------------------------------------
    // Play Services retry logic (Req 15.2, 15.3)
    // -------------------------------------------------------------------------

    /**
     * Schedules a Play Services availability retry after
     * {@link #PLAY_SERVICES_RETRY_INTERVAL_MS} (30s). Retries up to
     * {@link #PLAY_SERVICES_MAX_RETRIES} (10) times. After exhausting retries,
     * posts a notification and stops retrying (but does not crash or stop self —
     * the shift state is preserved for manual recovery).
     */
    private void handlePlayServicesUnavailable() {
        playServicesRetryCount++;
        Log.w(TAG, "Play Services unavailable — retry " + playServicesRetryCount
                + "/" + PLAY_SERVICES_MAX_RETRIES);

        if (playServicesRetryCount > PLAY_SERVICES_MAX_RETRIES) {
            // Exhausted retries — post notification and stop retrying.
            Log.e(TAG, "Play Services retry limit reached (" + PLAY_SERVICES_MAX_RETRIES
                    + "). Posting notification.");
            awaitingPlayServicesRetry = false;
            postPlayServicesExhaustedNotification();
            return;
        }

        // Mark that we're awaiting a retry — prevents stopSelf in the caller.
        awaitingPlayServicesRetry = true;

        // Schedule a retry after 30 seconds.
        if (playServicesRetryRunnable != null) {
            retryHandler.removeCallbacks(playServicesRetryRunnable);
        }

        playServicesRetryRunnable = new Runnable() {
            @Override
            public void run() {
                Log.i(TAG, "Play Services retry attempt " + playServicesRetryCount
                        + "/" + PLAY_SERVICES_MAX_RETRIES);

                // Check if we still have a valid shift state to resume.
                ShiftState persisted = shiftStateStore.get();
                if (persisted == null || !persisted.isActive()) {
                    Log.w(TAG, "Shift no longer active during Play Services retry — aborting.");
                    playServicesRetryCount = 0;
                    awaitingPlayServicesRetry = false;
                    return;
                }

                // Guard on permission before attempting engine restart.
                if (!hasLocationPermission()) {
                    Log.w(TAG, "Permission not held during Play Services retry — skipping.");
                    // Re-schedule another retry (permission may come back).
                    handlePlayServicesUnavailable();
                    return;
                }

                // Attempt to restart the engine.
                LocationEngineConfig config = new LocationEngineConfig();
                engine.start(config);

                if (engine.isRunning()) {
                    // Success — reset retry count, start sync worker.
                    Log.i(TAG, "Play Services retry succeeded — engine running.");
                    playServicesRetryCount = 0;
                    awaitingPlayServicesRetry = false;
                    if (syncWorker != null) {
                        syncWorker.start();
                    }
                }
                // If engine.start() fails again, it will call onEngineError
                // which re-enters handlePlayServicesUnavailable for the next retry.
            }
        };

        retryHandler.postDelayed(playServicesRetryRunnable, PLAY_SERVICES_RETRY_INTERVAL_MS);
    }

    /**
     * Posts a notification when Play Services retries are exhausted.
     * The rider is informed that location tracking cannot resume until
     * Play Services becomes available.
     */
    private void postPlayServicesExhaustedNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            Log.e(TAG, "NotificationManager unavailable — cannot post Play Services alert.");
            return;
        }

        Intent launchIntent = getPackageLauncher();
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ALERTS_ID)
                .setContentTitle("Location service unavailable")
                .setContentText("Google Play Services is unavailable. Please check your device settings.")
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .build();

        manager.notify(PLAY_SERVICES_NOTIFICATION_ID, notification);
        Log.i(TAG, "Play Services exhausted notification posted.");
    }

    // -------------------------------------------------------------------------
    // Permission-revocation notification (Req 1.10, 15.1)
    // -------------------------------------------------------------------------

    /**
     * Posts a rider-visible notification indicating that location permission
     * is required to continue tracking. Called when the engine's permission
     * checker detects mid-shift revocation.
     */
    private void postPermissionRequiredNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            Log.e(TAG, "NotificationManager unavailable — cannot post permission alert.");
            return;
        }

        Intent launchIntent = getPackageLauncher();
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ALERTS_ID)
                .setContentTitle("Location permission required")
                .setContentText("Tracking is paused. Tap to grant location permission and resume.")
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .build();

        manager.notify(PERMISSION_NOTIFICATION_ID, notification);
        Log.i(TAG, "Permission-required notification posted.");
    }

    /**
     * Dismisses the permission-required notification if it is currently showing.
     * Called when a location fix is received (meaning permission was restored
     * and capture has resumed).
     */
    private void dismissPermissionNotificationIfNeeded() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.cancel(PERMISSION_NOTIFICATION_ID);
        }
    }

    // -------------------------------------------------------------------------
    // Error code for FGS-start-not-allowed (service-level, distinct from
    // LocationEngine error codes)
    // -------------------------------------------------------------------------

    /** Error code: foreground service start was refused by the OS (Android 15+). */
    public static final int ERROR_FGS_START_NOT_ALLOWED = 100;

    /** Error code: one or more steps of the clean stop sequence failed (Req 8.5). */
    public static final int ERROR_STOP_STEP_FAILED = 101;

    // -------------------------------------------------------------------------
    // Bridge error listener (typed error surface for the Capacitor bridge)
    // -------------------------------------------------------------------------

    /**
     * Listener interface for the Capacitor bridge to receive typed errors
     * from the service (Req 2.4 — surface start failures to the bridge).
     */
    public interface BridgeErrorListener {
        /**
         * Called when the service encounters an error that should be forwarded
         * to JavaScript.
         *
         * @param code    typed error code
         * @param message human-readable description
         */
        void onServiceError(int code, @NonNull String message);
    }

    @Nullable
    private BridgeErrorListener bridgeErrorListener;

    /**
     * Register a listener for typed service errors. Called by the bridge
     * plugin when it binds to the service.
     *
     * @param listener the bridge error listener, or null to unregister
     */
    public void setBridgeErrorListener(@Nullable BridgeErrorListener listener) {
        this.bridgeErrorListener = listener;
    }

    // -------------------------------------------------------------------------
    // Public accessors for collaborators
    // -------------------------------------------------------------------------

    /**
     * Returns whether the WebView Activity is currently bound.
     * Used by SyncWorker to decide whether to live-forward events to the bridge.
     *
     * @return true if the WebView is bound and live-forwarding is active
     */
    public boolean isWebViewBound() {
        return isWebViewBound;
    }

    /**
     * Sets the WebView bound state. Called by the bridge plugin to enable/disable
     * live-forwarding of location events to JavaScript.
     *
     * @param bound true when the WebView is alive and ready to receive events
     */
    public void setWebViewBound(boolean bound) {
        this.isWebViewBound = bound;
    }

    /**
     * Sets the bridge callback ID for location event forwarding (Req 7.5).
     * When set, delivered fixes are broadcast to the bridge's receiver with
     * this callback ID so they reach the correct saved PluginCall in JS.
     *
     * @param callbackId the PluginCall callback ID, or null to disable forwarding
     */
    public void setBridgeCallbackId(@Nullable String callbackId) {
        this.bridgeCallbackId = callbackId;
    }

    /**
     * Returns the LocationQueue instance for use by the SyncWorker pipeline.
     *
     * @return the durable location queue
     */
    @NonNull
    public LocationQueue getQueue() {
        return queue;
    }

    // -------------------------------------------------------------------------
    // ACTION_START_TRACKING handler
    // -------------------------------------------------------------------------

    /**
     * Handles ACTION_START_TRACKING: promote to foreground, guard on permission,
     * start engine, persist ShiftState, acquire WakeLock.
     */
    private void handleStartTracking(@NonNull Intent intent) {
        Log.i(TAG, "handleStartTracking()");

        // 1. Extract extras from the start intent.
        String riderId = intent.getStringExtra(LocationConstants.EXTRA_RIDER_ID);
        String notifTitle = intent.getStringExtra(LocationConstants.EXTRA_NOTIF_TITLE);
        String notifMessage = intent.getStringExtra(LocationConstants.EXTRA_NOTIF_MESSAGE);
        long desiredIntervalMs = intent.getLongExtra(LocationConstants.EXTRA_DESIRED_INTERVAL_MS, -1);
        long fastestIntervalMs = intent.getLongExtra(LocationConstants.EXTRA_FASTEST_INTERVAL_MS, -1);
        float distanceFilterM = intent.getFloatExtra(LocationConstants.EXTRA_DISTANCE_FILTER_M, -1f);

        // Extract the bridge callback ID for live-forwarding location events
        // to the correct saved PluginCall in JS (Req 7.5, task 6.2).
        String callbackId = intent.getStringExtra(LocationConstants.EXTRA_BRIDGE_CALLBACK_ID);
        if (callbackId != null) {
            this.bridgeCallbackId = callbackId;
            // Mark the WebView as bound since we're receiving a fresh start
            // from the bridge (the Activity is alive at this point).
            this.isWebViewBound = true;
        }

        // Use defaults for notification text if missing.
        if (notifTitle == null || notifTitle.trim().isEmpty()) {
            notifTitle = "ArogyaDiet Rider";
        }
        if (notifMessage == null || notifMessage.trim().isEmpty()) {
            notifMessage = "Tracking your delivery location";
        }

        // 2. Guard on runtime location permission FIRST (Req 5.3, 5.4).
        //    Do NOT call startForeground without location permission (Req 5.4).
        if (!hasLocationPermission()) {
            Log.e(TAG, "Location permission not held — cannot start tracking.");
            // Do NOT persist ShiftState (Req 2.4).
            onEngineError(LocationEngine.ERROR_PERMISSION_MISSING,
                    "Location permission not granted at start time.");
            stopSelf();
            return;
        }

        // 3. Promote to foreground (must happen within the OS 5s window —
        //    Req 5.1, 5.2). Our call is synchronous and immediate after
        //    extracting extras, so the 5s window is inherently met.
        //    promoteToForeground handles FGS-start-not-allowed (Android 15)
        //    and POST_NOTIFICATIONS (Android 13+) internally.
        boolean fgsPromoted = promoteToForeground(notifTitle, notifMessage);
        if (!fgsPromoted) {
            // FGS start was refused (Android 15 policy). Re-arm notification
            // has been posted, ShiftState is preserved. Stop self without
            // persisting a new ShiftState (the existing one, if any, is kept).
            Log.w(TAG, "FGS promotion failed — re-arm path activated, stopping self.");
            stopSelf();
            return;
        }

        // 4. Build engine config from extras.
        LocationEngineConfig config = LocationEngineConfig.fromExtras(
                desiredIntervalMs, fastestIntervalMs, distanceFilterM);

        // 5. Start the location engine.
        engine.start(config);

        // If engine failed to start (e.g. Play Services unavailable), don't persist.
        if (!engine.isRunning()) {
            // If a Play Services retry is scheduled, keep the service alive and
            // persist ShiftState so the retry can resume (Req 15.2, 15.3).
            if (awaitingPlayServicesRetry) {
                Log.i(TAG, "Engine failed to start but Play Services retry is scheduled. "
                        + "Persisting ShiftState for retry recovery.");
                // Persist ShiftState so the retry has context to work with.
                String watcherId = "watcher_" + System.currentTimeMillis();
                ShiftState state = new ShiftState(
                        true,
                        riderId != null ? riderId : "unknown",
                        System.currentTimeMillis(),
                        watcherId,
                        notifTitle,
                        notifMessage
                );
                shiftStateStore.setActive(state);
                return;
            }
            Log.e(TAG, "Engine failed to start — not persisting ShiftState.");
            stopSelf();
            return;
        }

        // 6. Start the SyncWorker drain cycle (Req 4.9).
        if (syncWorker != null) {
            syncWorker.start();
        }

        // 7. Persist ShiftState.isActive = true (Req 2.3).
        String watcherId = "watcher_" + System.currentTimeMillis();
        ShiftState state = new ShiftState(
                true,
                riderId != null ? riderId : "unknown",
                System.currentTimeMillis(),
                watcherId,
                notifTitle,
                notifMessage
        );
        shiftStateStore.setActive(state);

        // 8. Acquire WakeLock (after startForeground — Req 6.1).
        wakeLockManager.acquire();

        Log.i(TAG, "Tracking started successfully. ShiftState persisted: " + state);
    }

    // -------------------------------------------------------------------------
    // ACTION_STOP_TRACKING handler
    // -------------------------------------------------------------------------

    /**
     * Handles ACTION_STOP_TRACKING: clean stop — engine stop, WakeLock release,
     * ShiftState clear, stopSelf.
     *
     * <p>This is the ONLY path that performs a clean stop (Req 8.2).
     * Transient lifecycle events (onTaskRemoved, onDestroy, onLowMemory,
     * onTrimMemory, system kill) never call this method and never perform
     * a clean stop (Req 8.3).
     */
    private void handleStopTracking() {
        Log.i(TAG, "handleStopTracking()");
        stopTracking();
    }

    /**
     * Perform the explicit clean-stop sequence (Req 8.1, 8.2, 8.4, 8.5, 15.7).
     *
     * <p><b>No-op guard (Req 8.4, 15.7):</b> If no shift is currently active
     * (ShiftState is null), the stop is treated as a no-op — completes without
     * error. This also satisfies Req 15.7 (removeWatcher on an already-cleared
     * watcher is a no-op).
     *
     * <p><b>2-second bound (Req 8.1):</b> All stop steps are synchronous and
     * instant (engine.stop is a FusedLocationClient.removeLocationUpdates call,
     * WakeLock release is a single unlock, ShiftState clear is a SharedPreferences
     * edit, stopSelf is immediate). The entire sequence completes well within
     * 2 seconds without needing an async timeout.
     *
     * <p><b>Continue on failure (Req 8.5):</b> Each step is wrapped in its own
     * try-catch. If any step throws, the error is logged and surfaced to the
     * bridge, but remaining steps continue. ShiftState is always cleared at
     * the end regardless of earlier failures.
     */
    private void stopTracking() {
        // --- No-op guard (Req 8.4, 15.7) ---
        // If no active shift exists, treat as no-op and return without error.
        ShiftState currentState = shiftStateStore != null ? shiftStateStore.get() : null;
        if (currentState == null || !currentState.isActive()) {
            Log.i(TAG, "stopTracking: no active shift — no-op (Req 8.4).");
            return;
        }

        Log.i(TAG, "stopTracking: performing explicit clean stop (Req 8.1).");
        StringBuilder failedSteps = new StringBuilder();

        // Cancel any pending Play Services retry (Req 15.2).
        if (retryHandler != null && playServicesRetryRunnable != null) {
            retryHandler.removeCallbacks(playServicesRetryRunnable);
            playServicesRetryRunnable = null;
        }
        playServicesRetryCount = 0;
        awaitingPlayServicesRetry = false;

        // Step 1: Stop the Location Engine.
        try {
            if (engine != null && engine.isRunning()) {
                engine.stop();
                Log.d(TAG, "stopTracking: engine stopped.");
            }
        } catch (Exception e) {
            Log.e(TAG, "stopTracking: engine.stop() failed — continuing.", e);
            failedSteps.append("engine.stop[").append(e.getMessage()).append("] ");
        }

        // Step 2: Stop SyncWorker drain cycle.
        try {
            if (syncWorker != null) {
                syncWorker.stop();
                Log.d(TAG, "stopTracking: SyncWorker stopped.");
            }
        } catch (Exception e) {
            Log.e(TAG, "stopTracking: syncWorker.stop() failed — continuing.", e);
            failedSteps.append("syncWorker.stop[").append(e.getMessage()).append("] ");
        }

        // Step 3: Release WakeLock.
        try {
            if (wakeLockManager != null) {
                wakeLockManager.release();
                Log.d(TAG, "stopTracking: WakeLock released.");
            }
        } catch (Exception e) {
            Log.e(TAG, "stopTracking: wakeLockManager.release() failed — continuing.", e);
            failedSteps.append("wakeLock.release[").append(e.getMessage()).append("] ");
        }

        // Step 4: Clear persisted ShiftState (Req 8.5 — always cleared even if
        // earlier steps failed).
        try {
            if (shiftStateStore != null) {
                shiftStateStore.clear();
                Log.d(TAG, "stopTracking: ShiftState cleared.");
            }
        } catch (Exception e) {
            Log.e(TAG, "stopTracking: shiftStateStore.clear() failed — continuing.", e);
            failedSteps.append("shiftState.clear[").append(e.getMessage()).append("] ");
        }

        // Surface any failed steps to the bridge (Req 8.5).
        if (failedSteps.length() > 0) {
            String errorMsg = "Clean stop completed with failures: " + failedSteps.toString().trim();
            Log.w(TAG, errorMsg);
            onEngineError(ERROR_STOP_STEP_FAILED, errorMsg);
        }

        // Step 5: Self-terminate.
        stopSelf();
        Log.i(TAG, "stopTracking: service self-terminated (clean stop complete).");
    }

    // -------------------------------------------------------------------------
    // Null-action (OS redelivery) handler
    // -------------------------------------------------------------------------

    /**
     * Handles null-action redelivery: the OS recreated the service after a kill
     * (START_STICKY). Resume from persisted ShiftState if active; stop self
     * if inactive or invalid.
     *
     * <p><b>Retry logic (Req 3.6):</b> If the resume fails (permission missing,
     * FGS refused, engine won't start), the method increments
     * {@link #redeliveryAttemptCount}. If fewer than {@link #MAX_REDELIVERY_RETRIES}
     * attempts have been made, it schedules a retry in 10 seconds via the
     * {@link #retryHandler}. After the final (3rd) failed attempt, it posts a
     * rider-visible "could not resume" notification and stops self, preserving
     * {@link ShiftState} so the rider can manually restart.
     */
    private void handleNullActionRedelivery() {
        Log.i(TAG, "handleNullActionRedelivery() — OS redelivery after kill. "
                + "Attempt " + (redeliveryAttemptCount + 1) + "/" + MAX_REDELIVERY_RETRIES);

        ShiftState persisted = shiftStateStore.get();

        if (persisted == null) {
            // No valid persisted state — either inactive (Req 2.7) or
            // invalid/missing config (Req 2.6, 3.7). Stop self.
            Log.w(TAG, "No valid persisted ShiftState — stopping self.");
            // Reset retry count since there's nothing to retry.
            redeliveryAttemptCount = 0;
            stopSelf();
            return;
        }

        // Valid persisted state with isActive=true — attempt to resume tracking (Req 2.5).
        Log.i(TAG, "Resuming tracking from persisted state: " + persisted);

        // Guard on permission first (Req 5.4 — don't call startForeground
        // without location permission).
        if (!hasLocationPermission()) {
            Log.e(TAG, "Location permission not held on redelivery — cannot resume.");
            handleRedeliveryFailure("Location permission not granted");
            return;
        }

        // Promote to foreground with persisted notification text.
        // Handles Android 15 FGS-start-not-allowed gracefully.
        boolean fgsPromoted = promoteToForeground(
                persisted.getNotifTitle(), persisted.getNotifMessage());
        if (!fgsPromoted) {
            // FGS refused — re-arm notification posted, ShiftState preserved.
            Log.w(TAG, "FGS promotion failed on redelivery.");
            handleRedeliveryFailure("Foreground service promotion refused by OS");
            return;
        }

        // Resume engine with default config (persisted state doesn't store cadence
        // config, so use defaults which are safe — within 15s cap).
        LocationEngineConfig config = new LocationEngineConfig();
        engine.start(config);

        if (!engine.isRunning()) {
            // If a Play Services retry is scheduled, don't fail permanently —
            // let the retry mechanism handle recovery (Req 15.2, 15.3).
            if (awaitingPlayServicesRetry) {
                Log.i(TAG, "Engine failed on redelivery but Play Services retry is scheduled.");
                return;
            }
            Log.e(TAG, "Engine failed to resume on redelivery.");
            handleRedeliveryFailure("Location engine failed to start");
            return;
        }

        // --- Success path ---
        // Reset retry counter on successful resume (Req 3.6).
        redeliveryAttemptCount = 0;

        // Start the SyncWorker drain cycle to resume delivery of queued fixes.
        if (syncWorker != null) {
            syncWorker.start();
        }

        // Re-acquire WakeLock.
        wakeLockManager.acquire();

        Log.i(TAG, "Tracking resumed successfully from persisted state.");
    }

    /**
     * Handles a failed redelivery attempt by either scheduling a retry or
     * posting the final-failure notification.
     *
     * <p><b>Retry policy (Req 3.6):</b>
     * <ul>
     *   <li>If fewer than {@link #MAX_REDELIVERY_RETRIES} attempts have been
     *       made, increment the counter and schedule a retry in 10 seconds.</li>
     *   <li>After the 3rd failed attempt, post a rider-visible "could not resume"
     *       notification, preserve {@link ShiftState}, and stop self without
     *       further retries.</li>
     * </ul>
     *
     * @param reason human-readable reason for the failure (for logging)
     */
    private void handleRedeliveryFailure(@NonNull String reason) {
        redeliveryAttemptCount++;
        Log.w(TAG, "Redelivery failure #" + redeliveryAttemptCount
                + "/" + MAX_REDELIVERY_RETRIES + ": " + reason);

        if (redeliveryAttemptCount < MAX_REDELIVERY_RETRIES) {
            // Schedule a retry in 10 seconds (Req 3.6).
            Log.i(TAG, "Scheduling redelivery retry in " + REDELIVERY_RETRY_INTERVAL_MS + "ms.");
            if (retryHandler != null) {
                retryHandler.removeCallbacks(redeliveryRetryRunnable);
                retryHandler.postDelayed(redeliveryRetryRunnable, REDELIVERY_RETRY_INTERVAL_MS);
            }
            // Do NOT stop self — we stay alive waiting for the retry.
            // Do NOT clear ShiftState — preserve for retry (Req 3.6).
        } else {
            // Final failure — post rider-visible notification and give up (Req 3.6, 3.7).
            Log.e(TAG, "All " + MAX_REDELIVERY_RETRIES
                    + " redelivery attempts failed. Posting failure notification.");
            postResumeFailedNotification();

            // Preserve ShiftState so the rider can manually restart (Req 3.6).
            // Do NOT clear it — the shift is still logically active, just
            // unable to track until the rider intervenes.
            redeliveryAttemptCount = 0; // Reset for potential future redelivery.
            stopSelf();
        }
    }

    /**
     * Posts a rider-visible notification indicating that tracking could not
     * resume automatically after all retry attempts have been exhausted.
     *
     * <p>Uses the {@link #CHANNEL_ALERTS_ID} channel with high priority to
     * ensure visibility. The notification includes a tap action to open the app,
     * allowing the rider to manually restart tracking.
     *
     * <p>Requirement references: 3.6 (retry exhaustion notification), 3.7
     * (manual restart notification on unrecoverable failure).
     */
    private void postResumeFailedNotification() {
        Intent launchIntent = getPackageLauncher();

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                RESUME_FAILED_NOTIFICATION_ID, // distinct request code
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ALERTS_ID)
                .setContentTitle("Tracking could not resume")
                .setContentText("Open the app to restart location tracking for your shift.")
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .build();

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(RESUME_FAILED_NOTIFICATION_ID, notification);
            Log.i(TAG, "Resume-failed notification posted — rider must manually restart.");
        } else {
            Log.e(TAG, "NotificationManager unavailable — cannot post resume-failed notification.");
        }
    }

    // -------------------------------------------------------------------------
    // Foreground promotion
    // -------------------------------------------------------------------------

    /**
     * Builds the foreground notification and calls startForeground with
     * foreground service type LOCATION (Android 10+ / API 29+).
     *
     * <p>Uses {@link ServiceCompat#startForeground} for compatibility across
     * API levels, passing {@link ServiceInfo#FOREGROUND_SERVICE_TYPE_LOCATION}
     * on API 29+.
     *
     * <p><b>Android 13+ POST_NOTIFICATIONS (Req 5.5, 5.6):</b> If the app
     * does not hold {@code POST_NOTIFICATIONS} permission on Android 13+,
     * the foreground notification will not be shown but the service can still
     * run. We log a warning and continue tracking where the OS permits.
     *
     * <p><b>Android 15 FGS-start-not-allowed (Req 5.8, 5.9):</b> Wrapped in
     * a try-catch. If the OS refuses the foreground start (e.g. started from
     * a disallowed background context), we use the policy-safe re-arm path:
     * preserve ShiftState, post a tap-to-resume notification, surface an error
     * to the bridge, and stop self without crashing.
     *
     * <p><b>startForeground timeout (Req 5.2):</b> Android kills the service
     * if startForeground is not called within 5s of service start. Since our
     * call is synchronous and immediate (the first thing in handleStartTracking
     * / handleNullActionRedelivery after extracting extras), this is inherently
     * satisfied — no additional timer is needed.
     *
     * @param title   notification title
     * @param message notification body text
     * @return true if foreground promotion succeeded, false if it was refused
     */
    private boolean promoteToForeground(@NonNull String title, @NonNull String message) {
        // Android 13+ (API 33): check POST_NOTIFICATIONS. If denied, the notification
        // won't show but we can still run the foreground service (Req 5.5, 5.6).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this,
                    "android.permission.POST_NOTIFICATIONS")
                    != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "POST_NOTIFICATIONS permission not granted (Android 13+). "
                        + "Foreground notification may not display, but tracking will "
                        + "continue where the OS permits.");
            }
        }

        Notification notification = buildNotification(title, message);

        try {
            // Use ServiceCompat for cross-version startForeground with type.
            // On API 34+ (Android 14), foregroundServiceType must be declared in
            // manifest AND passed here. On older APIs, the type is informational.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceCompat.startForeground(
                        this,
                        LocationConstants.NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                );
            } else {
                startForeground(LocationConstants.NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            // On Android 15+ (API 35), ForegroundServiceStartNotAllowedException is
            // thrown when starting a FGS from a context that's not permitted (e.g.
            // background context without an exemption). On older APIs, an
            // IllegalStateException can occur in edge cases.
            //
            // Policy-safe re-arm path (Req 5.8, 5.9, 15.6):
            // - Do NOT crash.
            // - Preserve ShiftState so recovery can resume later.
            // - Post a rider-visible notification with a tap action that brings
            //   the app to foreground, enabling a valid FGS start context.
            // - Surface error to the bridge (when WebView is alive).
            // - Stop self (cannot run without foreground promotion).
            Log.e(TAG, "promoteToForeground() failed — FGS start not allowed. "
                    + "Using policy-safe re-arm path.", e);

            onEngineError(ERROR_FGS_START_NOT_ALLOWED,
                    "Foreground service start not allowed: " + e.getMessage());

            postRearmNotification(title, message);

            // ShiftState is explicitly NOT cleared — preserved for re-arm (Req 5.9).
            return false;
        }

        Log.i(TAG, "promoteToForeground(): Service promoted with type=location.");
        return true;
    }

    // -------------------------------------------------------------------------
    // Notification helpers
    // -------------------------------------------------------------------------

    /**
     * Creates the notification channels (required for Android O / API 26+).
     * Safe to call multiple times — the system ignores duplicate creation.
     */
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) {
                return;
            }

            // Low-importance channel for the ongoing foreground service notification.
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Location Tracking",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows while ArogyaDiet is tracking your delivery location.");
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);

            // Default-importance channel for alerts (re-arm prompts, errors).
            NotificationChannel alertsChannel = new NotificationChannel(
                    CHANNEL_ALERTS_ID,
                    "Location Alerts",
                    NotificationManager.IMPORTANCE_DEFAULT
            );
            alertsChannel.setDescription("Important alerts when tracking requires attention.");
            manager.createNotificationChannel(alertsChannel);
        }
    }

    /**
     * Builds a minimal foreground notification for the location service.
     *
     * @param title   notification title
     * @param message notification body text
     * @return the built Notification
     */
    @NonNull
    private Notification buildNotification(@NonNull String title, @NonNull String message) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(message)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    // -------------------------------------------------------------------------
    // Permission check
    // -------------------------------------------------------------------------

    /**
     * Checks whether runtime ACCESS_FINE_LOCATION permission is currently held.
     *
     * @return true if the app has fine location permission
     */
    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this,
                android.Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    // -------------------------------------------------------------------------
    // Policy-safe re-arm notification (Req 5.8, 5.9)
    // -------------------------------------------------------------------------

    /**
     * Posts a rider-visible notification with a tap action that brings the app
     * to the foreground. This is the "policy-safe re-arm path" for Android 15+
     * when foreground service start is refused from a background context.
     *
     * <p>The tap opens the rider app's main Activity, which provides a valid
     * foreground context for re-starting the service. ShiftState is preserved
     * so the app can resume tracking from where it left off.
     *
     * @param title   the shift notification title (for context in the alert)
     * @param message the shift notification message
     */
    private void postRearmNotification(@NonNull String title, @NonNull String message) {
        // Build a launch intent for the app's main activity.
        // This brings the app to the foreground, providing a valid FGS-start context.
        Intent launchIntent = getPackageLauncher();

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ALERTS_ID)
                .setContentTitle("Tracking needs attention")
                .setContentText("Tap to resume location tracking for your shift.")
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .build();

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(REARM_NOTIFICATION_ID, notification);
            Log.i(TAG, "Re-arm notification posted — rider can tap to resume.");
        } else {
            Log.e(TAG, "NotificationManager unavailable — cannot post re-arm notification.");
        }
    }

    /**
     * Returns a launch intent for the app's main Activity.
     * Uses the package manager's launch intent to correctly resolve
     * the Capacitor main activity regardless of class name.
     *
     * @return the launch intent, or a fallback explicit intent
     */
    @NonNull
    private Intent getPackageLauncher() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            return launchIntent;
        }

        // Fallback: explicit intent to a known activity class (should not happen
        // in normal Capacitor apps, but defensive).
        Log.w(TAG, "getLaunchIntentForPackage returned null — using fallback.");
        Intent fallback = new Intent();
        fallback.setPackage(getPackageName());
        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return fallback;
    }
}
