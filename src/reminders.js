import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

const isNative = Capacitor.isNativePlatform();
// Our own native plugin (android/app/src/main/java/.../HomeGeofencePlugin.java).
const HomeGeofence = registerPlugin("HomeGeofence");

export const HOME_RADIUS_M = 150;
const CHANNEL_ID = "reminders";

const isHomeReminder = (r) => r.when === "arrive_home" || r.when === "leave_home";

export function distanceMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Telefonen kan ikke finde din position."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => reject(new Error("Kunne ikke finde din position. Har appen adgang til placering?")),
      { enableHighAccuracy: true, timeout: 20000 },
    );
  });
}

// ---------- Native (Android app) ----------

async function syncNative(data, home) {
  await LocalNotifications.createChannel({ id: CHANNEL_ID, name: "Påmindelser", importance: 5, vibration: true });

  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }

  const now = Date.now();
  const timed = data.reminders.filter((r) => !r.done && r.when === "time" && new Date(r.at).getTime() > now);
  if (timed.length) {
    await LocalNotifications.schedule({
      notifications: timed.map((r) => ({
        id: r.notifyId,
        title: "Tankemakker",
        body: r.text,
        channelId: CHANNEL_ID,
        schedule: { at: new Date(r.at), allowWhileIdle: true },
        extra: { reminderId: r.id },
      })),
    });
  }

  const homeReminders = data.reminders
    .filter((r) => !r.done && isHomeReminder(r))
    .map((r) => ({ id: r.id, notifyId: r.notifyId, text: r.text, when: r.when }));
  return HomeGeofence.sync({ home, radius: HOME_RADIUS_M, reminders: homeReminders });
}

// Returns ids of reminders that have fired since last time, so they can be marked done.
async function collectFiredNative(data) {
  const { ids } = await HomeGeofence.getFired();
  const now = Date.now();
  const firedTimed = data.reminders.filter((r) => !r.done && r.when === "time" && new Date(r.at).getTime() <= now).map((r) => r.id);
  return [...ids, ...firedTimed];
}

export async function requestNativePermissions() {
  await LocalNotifications.requestPermissions();
  const status = await HomeGeofence.requestLocation();
  if (status.fine && !status.background) await HomeGeofence.requestBackground();
  return HomeGeofence.status();
}

// ---------- Web (only works while the app is open) ----------

let webTimer = null;
let webWatch = null;
let wasHome = null;

function startWebWatchers(getData, home, onFire) {
  clearInterval(webTimer);
  if (webWatch != null) navigator.geolocation?.clearWatch(webWatch);
  webWatch = null;

  webTimer = setInterval(() => {
    const now = Date.now();
    const due = getData().reminders.filter((r) => !r.done && r.when === "time" && new Date(r.at).getTime() <= now);
    if (due.length) onFire(due);
  }, 20000);

  const needsLocation = home && getData().reminders.some((r) => !r.done && isHomeReminder(r));
  if (!needsLocation || !navigator.geolocation) return;
  webWatch = navigator.geolocation.watchPosition(
    (pos) => {
      const isHome = distanceMeters(home, { lat: pos.coords.latitude, lng: pos.coords.longitude }) <= HOME_RADIUS_M;
      if (wasHome !== null && isHome !== wasHome) {
        const when = isHome ? "arrive_home" : "leave_home";
        const due = getData().reminders.filter((r) => !r.done && r.when === when);
        if (due.length) onFire(due);
      }
      wasHome = isHome;
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 30000 },
  );
}

// ---------- Shared entry points ----------

// Call whenever reminders or the home location change.
// onFire(reminders) is called on the web version when reminders become due while the app is open.
export async function syncReminders(getData, home, onFire) {
  if (isNative) {
    try {
      return await syncNative(getData(), home);
    } catch (err) {
      console.error("Kunne ikke planlægge påmindelser", err);
      return null;
    }
  }
  startWebWatchers(getData, home, onFire);
  return null;
}

export async function collectFired(data) {
  if (!isNative) return [];
  try {
    return await collectFiredNative(data);
  } catch {
    return [];
  }
}

export { isNative };
