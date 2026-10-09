const DATA_KEY = "tankemakker.data.v1";
const SETTINGS_KEY = "tankemakker.settings.v1";

const DEFAULT_SETTINGS = {
  apiKey: "", // only used when no password is set
  azureKey: "", // only used when no password is set
  encryptedKey: null, // { salt, iv, data } holding the secrets when locked with a password
  azureRegion: "northeurope",
  azureVoice: "da-DK-ChristelNeural",
  ttsProvider: "device", // "device" | "azure"
  model: "claude-opus-5-5",
  voiceURI: "",
  conversationMode: true,
  home: null, // { lat, lng } once the user has pressed "Jeg er hjemme nu"
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error("Kunne ikke gemme", err);
  }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) };
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, settings);
}

// Upgrades data saved by older versions of the app.
export function migrateData(data) {
  data.threads ??= [];
  data.reminders ??= [];
  for (const t of data.threads) {
    if (!t.checklist) {
      t.checklist = (t.nextSteps || []).map((text) => ({ text, done: false }));
      delete t.nextSteps;
    }
  }
  return data;
}

export function loadData() {
  return migrateData(read(DATA_KEY, {}));
}

export function saveData(data) {
  write(DATA_KEY, data);
}

function newId() {
  return Math.random().toString(36).slice(2, 8);
}

// Notification ids must be 32-bit integers.
function newNotifyId() {
  return Math.floor(Math.random() * 2_000_000_000) + 1;
}

// Applies the assistant's actions to a copy of the data and returns
// the new data plus a short human-readable summary of what changed.
export function applyActions(data, actions, rawUtterance) {
  const next = structuredClone(data);
  const now = new Date().toISOString();
  const changed = [];
  const findThread = (id) => next.threads.find((t) => t.id === id);
  const touch = (thread) => {
    thread.archived = false;
    thread.updatedAt = now;
  };

  for (const a of actions) {
    switch (a.type) {
      case "create_thread": {
        const thread = {
          id: newId(),
          title: a.title || "Ny tråd",
          status: a.status || "",
          checklist: a.checklist || [],
          notes: a.note ? [{ ts: now, text: a.note, raw: rawUtterance }] : [],
          createdAt: now,
          updatedAt: now,
          archived: false,
        };
        next.threads.push(thread);
        changed.push({ threadId: thread.id, label: `Ny tråd: ${thread.title}` });
        break;
      }

      case "add_to_thread":
      case "update_thread":
      case "replace_last_note": {
        const thread = findThread(a.thread_id);
        if (!thread) break;
        if (a.title) thread.title = a.title;
        if (a.status) thread.status = a.status;
        if (a.checklist) thread.checklist = a.checklist;
        if (a.note && a.type === "replace_last_note" && thread.notes.length) {
          Object.assign(thread.notes.at(-1), { text: a.note, raw: rawUtterance, edited: now });
        } else if (a.note) {
          thread.notes.push({ ts: now, text: a.note, raw: rawUtterance });
        }
        touch(thread);
        const verb = a.type === "replace_last_note" ? "Rettet i" : a.note ? "Tilføjet til" : "Opdateret";
        changed.push({ threadId: thread.id, label: `${verb}: ${thread.title}` });
        break;
      }

      case "move_last_note": {
        const from = findThread(a.thread_id);
        const to = findThread(a.target_thread_id);
        if (!from || !to || !from.notes.length) break;
        to.notes.push(from.notes.pop());
        if (a.status) to.status = a.status;
        if (a.checklist) to.checklist = a.checklist;
        touch(to);
        changed.push({ threadId: to.id, label: `Flyttet til: ${to.title}` });
        break;
      }

      case "archive_thread": {
        const thread = findThread(a.thread_id);
        if (!thread) break;
        thread.archived = true;
        thread.updatedAt = now;
        changed.push({ threadId: thread.id, label: `Arkiveret: ${thread.title}` });
        break;
      }

      case "create_reminder": {
        if (!a.reminder_text || !a.reminder_when) break;
        if (a.reminder_when === "time" && !a.reminder_at) break;
        const reminder = {
          id: newId(),
          notifyId: newNotifyId(),
          text: a.reminder_text,
          when: a.reminder_when,
          at: a.reminder_when === "time" ? a.reminder_at : null,
          threadId: findThread(a.thread_id)?.id ?? null,
          createdAt: now,
          done: false,
        };
        next.reminders.push(reminder);
        changed.push({ threadId: reminder.threadId, label: `Påmindelse: ${describeWhen(reminder)}` });
        break;
      }

      case "delete_reminder": {
        const reminder = next.reminders.find((r) => r.id === a.reminder_id);
        if (!reminder) break;
        reminder.done = true;
        changed.push({ threadId: reminder.threadId, label: `Påmindelse fjernet: ${reminder.text}` });
        break;
      }
    }
  }

  return { data: next, changed };
}

export function describeWhen(reminder) {
  if (reminder.when === "arrive_home") return "når du kommer hjem";
  if (reminder.when === "leave_home") return "når du tager hjemmefra";
  const at = new Date(reminder.at);
  return at.toLocaleString("da-DK", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
