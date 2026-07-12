package com.arogyadiet.rider.location;

import android.util.Log;

import androidx.annotation.NonNull;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.json.JSONObject;

/**
 * Minimal, dependency-free Supabase uploader for live rider location.
 *
 * <p>Posts to the {@code upsert_rider_live_location} PostgREST RPC using only
 * the public anon (publishable) key. The RPC is a narrow SECURITY DEFINER
 * function so table-level RLS stays intact (see
 * {@code scripts/create-rider-live-location-upsert-rpc.sql}).
 *
 * <p><b>Threading:</b> {@link #upsertLocation} performs a synchronous,
 * blocking network call and MUST be invoked off the main thread (the
 * {@link SyncWorker} runs on a dedicated background {@code HandlerThread}).
 *
 * <p>The URL and anon key are public values safe to embed in the client.
 */
public final class SupabaseUploader {

    private static final String TAG = "SupabaseUploader";

    // Public project values (safe to embed — the anon key is the browser-side
    // publishable key already shipped in the web bundle).
    private static final String SUPABASE_URL =
            "https://mozolxjkzytjigdmngqq.supabase.co";
    private static final String SUPABASE_ANON_KEY =
            "sb_publishable_BFhrJKphYOcRqN23rNR8tg__y-YD5BE";

    private static final String RPC_PATH = "/rest/v1/rpc/upsert_rider_live_location";

    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 10_000;

    /**
     * Upsert a rider's live location via the Supabase RPC. Blocking call —
     * invoke off the main thread.
     *
     * @param riderId the rider_profiles.id (UUID string)
     * @param lat     latitude
     * @param lng     longitude
     * @return true on HTTP 2xx (success), false on any failure (caller retries)
     */
    public boolean upsertLocation(@NonNull String riderId, double lat, double lng) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_URL + RPC_PATH);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", SUPABASE_ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + SUPABASE_ANON_KEY);
            // RETURNS void → 204 No Content; ask PostgREST not to return a body.
            conn.setRequestProperty("Prefer", "return=minimal");

            JSONObject body = new JSONObject();
            body.put("p_rider_id", riderId);
            body.put("p_lat", lat);
            body.put("p_lng", lng);

            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
            }

            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                Log.d(TAG, "upsertLocation OK (" + code + ") rider=" + riderId
                        + " lat=" + lat + " lng=" + lng);
                return true;
            }

            Log.w(TAG, "upsertLocation failed HTTP " + code + ": "
                    + readStream(conn.getErrorStream()));
            return false;
        } catch (Exception e) {
            Log.e(TAG, "upsertLocation error: " + e.getMessage(), e);
            return false;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static String readStream(InputStream in) {
        if (in == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader =
                     new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
        } catch (Exception ignore) {
            // best-effort diagnostics only
        }
        return sb.toString();
    }
}
