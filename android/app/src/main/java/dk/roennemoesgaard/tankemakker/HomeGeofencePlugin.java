package dk.roennemoesgaard.tankemakker;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;

/** Bridge between the web app (src/reminders.js) and the native home geofence. */
@CapacitorPlugin(
    name = "HomeGeofence",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "background", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
    }
)
public class HomeGeofencePlugin extends Plugin {

    private JSObject status() {
        JSObject ret = new JSObject();
        ret.put("fine", GeofenceStore.hasFineLocation(getContext()));
        ret.put("background", GeofenceStore.hasBackgroundLocation(getContext()));
        return ret;
    }

    @PluginMethod
    public void sync(PluginCall call) {
        JSObject home = call.getObject("home", null);
        double radius = call.getDouble("radius", 150.0);
        JSArray reminders = call.getArray("reminders", new JSArray());
        GeofenceStore.save(getContext(), home, radius, reminders);

        GeofenceStore.register(getContext())
            .addOnSuccessListener((unused) -> {
                JSObject ret = status();
                ret.put("active", home != null && reminders.length() > 0 && GeofenceStore.hasFineLocation(getContext()));
                call.resolve(ret);
            })
            .addOnFailureListener((e) -> {
                JSObject ret = status();
                ret.put("active", false);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            });
    }

    @PluginMethod
    public void getFired(PluginCall call) {
        JSONArray ids = GeofenceStore.takeFiredIds(getContext());
        JSObject ret = new JSObject();
        ret.put("ids", ids);
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestLocation(PluginCall call) {
        if (GeofenceStore.hasFineLocation(getContext())) {
            call.resolve(status());
        } else {
            requestPermissionForAlias("location", call, "permissionCallback");
        }
    }

    @PluginMethod
    public void requestBackground(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || GeofenceStore.hasBackgroundLocation(getContext())) {
            call.resolve(status());
        } else {
            requestPermissionForAlias("background", call, "permissionCallback");
        }
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        GeofenceStore.register(getContext());
        call.resolve(status());
    }
}
