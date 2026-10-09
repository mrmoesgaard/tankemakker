package dk.roennemoesgaard.tankemakker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Android forgets geofences when the phone restarts, so register the home area again. */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            GeofenceStore.register(context);
        }
    }
}
