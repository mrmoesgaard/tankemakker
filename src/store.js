const DATA_KEY = "tankemakker.data.v1";
const SETTINGS_KEY = "tankemakker.settings.v1";

const DEFAULT_SETTINGS = {
  apiKey: "", // only used when no password is set
  encryptedKey: null, // { salt, iv, data } when the key is locked with a password
  model: "claude-opus-5-5",
  voiceURI: "",
  conversationMode: true,
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

export function loadData() {
  return read(DATA_KEY, { threads: [] });
}

export function saveData(data) {
  write(DATA_KEY, data);
}

function newId() {
  return Math.random().toString(36).slice(2, 8);
}

// Applies the assistant's actions to a copy of the data and returns
// the new data plus a short human-readable summary of what changed.
export function applyActions(data, actions, rawUtterance) {
  const next = structuredClone(data);
  const now = new Date().toISOString();
  const changed = [];

  for (const a of actions) {
    if (a.type === "create_thread") {
      const thread = {
        id: newId(),
        title: a.title || "Ny tråd",
        status: a.status || "",
        nextSteps: a.next_steps || [],
        notes: a.note ? [{ ts: now, text: a.note, raw: rawUtterance }] : [],
        createdAt: now,
        updatedAt: now,
        archived: false,
      };
      next.threads.push(thread);
      changed.push({ id: thread.id, label: `Ny tråd: ${thread.title}` });
      continue;
    }

    const thread = next.threads.find((t) => t.id === a.thread_id);
    if (!thread) continue;

    if (a.type === "archive_thread") {
      thread.archived = true;
      thread.updatedAt = now;
      changed.push({ id: thread.id, label: `Arkiveret: ${thread.title}` });
      continue;
    }

    if (a.title) thread.title = a.title;
    if (a.status) thread.status = a.status;
    if (a.next_steps) thread.nextSteps = a.next_steps;
    if (a.note) thread.notes.push({ ts: now, text: a.note, raw: rawUtterance });
    thread.archived = false;
    thread.updatedAt = now;
    changed.push({ id: thread.id, label: `${a.note ? "Tilføjet til" : "Opdateret"}: ${thread.title}` });
  }

  return { data: next, changed };
}
