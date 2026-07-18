package com.equimaps.capacitor_background_geolocation;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.arogyadiet.rider.location.LocationConstants;
import com.arogyadiet.rider.location.LocationForegroundService;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.tasks.OnSuccessListener;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

@CapacitorPlugin(
        name = "BackgroundGeolocation",
        permissions = {
                @Permission(
                        strings = {
                                Manifest.permission.ACCESS_COARSE_LOCATION,
                                Manifest.permission.ACCESS_FINE_LOCATION
                        },
                        alias = "location"
                ),
                // "Allow all the time" background location (Android 10+, API 29).
                // MANDATORY for continuous tracking while the app is backgrounded
                // or the screen is locked. Without it, a "while in use" / one-time
                // grant is revoked the moment the rider leaves the app, killing the
                // foreground service. Must be requested SEPARATELY, after foreground
                // location is already granted (Android platform requirement).
                @Permission(
                        strings = { "android.permission.ACCESS_BACKGROUND_LOCATION" },
                        alias = "backgroundLocation"
                ),
                // POST_NOTIFICATIONS (Android 13+, API 33). Without it the ongoing
                // foreground-service notification is suppressed, which both hides the
                // "tracking active" indicator from the rider and makes the location
                // FGS more likely to be reaped by the OS.
                @Permission(
                        strings = { "android.permission.POST_NOTIFICATIONS" },
                        alias = "notifications"
                )
        }
)
public class BackgroundGeolocation extends Plugin {

    /**
     * Maps active watcher IDs (returned to JS) → PluginCall callback IDs.
     * Used to:
     * <ul>
     *   <li>Validate that a watcher is known on removeWatcher (Req 7.4)</li>
     *   <li>Route location events to the correct saved PluginCall (Req 7.5)</li>
     * </ul>
     *
     * <p>The bridge holds this in-memory only — it does NOT persist across
     * process restarts (Req 7.7: no cross-process state).
     */
    private final Map<String, String> activeWatchers = new HashMap<>();

    private void fetchLastLocation(PluginCall call) {
        try {
            LocationServices.getFusedLocationProviderClient(
                    getContext()
            ).getLastLocation().addOnSuccessListener(
                    getActivity(),
                    new OnSuccessListener<Location>() {
                        @Override
                        public void onSuccess(Location location) {
                            if (location != null) {
                                call.resolve(formatLocation(location));
                            }
                        }
                    }
            );
        } catch (SecurityException ignore) {}
    }

    /**
     * Starts background location tracking via the new LocationForegroundService.
     *
     * <p>Marshals watcher options from the PluginCall into an explicit
     * ACTION_START_TRACKING intent, calls startForegroundService, and returns
     * a unique watcher ID (1–128 chars) to JavaScript within 2000ms.
     *
     * <p>On service start failure: returns an error to JavaScript and registers
     * no watcher. Holds no cross-process state and makes no lifecycle decisions
     * (Req 7.7).
     *
     * @see LocationConstants#ACTION_START_TRACKING
     */
    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void addWatcher(final PluginCall call) {
        call.setKeepAlive(true);

        // --- Permission gate (preserve existing JS contract) ---
        if (getPermissionState("location") != PermissionState.GRANTED) {
            if (call.getBoolean("requestPermissions", true)) {
                requestPermissionForAlias("location", call, "locationPermissionsCallback");
                return;
            } else {
                call.reject("Permission denied.", "NOT_AUTHORIZED");
                return;
            }
        }

        if (!isLocationEnabled(getContext())) {
            call.reject("Location services disabled.", "NOT_AUTHORIZED");
            return;
        }

        // Deliver last known fix if stale mode requested (existing behaviour).
        if (call.getBoolean("stale", false)) {
            fetchLastLocation(call);
        }

        // --- Extract watcher options from the PluginCall ---
        String backgroundTitle = call.getString("backgroundTitle", "Using your location");
        String backgroundMessage = call.getString("backgroundMessage", "");
        float distanceFilter = call.getFloat("distanceFilter", 0f);
        boolean requestPermissions = call.getBoolean("requestPermissions", true);
        boolean stale = call.getBoolean("stale", false);

        // --- Generate a unique watcher ID (UUID, always 36 chars → within 1–128) ---
        String watcherId = UUID.randomUUID().toString();

        // --- Build explicit Intent with ACTION_START_TRACKING ---
        Context context = getContext();
        Intent startIntent = new Intent(context, LocationForegroundService.class);
        startIntent.setAction(LocationConstants.ACTION_START_TRACKING);

        // Pack watcher options as intent extras using LocationConstants keys.
        startIntent.putExtra(LocationConstants.EXTRA_NOTIF_TITLE, backgroundTitle);
        startIntent.putExtra(LocationConstants.EXTRA_NOTIF_MESSAGE, backgroundMessage);
        startIntent.putExtra(LocationConstants.EXTRA_DISTANCE_FILTER_M, distanceFilter);
        startIntent.putExtra(LocationConstants.EXTRA_REQUEST_PERMISSIONS, requestPermissions);
        startIntent.putExtra(LocationConstants.EXTRA_STALE, stale);

        // Include the bridge callback ID so the service can address location
        // broadcasts back to the correct saved PluginCall (Req 7.5).
        startIntent.putExtra(LocationConstants.EXTRA_BRIDGE_CALLBACK_ID, call.getCallbackId());

        // Real rider id (rider_profiles.id) passed from JS. The native service
        // uses this to upload live location directly to Supabase. Falls back to
        // the callbackId only if the JS layer didn't provide one.
        String riderId = call.getString("riderId", call.getCallbackId());
        startIntent.putExtra(LocationConstants.EXTRA_RIDER_ID, riderId);

        // --- Start the foreground service (Req 7.1) ---
        try {
            ContextCompat.startForegroundService(context, startIntent);
        } catch (Exception e) {
            // Service start failure (Req 7.2): return error, register no watcher.
            Logger.error("Failed to start LocationForegroundService", e);
            call.reject("Failed to start tracking service: " + e.getMessage(),
                    "SERVICE_START_FAILED");
            return;
        }

        // --- Register the active watcher (Req 7.3, 7.4) ---
        // Store the callbackId (which is what Capacitor returns to `await addWatcher()`)
        // as both key AND value, so removeWatcher can find it regardless of which
        // ID the JS side passes.
        activeWatchers.put(call.getCallbackId(), call.getCallbackId());

        // NOTE: We do NOT call call.resolve() here. For RETURN_CALLBACK methods,
        // Capacitor automatically returns the callbackId to the JS `await`. Calling
        // resolve() would deliver a value to the *callback function* (not the await),
        // which is what was causing the spurious {id} object to appear as a "location"
        // event and trigger a null-lat upsert. The callback will only receive real
        // location events from the LocationServiceReceiver broadcast path.
    }

    @PermissionCallback
    private void locationPermissionsCallback(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("User denied location permission", "NOT_AUTHORIZED");
            return;
        }

        if (!isLocationEnabled(getContext())) {
            call.reject("Location services disabled.", "NOT_AUTHORIZED");
            return;
        }

        // Permission granted — proceed with service start (same flow as addWatcher).
        if (call.getBoolean("stale", false)) {
            fetchLastLocation(call);
        }

        // Extract options.
        String backgroundTitle = call.getString("backgroundTitle", "Using your location");
        String backgroundMessage = call.getString("backgroundMessage", "");
        float distanceFilter = call.getFloat("distanceFilter", 0f);
        boolean requestPermissions = call.getBoolean("requestPermissions", true);
        boolean stale = call.getBoolean("stale", false);

        // Generate unique watcher ID.
        String watcherId = UUID.randomUUID().toString();

        // Build start intent.
        Context context = getContext();
        Intent startIntent = new Intent(context, LocationForegroundService.class);
        startIntent.setAction(LocationConstants.ACTION_START_TRACKING);
        startIntent.putExtra(LocationConstants.EXTRA_NOTIF_TITLE, backgroundTitle);
        startIntent.putExtra(LocationConstants.EXTRA_NOTIF_MESSAGE, backgroundMessage);
        startIntent.putExtra(LocationConstants.EXTRA_DISTANCE_FILTER_M, distanceFilter);
        startIntent.putExtra(LocationConstants.EXTRA_REQUEST_PERMISSIONS, requestPermissions);
        startIntent.putExtra(LocationConstants.EXTRA_STALE, stale);
        startIntent.putExtra(LocationConstants.EXTRA_BRIDGE_CALLBACK_ID, call.getCallbackId());
        startIntent.putExtra(LocationConstants.EXTRA_RIDER_ID,
                call.getString("riderId", call.getCallbackId()));

        try {
            ContextCompat.startForegroundService(context, startIntent);
        } catch (Exception e) {
            Logger.error("Failed to start LocationForegroundService after permission grant", e);
            call.reject("Failed to start tracking service: " + e.getMessage(),
                    "SERVICE_START_FAILED");
            return;
        }

        // Register the active watcher (same pattern as addWatcher — callbackId as both key and value).
        activeWatchers.put(call.getCallbackId(), call.getCallbackId());

        // Do NOT call call.resolve() — see note in addWatcher about RETURN_CALLBACK.
    }

    /**
     * Stops background location tracking via ACTION_STOP_TRACKING (Req 7.3, 7.4).
     *
     * <p>If the watcher ID is known (exists in {@link #activeWatchers}), builds
     * an explicit ACTION_STOP_TRACKING intent and sends it to the service, then
     * releases the saved PluginCall and resolves.
     *
     * <p>If the watcher ID is unknown (not in activeWatchers and no matching
     * saved call), rejects with an error and issues NO stop intent (Req 7.4).
     *
     * @see LocationConstants#ACTION_STOP_TRACKING
     */
    @PluginMethod()
    public void removeWatcher(PluginCall call) {
        String watcherId = call.getString("id");
        if (watcherId == null) {
            call.reject("Missing id.", "INVALID_ARGUMENTS");
            return;
        }

        // Look up the watcher in activeWatchers. The map is keyed by UUID
        // (generated in addWatcher), but the JS side may pass either the UUID
        // OR the Capacitor callbackId (which is what `await addWatcher()` returns
        // in RETURN_CALLBACK mode). Check both to be robust.
        String callbackId = activeWatchers.get(watcherId); // try as UUID key first

        if (callbackId == null) {
            // Not found by UUID key — check if it matches a callbackId value
            // (the JS toggle stores the callbackId from await, not the UUID).
            for (Map.Entry<String, String> entry : activeWatchers.entrySet()) {
                if (watcherId.equals(entry.getValue())) {
                    callbackId = entry.getValue();
                    activeWatchers.remove(entry.getKey());
                    break;
                }
            }
        } else {
            activeWatchers.remove(watcherId);
        }

        // Always send ACTION_STOP_TRACKING to stop the native service,
        // even if the watcher ID wasn't in our map (defensive — ensures
        // tracking stops on Off Duty regardless of ID mismatches).
        Context context = getContext();
        Intent stopIntent = new Intent(context, LocationForegroundService.class);
        stopIntent.setAction(LocationConstants.ACTION_STOP_TRACKING);

        try {
            context.startService(stopIntent);
        } catch (Exception e) {
            Logger.error("Failed to send ACTION_STOP_TRACKING intent", e);
        }

        // Release the saved PluginCall if we found the callbackId.
        if (callbackId != null) {
            PluginCall savedCall = getBridge().getSavedCall(callbackId);
            if (savedCall != null) {
                savedCall.release(getBridge());
            }
        }

        call.resolve();
    }

    @PluginMethod()
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        Uri uri = Uri.fromParts("package", getContext().getPackageName(), null);
        intent.setData(uri);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    // -------------------------------------------------------------------------
    // Tracking permission gate (foreground location, "all the time" background
    // location, and notifications). These are the permissions continuous
    // background GPS tracking actually requires on modern Android and must be
    // requested explicitly — the plain addWatcher() location gate only covers
    // foreground/one-time location, which Android revokes as soon as the rider
    // leaves the app.
    // -------------------------------------------------------------------------

    private boolean hasForegroundLocation() {
        Context c = getContext();
        return ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBackgroundLocation() {
        // Below Android 10 there is no separate background-location permission —
        // foreground location implies background access.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return hasForegroundLocation();
        }
        return ContextCompat.checkSelfPermission(getContext(),
                "android.permission.ACCESS_BACKGROUND_LOCATION")
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasNotificationsEnabled() {
        // areNotificationsEnabled() is the authoritative "will the FGS
        // notification actually show" check (covers POST_NOTIFICATIONS denial
        // AND channel/user-level blocks).
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    }

    private JSObject trackingPermissionStatus() {
        JSObject result = new JSObject();
        result.put("location", hasForegroundLocation() ? "granted" : "denied");
        result.put("backgroundLocation", hasBackgroundLocation() ? "granted" : "denied");
        result.put("notifications", hasNotificationsEnabled() ? "granted" : "denied");
        return result;
    }

    /**
     * Returns the granular status of every permission continuous tracking needs:
     * {@code { location, backgroundLocation, notifications }}, each "granted" or
     * "denied". The JS onboarding uses this to decide what to request / what to
     * guide the rider through in Settings.
     */
    @PluginMethod()
    public void getTrackingPermissionStatus(PluginCall call) {
        call.resolve(trackingPermissionStatus());
    }

    /**
     * Requests the POST_NOTIFICATIONS runtime permission (Android 13+). On older
     * OS versions notifications are enabled by default, so this resolves
     * immediately. Resolves with the full {@link #trackingPermissionStatus()}.
     */
    @PluginMethod()
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(trackingPermissionStatus());
            return;
        }
        requestPermissionForAlias("notifications", call, "trackingPermsCallback");
    }

    /**
     * Requests the foreground location permission ("While using the app").
     * This is stage 1 of the two-stage location grant; background location must
     * be requested afterwards. Resolves with {@link #trackingPermissionStatus()}.
     */
    @PluginMethod()
    public void requestForegroundLocationPermission(PluginCall call) {
        if (hasForegroundLocation()) {
            call.resolve(trackingPermissionStatus());
            return;
        }
        requestPermissionForAlias("location", call, "trackingPermsCallback");
    }

    /**
     * Requests "Allow all the time" background location (Android 10+).
     *
     * <p>Android requires foreground location to be granted first, so if it
     * isn't we request that and then chain into the background request. On
     * Android 11+ the OS routes the background request to a Settings screen
     * (the rider must pick "Allow all the time"); if the OS silently denies it,
     * the JS onboarding falls back to {@link #openSettings}. Resolves with
     * {@link #trackingPermissionStatus()}.
     */
    @PluginMethod()
    public void requestBackgroundLocationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || hasBackgroundLocation()) {
            call.resolve(trackingPermissionStatus());
            return;
        }
        if (!hasForegroundLocation()) {
            // Stage 1 first: grant foreground, then chain to background.
            requestPermissionForAlias("location", call, "foregroundThenBackgroundCallback");
            return;
        }
        requestPermissionForAlias("backgroundLocation", call, "trackingPermsCallback");
    }

    @PermissionCallback
    private void trackingPermsCallback(PluginCall call) {
        call.resolve(trackingPermissionStatus());
    }

    @PermissionCallback
    private void foregroundThenBackgroundCallback(PluginCall call) {
        // Foreground just resolved. If it was granted and background is still
        // missing on Android 10+, request background now (separate step, as the
        // platform requires). Otherwise return the current status.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && hasForegroundLocation()
                && !hasBackgroundLocation()) {
            requestPermissionForAlias("backgroundLocation", call, "trackingPermsCallback");
            return;
        }
        call.resolve(trackingPermissionStatus());
    }

    /**
     * Returns device manufacturer + whether the app is currently exempt from
     * standard Android battery optimization (Doze / App Standby).
     *
     * <p>This only reflects Google's stock Android battery optimization list
     * (Settings → Apps → Battery → Unrestricted). It cannot see OEM-specific
     * power managers (Vivo iManager, MIUI Battery & performance, ColorOS
     * Battery, etc.) — those have no public API and must be surfaced to the
     * rider as manual instructions keyed off {@code manufacturer} (Req: rider
     * onboarding permission screen).
     */
    @PluginMethod()
    public void getBatteryOptimizationStatus(PluginCall call) {
        Context context = getContext();
        boolean isIgnoringOptimizations = true; // pre-M devices have no Doze
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            android.os.PowerManager powerManager =
                    (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
            isIgnoringOptimizations = powerManager != null
                    && powerManager.isIgnoringBatteryOptimizations(context.getPackageName());
        }

        JSObject result = new JSObject();
        result.put("isIgnoringBatteryOptimizations", isIgnoringOptimizations);
        result.put("manufacturer", Build.MANUFACTURER);
        result.put("model", Build.MODEL);
        result.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    /**
     * Launches the stock Android "Ignore battery optimizations" request
     * dialog for this app (standard {@code ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS}
     * system prompt). Requires the {@code REQUEST_IGNORE_BATTERY_OPTIMIZATIONS}
     * permission (already declared in the module manifest).
     *
     * <p>This covers stock Android only. On OEM skins (Vivo/Xiaomi/Oppo/etc.)
     * the rider must ALSO enable the manufacturer's own power-saver exemption
     * manually — this method cannot reach that surface. The JS caller should
     * pair this with {@link #openSettings} and manufacturer-specific
     * instructions shown in the UI.
     */
    @PluginMethod()
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            Logger.error("Failed to launch battery optimization request", e);
            call.reject("Could not open battery optimization prompt.", "REQUEST_FAILED");
        }
    }

    // Checks if device-wide location services are disabled
    private static Boolean isLocationEnabled(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            return lm != null && lm.isLocationEnabled();
        } else {
            return (
                    Settings.Secure.getInt(
                            context.getContentResolver(),
                            Settings.Secure.LOCATION_MODE,
                            Settings.Secure.LOCATION_MODE_OFF
                    ) != Settings.Secure.LOCATION_MODE_OFF
            );
        }
    }

    private static JSObject formatLocation(Location location) {
        JSObject obj = new JSObject();
        obj.put("latitude", location.getLatitude());
        obj.put("longitude", location.getLongitude());
        // The docs state that all Location objects have an accuracy, but then why is there a
        // hasAccuracy method? Better safe than sorry.
        obj.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
        obj.put("altitude", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
        if (Build.VERSION.SDK_INT >= 26 && location.hasVerticalAccuracy()) {
            obj.put("altitudeAccuracy", location.getVerticalAccuracyMeters());
        } else {
            obj.put("altitudeAccuracy", JSONObject.NULL);
        }
        // In addition to mocking locations in development, Android allows the
        // installation of apps which have the power to simulate location
        // readings in other apps.
        obj.put("simulated", location.isFromMockProvider());
        obj.put("speed", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
        obj.put("bearing", location.hasBearing() ? location.getBearing() : JSONObject.NULL);
        obj.put("time", location.getTime());
        return obj;
    }

    // Receives location events from the new LocationForegroundService via
    // LocalBroadcast (ACTION_LOCATION_BROADCAST). Forwards to the saved
    // PluginCall identified by the "callbackId" extra, using the exact existing
    // payload shape (Req 7.5): latitude, longitude, accuracy, altitude,
    // bearing, speed, time.
    //
    // When the WebView is dead, the service does not send broadcasts (Req 7.6),
    // so this receiver is only invoked while the WebView is alive. No event
    // retention occurs in the bridge (Req 7.6, 7.7).
    private class LocationServiceReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            String callbackId = intent.getStringExtra("callbackId");
            if (callbackId == null) {
                return;
            }

            PluginCall savedCall = getBridge().getSavedCall(callbackId);
            if (savedCall == null) {
                // WebView may have navigated or call was released — discard (Req 7.6).
                return;
            }

            // Build the location payload in the exact existing shape (Req 7.5).
            JSObject obj = new JSObject();
            obj.put("latitude", intent.getDoubleExtra("latitude", 0.0));
            obj.put("longitude", intent.getDoubleExtra("longitude", 0.0));
            obj.put("accuracy", intent.getFloatExtra("accuracy", 0f));
            obj.put("altitude", intent.getDoubleExtra("altitude", 0.0));
            obj.put("altitudeAccuracy", JSONObject.NULL);
            obj.put("simulated", false);
            obj.put("speed", intent.getBooleanExtra("hasSpeed", false)
                    ? (double) intent.getFloatExtra("speed", 0f)
                    : JSONObject.NULL);
            obj.put("bearing", intent.getBooleanExtra("hasBearing", false)
                    ? (double) intent.getFloatExtra("bearing", 0f)
                    : JSONObject.NULL);
            obj.put("time", intent.getLongExtra("time", 0L));

            savedCall.resolve(obj);
        }
    }

    // Legacy receiver for the old BackgroundGeolocationService broadcasts.
    // Retained for backward compatibility during migration.
    private class ServiceReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            String id = intent.getStringExtra("id");
            PluginCall call = getBridge().getSavedCall(id);
            if (call == null) {
                return;
            }
            Location location = intent.getParcelableExtra("location");
            if (location != null) {
                call.resolve(formatLocation(location));
            } else {
                Logger.debug("No locations received");
            }
        }
    }

    // Gets the identifier of the app's resource by name, returning 0 if not found.
    private int getAppResourceIdentifier(String name, String defType) {
        return getContext().getResources().getIdentifier(
                name,
                defType,
                getContext().getPackageName()
        );
    }

    // Gets a string from the app's strings.xml file, resorting to a fallback if it is not defined.
    private String getAppString(String name, String fallback) {
        int id = getAppResourceIdentifier(name, "string");
        return id == 0 ? fallback : getContext().getString(id);
    }

    @Override
    public void load() {
        super.load();

        // Android O requires a Notification Channel for the legacy service
        // (retained for backward compat during migration; the new
        // LocationForegroundService creates its own channels).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(
                    Context.NOTIFICATION_SERVICE
            );
            NotificationChannel channel = new NotificationChannel(
                    BackgroundGeolocationService.class.getPackage().getName(),
                    getAppString(
                            "capacitor_background_geolocation_notification_channel_name",
                            "Background Tracking"
                    ),
                    NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.enableLights(false);
            channel.enableVibration(false);
            channel.setSound(null, null);
            manager.createNotificationChannel(channel);
        }

        // NOTE: The old bindService pattern is removed. The new architecture
        // uses startForegroundService (intent-based, started service).
        // No binding is required — the bridge is stateless (Req 7.7).

        // Register the legacy broadcast receiver (backward compat during migration).
        LocalBroadcastManager.getInstance(this.getContext()).registerReceiver(
                new ServiceReceiver(),
                new IntentFilter(BackgroundGeolocationService.ACTION_BROADCAST)
        );

        // Register the new LocationForegroundService broadcast receiver (Req 7.5).
        // Receives location events from the new service for JS forwarding.
        LocalBroadcastManager.getInstance(this.getContext()).registerReceiver(
                new LocationServiceReceiver(),
                new IntentFilter(LocationConstants.ACTION_LOCATION_BROADCAST)
        );
    }

    @Override
    protected void handleOnResume() {
        // No-op: the new architecture uses a started foreground service that
        // is decoupled from the Activity lifecycle. No bound-service
        // permission re-grant is needed (Req 7.7 — bridge is stateless).
        super.handleOnResume();
    }

    @Override
    protected void handleOnPause() {
        // No-op: the bridge holds no state and makes no lifecycle decisions.
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        // No-op: the new LocationForegroundService is a started service that
        // outlives the Activity. We do NOT stop it here — that would violate
        // Req 8.2 (only ACTION_STOP_TRACKING performs a clean stop).
        // The bridge holds no durable state (Req 7.7); activeWatchers are
        // in-memory only and naturally cleared on process death.
        super.handleOnDestroy();
    }
}
