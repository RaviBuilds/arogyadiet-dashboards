package com.arogyadiet.rider.location;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/**
 * Durable persistence for the current {@link ShiftState} using
 * {@link SharedPreferences} (MODE_PRIVATE, committed synchronously).
 *
 * <p>The store survives process death because SharedPreferences are
 * backed by an XML file on disk. Synchronous {@code commit()} is used
 * instead of {@code apply()} to ensure the write is flushed before
 * the calling method returns — critical for recovery correctness when
 * the OS may kill the process immediately after.
 *
 * <p>On read, all required fields are validated. If any field is missing
 * or empty, {@link #get()} returns {@code null} — signalling that the
 * persisted state is invalid and the service should stop itself
 * (Requirement 2.6).
 *
 * <p>Thread safety: SharedPreferences is internally thread-safe for
 * reads. Writes go through {@code commit()} which is atomic. The store
 * itself holds no mutable state beyond the Context reference.
 *
 * @see ShiftState
 */
public final class ShiftStateStore {

    private static final String PREFS_NAME = "arogyadiet_shift_state";

    // Preference keys — intentionally short but descriptive.
    private static final String KEY_IS_ACTIVE = "is_active";
    private static final String KEY_RIDER_ID = "rider_id";
    private static final String KEY_STARTED_AT_EPOCH = "started_at_epoch";
    private static final String KEY_WATCHER_ID = "watcher_id";
    private static final String KEY_NOTIF_TITLE = "notif_title";
    private static final String KEY_NOTIF_MESSAGE = "notif_message";

    @NonNull
    private final SharedPreferences prefs;

    /**
     * Creates a store backed by a private SharedPreferences file.
     *
     * @param context application or service context (non-null)
     */
    public ShiftStateStore(@NonNull Context context) {
        this.prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /**
     * Persist the active shift state synchronously.
     *
     * <p>Uses {@code commit()} to guarantee the write is flushed to disk
     * before this method returns. This is essential for recovery: if the
     * OS kills the process immediately after {@code onStartCommand}, the
     * persisted state must already be on disk for {@code START_STICKY}
     * redelivery or {@link BootReceiver} to read it.
     *
     * @param state the shift state to persist (non-null)
     */
    public void setActive(@NonNull ShiftState state) {
        prefs.edit()
                .putBoolean(KEY_IS_ACTIVE, state.isActive())
                .putString(KEY_RIDER_ID, state.getRiderId())
                .putLong(KEY_STARTED_AT_EPOCH, state.getStartedAtEpoch())
                .putString(KEY_WATCHER_ID, state.getWatcherId())
                .putString(KEY_NOTIF_TITLE, state.getNotifTitle())
                .putString(KEY_NOTIF_MESSAGE, state.getNotifMessage())
                .commit();
    }

    /**
     * Clear any persisted shift state (explicit stop or invalid-state cleanup).
     *
     * <p>After this call, {@link #get()} will return {@code null}.
     * Uses {@code commit()} for the same durability guarantee as
     * {@link #setActive(ShiftState)}.
     */
    public void clear() {
        prefs.edit().clear().commit();
    }

    /**
     * Read the persisted shift state with validation.
     *
     * <p>Returns {@code null} if:
     * <ul>
     *   <li>No state has been persisted (fresh install or after {@link #clear()}).</li>
     *   <li>The persisted {@code isActive} flag is {@code false}.</li>
     *   <li>Any required string field ({@code riderId}, {@code watcherId},
     *       {@code notifTitle}, {@code notifMessage}) is missing or empty.</li>
     *   <li>{@code startedAtEpoch} is not positive.</li>
     * </ul>
     *
     * <p>This validation ensures that recovery components (BootReceiver,
     * onTaskRemoved, null-action redelivery) never attempt to resume with
     * an incomplete configuration (Requirement 2.6).
     *
     * @return the validated {@link ShiftState}, or {@code null} if absent/invalid
     */
    @Nullable
    public ShiftState get() {
        boolean isActive = prefs.getBoolean(KEY_IS_ACTIVE, false);
        if (!isActive) {
            return null;
        }

        String riderId = prefs.getString(KEY_RIDER_ID, null);
        long startedAtEpoch = prefs.getLong(KEY_STARTED_AT_EPOCH, 0L);
        String watcherId = prefs.getString(KEY_WATCHER_ID, null);
        String notifTitle = prefs.getString(KEY_NOTIF_TITLE, null);
        String notifMessage = prefs.getString(KEY_NOTIF_MESSAGE, null);

        // Validate all required fields are present and non-empty.
        if (isNullOrEmpty(riderId)
                || startedAtEpoch <= 0
                || isNullOrEmpty(watcherId)
                || isNullOrEmpty(notifTitle)
                || isNullOrEmpty(notifMessage)) {
            return null;
        }

        ShiftState state = new ShiftState(
                true,
                riderId,
                startedAtEpoch,
                watcherId,
                notifTitle,
                notifMessage
        );

        // Final validation via the model's own check (defense in depth).
        return state.isValid() ? state : null;
    }

    /**
     * Checks if the given string is null or contains only whitespace.
     */
    private static boolean isNullOrEmpty(@Nullable String value) {
        return value == null || value.trim().isEmpty();
    }
}
