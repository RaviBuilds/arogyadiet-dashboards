package com.arogyadiet.rider.location;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import androidx.annotation.NonNull;

import java.util.ArrayList;
import java.util.List;

/**
 * Durable, bounded, on-device buffer of captured location fixes that decouples
 * capture from delivery (design Part D / E.1).
 *
 * <p>Backed by raw SQLite via {@link SQLiteOpenHelper} for simplicity in a
 * Capacitor plugin module (no annotation processing needed). The schema is a
 * single table {@code location_queue}.
 *
 * <p><b>Invariants enforced:</b>
 * <ul>
 *   <li>Single-state: every row is in exactly one {@link SyncState}
 *       (Requirement 4.3).</li>
 *   <li>Bounded: max 10000 entries. On overflow, oldest {@code DELIVERED}
 *       are evicted first, then oldest {@code PENDING}, never the most
 *       recent fix (highest {@code local_id}) (Requirement 4.8).</li>
 *   <li>Retention pruning: {@code DELIVERED} rows older than 24 hours are
 *       deleted by {@link #prune()}.</li>
 * </ul>
 *
 * <p><b>Thread safety:</b> All public methods are {@code synchronized} to
 * ensure safe access from the service's location callbacks, the sync worker,
 * and the bridge thread.
 *
 * @see QueuedLocation
 * @see SyncState
 */
public class LocationQueue {

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    private static final String DB_NAME = "arogyadiet_location_queue.db";
    private static final int DB_VERSION = 1;

    private static final String TABLE_NAME = "location_queue";

    // Column names
    private static final String COL_LOCAL_ID = "local_id";
    private static final String COL_RIDER_ID = "rider_id";
    private static final String COL_LAT = "lat";
    private static final String COL_LNG = "lng";
    private static final String COL_ACCURACY_M = "accuracy_m";
    private static final String COL_SPEED_MPS = "speed_mps";
    private static final String COL_BEARING_DEG = "bearing_deg";
    private static final String COL_CAPTURED_AT_EPOCH = "captured_at_epoch";
    private static final String COL_STATE = "state";
    private static final String COL_ATTEMPT_COUNT = "attempt_count";
    private static final String COL_LAST_ATTEMPT_AT = "last_attempt_at";

    /** Maximum number of entries allowed in the queue (Requirement 4.8). */
    private static final int MAX_ENTRIES = 10_000;

    /** Retention window for DELIVERED fixes: 24 hours in milliseconds. */
    private static final long DELIVERED_RETENTION_MS = 24L * 60L * 60L * 1000L;

    // -------------------------------------------------------------------------
    // Fields
    // -------------------------------------------------------------------------

    private final QueueDbHelper dbHelper;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * Creates or opens the location queue database.
     *
     * @param context application or service context (non-null)
     */
    public LocationQueue(@NonNull Context context) {
        this.dbHelper = new QueueDbHelper(context);
    }

    // -------------------------------------------------------------------------
    // Public API (all synchronized for thread safety)
    // -------------------------------------------------------------------------

    /**
     * Append a captured fix in the {@link SyncState#PENDING} state.
     *
     * <p>After insertion, the size bound is enforced via eviction if needed.
     *
     * @param fix the location fix to enqueue (localId is ignored; assigned by DB)
     */
    public synchronized void enqueue(@NonNull QueuedLocation fix) {
        SQLiteDatabase db = dbHelper.getWritableDatabase();
        try {
            db.beginTransaction();
            try {
                ContentValues values = new ContentValues();
                values.put(COL_RIDER_ID, fix.getRiderId());
                values.put(COL_LAT, fix.getLat());
                values.put(COL_LNG, fix.getLng());
                values.put(COL_ACCURACY_M, fix.getAccuracyM());

                if (fix.getSpeedMps() != null) {
                    values.put(COL_SPEED_MPS, fix.getSpeedMps());
                } else {
                    values.putNull(COL_SPEED_MPS);
                }

                if (fix.getBearingDeg() != null) {
                    values.put(COL_BEARING_DEG, fix.getBearingDeg());
                } else {
                    values.putNull(COL_BEARING_DEG);
                }

                values.put(COL_CAPTURED_AT_EPOCH, fix.getCapturedAtEpoch());
                values.put(COL_STATE, SyncState.PENDING.getValue());
                values.put(COL_ATTEMPT_COUNT, 0);
                values.putNull(COL_LAST_ATTEMPT_AT);

                db.insertOrThrow(TABLE_NAME, null, values);

                // Enforce size bound within the same transaction.
                enforceMaxEntries(db);

                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
        } finally {
            // Don't close the database — SQLiteOpenHelper manages it.
        }
    }

    /**
     * Read up to {@code limit} oldest {@link SyncState#PENDING} fixes ordered
     * by {@code local_id ASC}, without removing them from the queue.
     *
     * @param limit maximum number of records to return (must be > 0)
     * @return list of pending fixes, oldest first; empty if none available
     */
    public synchronized List<QueuedLocation> peekBatch(int limit) {
        if (limit <= 0) {
            return new ArrayList<>();
        }

        SQLiteDatabase db = dbHelper.getReadableDatabase();
        List<QueuedLocation> results = new ArrayList<>();

        Cursor cursor = db.query(
                TABLE_NAME,
                null, // all columns
                COL_STATE + " = ?",
                new String[]{SyncState.PENDING.getValue()},
                null, // groupBy
                null, // having
                COL_LOCAL_ID + " ASC",
                String.valueOf(limit)
        );

        try {
            while (cursor.moveToNext()) {
                results.add(cursorToQueuedLocation(cursor));
            }
        } finally {
            cursor.close();
        }

        return results;
    }

    /**
     * Read up to {@code limit} {@link SyncState#FAILED} fixes that are eligible
     * for retry — meaning their attempt count is below the max (10) AND enough
     * time has elapsed since their last attempt based on exponential backoff.
     *
     * <p>Backoff formula: base 5000ms * 2^(attemptCount - 1), capped at 300000ms.
     * A fix is retryable when {@code now - lastAttemptAt >= backoffDelay}.
     *
     * @param limit maximum number of records to return (must be > 0)
     * @param now   current time in milliseconds since epoch
     * @return list of retryable failed fixes, oldest first; empty if none available
     */
    public synchronized List<QueuedLocation> peekRetryableBatch(int limit, long now) {
        if (limit <= 0) {
            return new ArrayList<>();
        }

        SQLiteDatabase db = dbHelper.getReadableDatabase();
        List<QueuedLocation> results = new ArrayList<>();

        // Query FAILED fixes with attempt_count < 10.
        // We fetch more than limit since we'll filter by backoff in Java
        // (SQLite doesn't easily express the exponential formula).
        Cursor cursor = db.query(
                TABLE_NAME,
                null, // all columns
                COL_STATE + " = ? AND " + COL_ATTEMPT_COUNT + " < 10",
                new String[]{SyncState.FAILED.getValue()},
                null, // groupBy
                null, // having
                COL_LOCAL_ID + " ASC",
                String.valueOf(limit * 2) // fetch extra to allow for filtering
        );

        try {
            while (cursor.moveToNext() && results.size() < limit) {
                QueuedLocation fix = cursorToQueuedLocation(cursor);
                if (isRetryable(fix, now)) {
                    results.add(fix);
                }
            }
        } finally {
            cursor.close();
        }

        return results;
    }

    /**
     * Mark the given fixes as {@link SyncState#IN_FLIGHT}.
     *
     * @param ids the {@code local_id} values of fixes to mark in-flight
     */
    public synchronized void markInFlight(@NonNull List<Long> ids) {
        if (ids.isEmpty()) {
            return;
        }

        SQLiteDatabase db = dbHelper.getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues values = new ContentValues();
            values.put(COL_STATE, SyncState.IN_FLIGHT.getValue());

            String whereClause = COL_LOCAL_ID + " IN (" + buildPlaceholders(ids.size()) + ")";
            String[] whereArgs = idsToStringArray(ids);
            db.update(TABLE_NAME, values, whereClause, whereArgs);

            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /**
     * Revert the given fixes back to {@link SyncState#PENDING}.
     *
     * <p>Used when the delivery path is unavailable (e.g., WebView dead) and
     * the fixes were temporarily marked IN_FLIGHT but no delivery attempt was
     * actually made. This preserves the at-least-once guarantee by keeping
     * fixes in a retryable state without incrementing their attempt count.
     *
     * @param ids the {@code local_id} values of fixes to revert to PENDING
     */
    public synchronized void markPending(@NonNull List<Long> ids) {
        if (ids.isEmpty()) {
            return;
        }

        SQLiteDatabase db = dbHelper.getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues values = new ContentValues();
            values.put(COL_STATE, SyncState.PENDING.getValue());

            String whereClause = COL_LOCAL_ID + " IN (" + buildPlaceholders(ids.size()) + ")";
            String[] whereArgs = idsToStringArray(ids);
            db.update(TABLE_NAME, values, whereClause, whereArgs);

            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /**
     * Mark the given fixes as {@link SyncState#DELIVERED}.
     *
     * @param ids the {@code local_id} values of fixes to mark delivered
     */
    public synchronized void markDelivered(@NonNull List<Long> ids) {
        if (ids.isEmpty()) {
            return;
        }

        SQLiteDatabase db = dbHelper.getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues values = new ContentValues();
            values.put(COL_STATE, SyncState.DELIVERED.getValue());

            String whereClause = COL_LOCAL_ID + " IN (" + buildPlaceholders(ids.size()) + ")";
            String[] whereArgs = idsToStringArray(ids);
            db.update(TABLE_NAME, values, whereClause, whereArgs);

            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /**
     * Mark the given fixes as {@link SyncState#FAILED}, increment their
     * {@code attempt_count}, and set {@code last_attempt_at} to the current time.
     *
     * @param ids the {@code local_id} values of fixes to mark failed
     */
    public synchronized void markFailed(@NonNull List<Long> ids) {
        if (ids.isEmpty()) {
            return;
        }

        SQLiteDatabase db = dbHelper.getWritableDatabase();
        long now = System.currentTimeMillis();
        db.beginTransaction();
        try {
            // Use raw SQL for the increment expression.
            String inClause = buildPlaceholders(ids.size());
            String sql = "UPDATE " + TABLE_NAME
                    + " SET " + COL_STATE + " = ?"
                    + ", " + COL_ATTEMPT_COUNT + " = " + COL_ATTEMPT_COUNT + " + 1"
                    + ", " + COL_LAST_ATTEMPT_AT + " = ?"
                    + " WHERE " + COL_LOCAL_ID + " IN (" + inClause + ")";

            // Build args: state, lastAttemptAt, then all ids
            Object[] bindArgs = new Object[2 + ids.size()];
            bindArgs[0] = SyncState.FAILED.getValue();
            bindArgs[1] = now;
            for (int i = 0; i < ids.size(); i++) {
                bindArgs[2 + i] = ids.get(i);
            }

            db.execSQL(sql, bindArgs);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /**
     * Enforce retention policy:
     * <ol>
     *   <li>Delete {@code DELIVERED} rows older than 24 hours.</li>
     *   <li>If the total count still exceeds {@link #MAX_ENTRIES}, evict
     *       using the overflow policy.</li>
     * </ol>
     */
    public synchronized void prune() {
        SQLiteDatabase db = dbHelper.getWritableDatabase();
        db.beginTransaction();
        try {
            // 1. Delete DELIVERED rows older than retention window.
            long cutoff = System.currentTimeMillis() - DELIVERED_RETENTION_MS;
            db.delete(
                    TABLE_NAME,
                    COL_STATE + " = ? AND " + COL_CAPTURED_AT_EPOCH + " < ?",
                    new String[]{SyncState.DELIVERED.getValue(), String.valueOf(cutoff)}
            );

            // 2. Enforce the size bound in case there's still overflow.
            enforceMaxEntries(db);

            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /**
     * Deletes all queued fixes that do NOT belong to the given rider.
     *
     * <p>Called on shift start to purge stale entries left by earlier builds
     * (e.g. rows tagged with a numeric callbackId placeholder instead of a real
     * rider UUID). Such rows can never upload successfully and would otherwise
     * cycle through retries forever.
     *
     * @param riderId the current shift's rider id (rows with any other rider_id
     *                are deleted)
     * @return the number of rows deleted
     */
    public synchronized int deleteForRidersOtherThan(@NonNull String riderId) {
        SQLiteDatabase db = dbHelper.getWritableDatabase();
        return db.delete(
                TABLE_NAME,
                COL_RIDER_ID + " <> ?",
                new String[]{riderId}
        );
    }

    /**
     * Returns the current total number of entries in the queue.
     * Useful for diagnostics and testing.
     */
    public synchronized int getCount() {
        SQLiteDatabase db = dbHelper.getReadableDatabase();
        Cursor cursor = db.rawQuery("SELECT COUNT(*) FROM " + TABLE_NAME, null);
        try {
            cursor.moveToFirst();
            return cursor.getInt(0);
        } finally {
            cursor.close();
        }
    }

    /**
     * Close the database. Should be called when the service is done.
     */
    public synchronized void close() {
        dbHelper.close();
    }

    // -------------------------------------------------------------------------
    // Backoff helper
    // -------------------------------------------------------------------------

    /**
     * Determines if a FAILED fix is eligible for retry based on exponential
     * backoff. Formula: base 5000ms * 2^(attemptCount - 1), capped at 300000ms.
     *
     * @param fix the failed fix to evaluate
     * @param now current time in milliseconds since epoch
     * @return true if enough time has elapsed since the last attempt
     */
    private boolean isRetryable(@NonNull QueuedLocation fix, long now) {
        if (fix.getLastAttemptAt() == null) {
            // Never attempted (shouldn't happen for FAILED, but safe default)
            return true;
        }
        long backoffMs = calculateBackoff(fix.getAttemptCount());
        return (now - fix.getLastAttemptAt()) >= backoffMs;
    }

    /**
     * Calculate the backoff delay for a given attempt count.
     * Base: 5000ms, doubling each attempt, capped at 300000ms.
     * Note: this does NOT include jitter — jitter is added by the SyncWorker
     * when scheduling the next drain, not per-fix.
     *
     * @param attemptCount number of failed attempts so far
     * @return backoff delay in milliseconds (without jitter)
     */
    static long calculateBackoff(int attemptCount) {
        if (attemptCount <= 0) {
            return 5000L;
        }
        // base 5s * 2^(attemptCount - 1), capped at 300s
        long delay = 5000L * (1L << Math.min(attemptCount - 1, 20));
        return Math.min(delay, 300_000L);
    }

    // -------------------------------------------------------------------------
    // Eviction logic (private, called within transactions)
    // -------------------------------------------------------------------------

    /**
     * Enforce the 10000-entry bound with the specified eviction order:
     * <ol>
     *   <li>Oldest {@code DELIVERED} first.</li>
     *   <li>Then oldest {@code PENDING}.</li>
     *   <li>Never evict the most recent fix (highest {@code local_id}).</li>
     * </ol>
     *
     * <p>Must be called within an active transaction.
     */
    private void enforceMaxEntries(@NonNull SQLiteDatabase db) {
        int count = getRowCount(db);
        if (count <= MAX_ENTRIES) {
            return;
        }

        int excess = count - MAX_ENTRIES;

        // Find the highest local_id — this fix is never evicted.
        long maxLocalId = getMaxLocalId(db);

        // Phase 1: evict oldest DELIVERED (excluding the most recent fix).
        int evicted = evictOldest(db, SyncState.DELIVERED, excess, maxLocalId);
        excess -= evicted;

        if (excess <= 0) {
            return;
        }

        // Phase 2: evict oldest PENDING (excluding the most recent fix).
        evictOldest(db, SyncState.PENDING, excess, maxLocalId);
    }

    /**
     * Evict up to {@code limit} oldest rows in the given state, excluding the
     * row with {@code maxLocalId}.
     *
     * @return the number of rows actually evicted
     */
    private int evictOldest(@NonNull SQLiteDatabase db, @NonNull SyncState state,
                            int limit, long maxLocalId) {
        // Find IDs to evict: oldest first by local_id, excluding the max.
        String sql = "SELECT " + COL_LOCAL_ID + " FROM " + TABLE_NAME
                + " WHERE " + COL_STATE + " = ? AND " + COL_LOCAL_ID + " != ?"
                + " ORDER BY " + COL_LOCAL_ID + " ASC"
                + " LIMIT ?";

        Cursor cursor = db.rawQuery(sql, new String[]{
                state.getValue(),
                String.valueOf(maxLocalId),
                String.valueOf(limit)
        });

        List<Long> idsToEvict = new ArrayList<>();
        try {
            while (cursor.moveToNext()) {
                idsToEvict.add(cursor.getLong(0));
            }
        } finally {
            cursor.close();
        }

        if (idsToEvict.isEmpty()) {
            return 0;
        }

        // Delete in a single statement.
        String inClause = buildPlaceholders(idsToEvict.size());
        String deleteSql = "DELETE FROM " + TABLE_NAME
                + " WHERE " + COL_LOCAL_ID + " IN (" + inClause + ")";
        Object[] args = new Object[idsToEvict.size()];
        for (int i = 0; i < idsToEvict.size(); i++) {
            args[i] = idsToEvict.get(i);
        }
        db.execSQL(deleteSql, args);

        return idsToEvict.size();
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private int getRowCount(@NonNull SQLiteDatabase db) {
        Cursor cursor = db.rawQuery("SELECT COUNT(*) FROM " + TABLE_NAME, null);
        try {
            cursor.moveToFirst();
            return cursor.getInt(0);
        } finally {
            cursor.close();
        }
    }

    private long getMaxLocalId(@NonNull SQLiteDatabase db) {
        Cursor cursor = db.rawQuery(
                "SELECT MAX(" + COL_LOCAL_ID + ") FROM " + TABLE_NAME, null);
        try {
            cursor.moveToFirst();
            return cursor.isNull(0) ? -1 : cursor.getLong(0);
        } finally {
            cursor.close();
        }
    }

    private QueuedLocation cursorToQueuedLocation(@NonNull Cursor cursor) {
        int idxLocalId = cursor.getColumnIndexOrThrow(COL_LOCAL_ID);
        int idxRiderId = cursor.getColumnIndexOrThrow(COL_RIDER_ID);
        int idxLat = cursor.getColumnIndexOrThrow(COL_LAT);
        int idxLng = cursor.getColumnIndexOrThrow(COL_LNG);
        int idxAccuracy = cursor.getColumnIndexOrThrow(COL_ACCURACY_M);
        int idxSpeed = cursor.getColumnIndexOrThrow(COL_SPEED_MPS);
        int idxBearing = cursor.getColumnIndexOrThrow(COL_BEARING_DEG);
        int idxCapturedAt = cursor.getColumnIndexOrThrow(COL_CAPTURED_AT_EPOCH);
        int idxState = cursor.getColumnIndexOrThrow(COL_STATE);
        int idxAttemptCount = cursor.getColumnIndexOrThrow(COL_ATTEMPT_COUNT);
        int idxLastAttemptAt = cursor.getColumnIndexOrThrow(COL_LAST_ATTEMPT_AT);

        return new QueuedLocation(
                cursor.getLong(idxLocalId),
                cursor.getString(idxRiderId),
                cursor.getDouble(idxLat),
                cursor.getDouble(idxLng),
                cursor.getFloat(idxAccuracy),
                cursor.isNull(idxSpeed) ? null : cursor.getFloat(idxSpeed),
                cursor.isNull(idxBearing) ? null : cursor.getFloat(idxBearing),
                cursor.getLong(idxCapturedAt),
                SyncState.fromValue(cursor.getString(idxState)),
                cursor.getInt(idxAttemptCount),
                cursor.isNull(idxLastAttemptAt) ? null : cursor.getLong(idxLastAttemptAt)
        );
    }

    /**
     * Build a comma-separated list of "?" placeholders for SQL IN clauses.
     */
    private static String buildPlaceholders(int count) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < count; i++) {
            if (i > 0) sb.append(',');
            sb.append('?');
        }
        return sb.toString();
    }

    /**
     * Convert a list of Long ids to a String array for SQL bind args.
     */
    private static String[] idsToStringArray(@NonNull List<Long> ids) {
        String[] result = new String[ids.size()];
        for (int i = 0; i < ids.size(); i++) {
            result[i] = String.valueOf(ids.get(i));
        }
        return result;
    }

    // -------------------------------------------------------------------------
    // SQLiteOpenHelper
    // -------------------------------------------------------------------------

    /**
     * Internal SQLiteOpenHelper that manages database creation and upgrades.
     */
    private static final class QueueDbHelper extends SQLiteOpenHelper {

        private static final String CREATE_TABLE_SQL =
                "CREATE TABLE " + TABLE_NAME + " ("
                        + COL_LOCAL_ID + " INTEGER PRIMARY KEY AUTOINCREMENT, "
                        + COL_RIDER_ID + " TEXT NOT NULL, "
                        + COL_LAT + " REAL NOT NULL, "
                        + COL_LNG + " REAL NOT NULL, "
                        + COL_ACCURACY_M + " REAL NOT NULL, "
                        + COL_SPEED_MPS + " REAL, "
                        + COL_BEARING_DEG + " REAL, "
                        + COL_CAPTURED_AT_EPOCH + " INTEGER NOT NULL, "
                        + COL_STATE + " TEXT NOT NULL DEFAULT 'PENDING', "
                        + COL_ATTEMPT_COUNT + " INTEGER NOT NULL DEFAULT 0, "
                        + COL_LAST_ATTEMPT_AT + " INTEGER"
                        + ")";

        // Index on state for efficient peekBatch and eviction queries.
        private static final String CREATE_INDEX_STATE_SQL =
                "CREATE INDEX idx_location_queue_state ON " + TABLE_NAME
                        + " (" + COL_STATE + ", " + COL_LOCAL_ID + ")";

        QueueDbHelper(@NonNull Context context) {
            super(context, DB_NAME, null, DB_VERSION);
        }

        @Override
        public void onCreate(SQLiteDatabase db) {
            db.execSQL(CREATE_TABLE_SQL);
            db.execSQL(CREATE_INDEX_STATE_SQL);
        }

        @Override
        public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            // Version 1 is the initial schema. Future migrations go here.
        }
    }
}
