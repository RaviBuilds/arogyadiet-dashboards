package com.arogyadiet.rider.location;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * Reacts to device boot completion and re-arms tracking in a Play-policy-safe
 * manner when a shift was active (design Part E.1 / E.2, ADR-004).
 *
 * <p>Declared in the manifest for {@code BOOT_COMPLETED} and {@code QUICKBOOT_POWERON}
 * (task 1.3).
 *
 * <h3>Behaviour (Requirements 3.4, 3.5, 3.7):</h3>
 * <ul>
 *   <li><b>isActive == true</b> (Req 3.4): Within 60s of boot, present a rider-visible
 *       notification. Tap opens the app (main Activity), which provides a valid
 *       foreground context to restart the service. No background location start
 *       — policy-safe re-arm only via notification tap.</li>
 *   <li><b>isActive == false</b> (Req 3.5): Take no action, return immediately.</li>
 *   <li><b>ShiftState unreadable / null</b> (Req 3.7): Post a notification indicating
 *       manual restart is needed. Do NOT start background location.</li>
 * </ul>
 *
 * <p>Uses the same alert notification channel ({@code CHANNEL_ALERTS_ID}) defined
 * in {@link LocationForegroundService} and a distinct notification ID
 * ({@link #BOOT_REARM_NOTIFICATION_ID}) so it does not collide with the service's
 * own foreground notification or the FGS re-arm notification.
 *
 * @see ShiftStateStore
 * @see LocationForegroundService
 * @see LocationConstants
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "BootReceiver";

    /** Notification channel ID for alerts — same channel used by LocationForegroundService. */
    private static final String CHANNEL_ALERTS_ID = "arogyadiet_location_alerts";

    /** Unique notification ID for boot re-arm notifications. */
    private static final int BOOT_REARM_NOTIFICATION_ID = 28354;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) {
            Log.w(TAG, "onReceive: null intent, ignoring.");
            return;
        }

        String action = intent.getAction();

        // Only respond to BOOT_COMPLETED or QUICKBOOT_POWERON (HTC/Xiaomi fast-boot).
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            Log.d(TAG, "onReceive: ignoring unrecognized action: " + action);
            return;
        }

        Log.i(TAG, "onReceive: boot completed (action=" + action + "). Checking ShiftState.");

        // Ensure the notification channel exists (required on Android O+).
        ensureNotificationChannel(context);

        // Read persisted ShiftState.
        ShiftStateStore store = new ShiftStateStore(context);
        ShiftState state;

        try {
            state = store.get();
        } catch (Exception e) {
            // ShiftState unreadable (Req 3.7): post manual-restart notification.
            Log.e(TAG, "Failed to read ShiftState — posting manual-restart notification.", e);
            postManualRestartNotification(context);
            return;
        }

        if (state == null) {
            // Two possibilities:
            // 1. isActive == false → take no action (Req 3.5).
            // 2. State is present but invalid (validation failed in ShiftStateStore.get())
            //    → treat as unreadable (Req 3.7).
            //
            // We differentiate by checking the raw isActive flag directly.
            // ShiftStateStore.get() returns null for both inactive AND invalid states.
            // To distinguish: if the raw pref has isActive=true but get() returned null,
            // the state is corrupted/invalid → post manual-restart notification.
            if (isRawActiveFlag(context)) {
                // isActive was true but state was invalid → unreadable (Req 3.7).
                Log.w(TAG, "ShiftState isActive=true but state is invalid/unreadable. "
                        + "Posting manual-restart notification.");
                postManualRestartNotification(context);
            } else {
                // isActive == false → take no action (Req 3.5).
                Log.i(TAG, "ShiftState inactive — no action needed after boot.");
            }
            return;
        }

        // ShiftState is valid and isActive == true (Req 3.4):
        // Post a rider-visible notification. Tapping opens the app.
        // Do NOT start the location service from the background.
        Log.i(TAG, "ShiftState is active (rider=" + state.getRiderId()
                + "). Posting re-arm notification.");
        postRearmNotification(context);
    }

    // -------------------------------------------------------------------------
    // Notification: active shift re-arm (Req 3.4)
    // -------------------------------------------------------------------------

    /**
     * Posts a rider-visible notification indicating that the delivery shift is
     * resuming. Tapping opens the rider app's main Activity, which reads the
     * persisted ShiftState and starts tracking from a foreground context.
     *
     * <p>No background location start is performed (policy-safe, Req 3.4).
     */
    private void postRearmNotification(Context context) {
        Intent launchIntent = getLaunchIntent(context);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                BOOT_REARM_NOTIFICATION_ID, // unique request code
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ALERTS_ID)
                .setContentTitle("Delivery shift resuming")
                .setContentText("Your delivery shift is resuming — tap to continue tracking.")
                .setSmallIcon(android.R.drawable.ic_dialog_map)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .build();

        NotificationManager manager = (NotificationManager)
                context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(BOOT_REARM_NOTIFICATION_ID, notification);
            Log.i(TAG, "Re-arm notification posted — rider can tap to resume tracking.");
        } else {
            Log.e(TAG, "NotificationManager unavailable — cannot post re-arm notification.");
        }
    }

    // -------------------------------------------------------------------------
    // Notification: manual restart required (Req 3.7)
    // -------------------------------------------------------------------------

    /**
     * Posts a notification indicating that tracking must be manually restarted.
     * Used when the persisted ShiftState cannot be read (corrupted, missing fields).
     *
     * <p>Does NOT start any background location service.
     */
    private void postManualRestartNotification(Context context) {
        Intent launchIntent = getLaunchIntent(context);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                BOOT_REARM_NOTIFICATION_ID,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ALERTS_ID)
                .setContentTitle("Tracking must be manually restarted")
                .setContentText("Your shift state could not be restored. Tap to open the app and restart tracking.")
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .build();

        NotificationManager manager = (NotificationManager)
                context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(BOOT_REARM_NOTIFICATION_ID, notification);
            Log.i(TAG, "Manual-restart notification posted — rider must open app manually.");
        } else {
            Log.e(TAG, "NotificationManager unavailable — cannot post manual-restart notification.");
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Returns the launch intent for the app's main Activity.
     * Uses {@code getLaunchIntentForPackage} to correctly resolve the Capacitor
     * main activity regardless of class name.
     */
    private Intent getLaunchIntent(Context context) {
        Intent launchIntent = context.getPackageManager()
                .getLaunchIntentForPackage(context.getPackageName());

        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            return launchIntent;
        }

        // Fallback: if getLaunchIntentForPackage returns null (shouldn't happen
        // for a normal Capacitor app), create a minimal launch intent.
        Log.w(TAG, "getLaunchIntentForPackage returned null — using fallback intent.");
        Intent fallback = new Intent(Intent.ACTION_MAIN);
        fallback.addCategory(Intent.CATEGORY_LAUNCHER);
        fallback.setPackage(context.getPackageName());
        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return fallback;
    }

    /**
     * Checks the raw {@code is_active} SharedPreferences flag without full
     * validation. Used to distinguish between "inactive" (isActive=false) and
     * "corrupted/invalid" (isActive=true but fields are missing/broken).
     *
     * @return true if the raw isActive flag is set to true in shared preferences
     */
    private boolean isRawActiveFlag(Context context) {
        try {
            return context.getSharedPreferences("arogyadiet_shift_state", Context.MODE_PRIVATE)
                    .getBoolean("is_active", false);
        } catch (Exception e) {
            // If even reading the raw flag fails, treat as unreadable.
            Log.e(TAG, "Cannot read raw isActive flag.", e);
            return false;
        }
    }

    /**
     * Ensures the alerts notification channel exists. On Android O+, notifications
     * require a channel. The channel may already be created by LocationForegroundService,
     * but if the service hasn't run yet after a fresh boot, we create it here.
     *
     * <p>Safe to call multiple times — the system ignores duplicate channel creation.
     */
    private void ensureNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager)
                    context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) {
                return;
            }

            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ALERTS_ID,
                    "Location Alerts",
                    NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Important alerts when tracking requires attention.");
            manager.createNotificationChannel(channel);
        }
    }
}
