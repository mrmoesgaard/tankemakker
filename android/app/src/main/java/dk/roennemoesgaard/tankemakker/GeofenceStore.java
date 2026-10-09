package dk.roennemoesgaard.tankemakker;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.tasks.Task;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Keeps the home location and the pending "arrive/leave home" reminders in SharedPreferences,
 * so the geofence can fire notifications even when the app (and its JavaScript) is not running.
 */
final class GeofenceStore {

    static final String CHANNEL_ID = "reminders";
    private static final String PREFS = "tankemakker_geofence";
    private static final String FENCE_ID = "home";

    private GeofenceStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void save(Context ctx, JSONObject home, double radius, JSONArray reminders) {
        prefs(ctx)
            .edit()
            .putString("home", home == null ? null : home.toString())
            .putFloat("radius", (float) radius)
            .putString("reminders", reminders.toString())
            .apply();
    }

    static JSONArray reminders(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString("reminders", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static JSONObject home(Context ctx) {
        String raw = prefs(ctx).getString("home", null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            return null;
        }
    }

    static boolean hasFineLocation(Context ctx) {
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean hasBackgroundLocation(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return hasFineLocation(ctx);
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private static PendingIntent pendingIntent(Context ctx) {
        Intent intent = new Intent(ctx, GeofenceReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        return PendingIntent.getBroadcast(ctx, 0, intent, flags);
    }

    /** Registers (or removes) the home geofence based on what is saved. */
    @SuppressLint("MissingPermission")
    static Task<Void> register(Context ctx) {
        GeofencingClient client = LocationServices.getGeofencingClient(ctx);
        JSONObject home = home(ctx);
        if (home == null || reminders(ctx).length() == 0 || !hasFineLocation(ctx)) {
            return client.removeGeofences(pendingIntent(ctx));
        }
        Geofence fence = new Geofence.Builder()
            .setRequestId(FENCE_ID)
            .setCircularRegion(home.optDouble("lat"), home.optDouble("lng"), prefs(ctx).getFloat("radius", 150f))
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER | Geofence.GEOFENCE_TRANSITION_EXIT)
            .build();
        GeofencingRequest request = new GeofencingRequest.Builder().setInitialTrigger(0).addGeofence(fence).build();
        return client.addGeofences(request, pendingIntent(ctx));
    }

    /** Shows notifications for reminders matching the transition, and remembers them as fired. */
    static void fire(Context ctx, String when) {
        createChannel(ctx);
        JSONArray all = reminders(ctx);
        JSONArray remaining = new JSONArray();
        JSONArray fired = firedIds(ctx);

        for (int i = 0; i < all.length(); i++) {
            JSONObject r = all.optJSONObject(i);
            if (r == null) continue;
            if (when.equals(r.optString("when"))) {
                notify(ctx, r.optInt("notifyId"), r.optString("text"));
                fired.put(r.optString("id"));
            } else {
                remaining.put(r);
            }
        }
        prefs(ctx).edit().putString("reminders", remaining.toString()).putString("fired", fired.toString()).apply();
    }

    static JSONArray firedIds(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString("fired", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static JSONArray takeFiredIds(Context ctx) {
        JSONArray ids = firedIds(ctx);
        prefs(ctx).edit().putString("fired", "[]").apply();
        return ids;
    }

    private static void createChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Påmindelser", NotificationManager.IMPORTANCE_HIGH);
        ctx.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @SuppressLint("MissingPermission")
    private static void notify(Context ctx, int id, String text) {
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_mic)
            .setContentTitle("Tankemakker")
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(tap);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            NotificationManagerCompat.from(ctx).notify(id, builder.build());
        }
    }
}
