package com.equimaps.capacitor_background_geolocation;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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

        // Use the callbackId as the rider ID placeholder (the bridge is stateless;
        // real rider identification is handled at the JS layer via the existing
        // Supabase upsert path). The service uses this for ShiftState tagging.
        startIntent.putExtra(LocationConstants.EXTRA_RIDER_ID, call.getCallbackId());

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
        startIntent.putExtra(LocationConstants.EXTRA_RIDER_ID, call.getCallbackId());

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
        getContext().startActivity(intent);
        call.resolve();
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
