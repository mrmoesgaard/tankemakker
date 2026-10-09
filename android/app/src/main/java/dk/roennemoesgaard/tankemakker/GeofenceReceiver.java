package dk.roennemoesgaard.tankemakker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

/** Called by Android when the phone enters or leaves the home area. */
public class GeofenceReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null || event.hasError()) return;

        int transition = event.getGeofenceTransition();
        if (transition == Geofence.GEOFENCE_TRANSITION_ENTER) {
            GeofenceStore.fire(context, "arrive_home");
        } else if (transition == Geofence.GEOFENCE_TRANSITION_EXIT) {
            GeofenceStore.fire(context, "leave_home");
        }
    }
}
