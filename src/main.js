import { askAssistant, describeError, MODELS } from "./ai.js";
import { applyActions, loadData, loadSettings, saveData, saveSettings } from "./store.js";
import { decryptSecret, encryptSecret, forgetUnlocked, recallUnlocked, rememberUnlocked } from "./lock.js";
import { canListen, canSpeak, getDanishVoices, listenOnce, speak, stopListening, stopSpeaking } from "./speech.js";

const $ = (sel) => document.querySelector(sel);

let data = loadData();
let settings = loadSettings();
let apiKey = settings.encryptedKey ? recallUnlocked() : settings.apiKey;
let undoStack = [];
let dialog = [];
let lastTurnAt = 0;
let session = 0; // incremented to cancel a running conversation
let wakeLock = null;

const STOP_WORDS = /^(stop|stop stop|slut|farvel|det var det|det var alt|tak det var det|nej tak|ellers tak)\.?$/i;
const UNDO_WORDS = /^(fortryd|fortryd det|fortryd sidste)\.?$/i;
const DIALOG_TTL_MS = 15 * 60 * 1000;

// ---------- Talk view ----------

function setStatus(text, mode = "idle") {
  $("#status").textContent = text;
  document.body.dataset.mode = mode;
}

function showTranscript(text) {
  $("#transcript").textContent = text;
}

function showReply(text) {
  $("#reply").textContent = text;
}

function showChanges(changed) {
  const box = $("#changes");
  box.innerHTML = "";
  for (const c of changed) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = c.label;
    chip.onclick = () => openThread(c.id);
    box.append(chip);
  }
  $("#undo").hidden = undoStack.length === 0;
}

async function acquireWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function undo() {
  const previous = undoStack.pop();
  if (!previous) return false;
  data = previous;
  saveData(data);
  renderThreads();
  showChanges([]);
  return true;
}

async function handleUtterance(text, mySession) {
  if (Date.now() - lastTurnAt > DIALOG_TTL_MS) dialog = [];
  lastTurnAt = Date.now();

  if (UNDO_WORDS.test(text)) {
    const reply = undo() ? "Okay, jeg har fortrudt det sidste." : "Der er ikke noget at fortryde.";
    showReply(reply);
    return { reply, expectsAnswer: false };
  }

  if (!apiKey) {
    const reply = "Du mangler at indtaste en API-nøgle under Indstillinger.";
    showReply(reply);
    return { reply, expectsAnswer: false };
  }

  setStatus("Tænker…", "thinking");
  const result = await askAssistant({
    apiKey,
    model: settings.model,
    threads: data.threads,
    dialog,
    utterance: text,
  });
  if (mySession !== session) return null;

  if (result.actions.length > 0) {
    undoStack.push(structuredClone(data));
    undoStack = undoStack.slice(-20);
    const applied = applyActions(data, result.actions, text);
    data = applied.data;
    saveData(data);
    renderThreads();
    showChanges(applied.changed);
  } else {
    showChanges([]);
  }

  dialog.push({ who: "user", text }, { who: "assistant", text: result.spoken_reply });
  dialog = dialog.slice(-8);
  showReply(result.spoken_reply);
  return { reply: result.spoken_reply, expectsAnswer: result.expects_answer };
}

async function conversation() {
  const mySession = ++session;
  await acquireWakeLock();
  try {
    while (mySession === session) {
      setStatus("Lytter…", "listening");
      showTranscript("");
      const text = await listenOnce({ onInterim: showTranscript });
      if (mySession !== session) return;
      if (!text) break;
      showTranscript(text);

      if (STOP_WORDS.test(text)) {
        setStatus("Taler…", "speaking");
        await speak("Okay, vi snakkes ved.", settings.voiceURI);
        break;
      }

      const outcome = await handleUtterance(text, mySession);
      if (!outcome) return;
      setStatus("Taler…", "speaking");
      await speak(outcome.reply, settings.voiceURI);
      if (mySession !== session) return;
      if (!settings.conversationMode && !outcome.expectsAnswer) break;
    }
  } catch (err) {
    if (mySession !== session) return;
    const message = describeError(err);
    showReply(message);
    await speak(message, settings.voiceURI);
  } finally {
    if (mySession === session) {
      setStatus("Tryk for at tale", "idle");
      releaseWakeLock();
    }
  }
}

function cancelConversation() {
  session++;
  stopListening();
  stopSpeaking();
  releaseWakeLock();
  setStatus("Tryk for at tale", "idle");
}

$("#mic").onclick = () => {
  if (document.body.dataset.mode === "idle") conversation();
  else cancelConversation();
};

$("#undo").onclick = () => {
  undo();
  showReply("Fortrudt.");
};

$("#text-form").onsubmit = async (event) => {
  event.preventDefault();
  const input = $("#text-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  cancelConversation();
  const mySession = session;
  showTranscript(text);
  try {
    await handleUtterance(text, mySession);
  } catch (err) {
    showReply(describeError(err));
  } finally {
    if (mySession === session) setStatus("Tryk for at tale", "idle");
  }
};

// ---------- Threads view ----------

function formatAgo(iso) {
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 1) return "lige nu";
  if (minutes < 60) return `${minutes} min. siden`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} t. siden`;
  const days = Math.round(hours / 24);
  return days === 1 ? "i går" : `${days} dage siden`;
}

function element(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children.filter((c) => c != null));
  return el;
}

function commit(mutator) {
  undoStack.push(structuredClone(data));
  mutator();
  saveData(data);
  renderThreads();
}

function renderThreads() {
  const list = $("#thread-list");
  const query = $("#search").value.trim().toLowerCase();
  const showArchived = $("#show-archived").checked;

  const threads = data.threads
    .filter((t) => t.archived === showArchived)
    .filter((t) => !query || JSON.stringify(t).toLowerCase().includes(query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  list.innerHTML = "";
  if (threads.length === 0) {
    list.append(element("p", { className: "empty", textContent: showArchived ? "Ingen arkiverede tråde." : "Ingen tråde endnu. Gå til Tal og fortæl om en tanke." }));
    return;
  }

  for (const t of threads) list.append(renderThread(t));
}

function renderThread(t) {
  const details = element("details", { className: "thread", id: `thread-${t.id}` });
  details.append(
    element("summary", {},
      element("span", { className: "thread-title", textContent: t.title }),
      element("span", { className: "thread-ago", textContent: formatAgo(t.updatedAt) }),
    ),
    element("p", { className: "thread-status", textContent: t.status || "Ingen status endnu." }),
  );

  if (t.nextSteps.length) {
    details.append(element("h4", { textContent: "Næste skridt" }), element("ul", {}, ...t.nextSteps.map((s) => element("li", { textContent: s }))));
  }

  details.append(element("h4", { textContent: `Noter (${t.notes.length})` }));
  const notes = element("ul", { className: "notes" });
  [...t.notes].reverse().forEach((n) => {
    const others = data.threads.filter((o) => o.id !== t.id && !o.archived);
    const move = element("select", { className: "small", title: "Flyt noten til en anden tråd" },
      element("option", { value: "", textContent: "Flyt…" }),
      ...others.map((o) => element("option", { value: o.id, textContent: o.title })),
    );
    move.onchange = () => {
      if (!move.value) return;
      commit(() => {
        const from = data.threads.find((x) => x.id === t.id);
        const to = data.threads.find((x) => x.id === move.value);
        from.notes = from.notes.filter((x) => x.ts + x.text !== n.ts + n.text);
        to.notes.push(n);
        to.notes.sort((a, b) => a.ts.localeCompare(b.ts));
        to.updatedAt = new Date().toISOString();
      });
    };
    const del = element("button", { className: "small danger", textContent: "Slet", type: "button" });
    del.onclick = () => commit(() => {
      const from = data.threads.find((x) => x.id === t.id);
      from.notes = from.notes.filter((x) => x.ts + x.text !== n.ts + n.text);
    });
    notes.append(element("li", {},
      element("div", { className: "note-meta", textContent: new Date(n.ts).toLocaleString("da-DK", { dateStyle: "medium", timeStyle: "short" }) }),
      element("div", { textContent: n.text }),
      element("div", { className: "note-actions" }, move, del),
    ));
  });
  details.append(notes);

  const rename = element("button", { className: "small", textContent: "Omdøb", type: "button" });
  rename.onclick = () => {
    const title = prompt("Nyt navn til tråden:", t.title);
    if (title?.trim()) commit(() => { data.threads.find((x) => x.id === t.id).title = title.trim(); });
  };
  const archive = element("button", { className: "small", textContent: t.archived ? "Gendan" : "Arkivér", type: "button" });
  archive.onclick = () => commit(() => { data.threads.find((x) => x.id === t.id).archived = !t.archived; });
  const remove = element("button", { className: "small danger", textContent: "Slet tråd", type: "button" });
  remove.onclick = () => {
    if (confirm(`Slet tråden "${t.title}" og alle dens noter?`)) commit(() => { data.threads = data.threads.filter((x) => x.id !== t.id); });
  };
  details.append(element("div", { className: "thread-actions" }, rename, archive, remove));
  return details;
}

function openThread(id) {
  const thread = data.threads.find((t) => t.id === id);
  if (!thread) return;
  $("#show-archived").checked = thread.archived;
  $("#search").value = "";
  showView("threads");
  renderThreads();
  const el = document.getElementById(`thread-${id}`);
  if (el) {
    el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

$("#search").oninput = renderThreads;
$("#show-archived").onchange = renderThreads;

// ---------- Settings view ----------

function renderSettings() {
  $("#key-status").textContent = settings.encryptedKey
    ? "✓ Nøglen er gemt og låst med din adgangskode."
    : settings.apiKey
      ? "Nøglen er gemt, men uden adgangskode."
      : "Ingen nøgle gemt endnu.";
  $("#lock-now").hidden = !settings.encryptedKey;
  $("#key-message").textContent = "";
  $("#conversation-mode").checked = settings.conversationMode;

  $("#model").innerHTML = "";
  for (const [id, label] of Object.entries(MODELS)) {
    $("#model").append(element("option", { value: id, textContent: label, selected: id === settings.model }));
  }

  const voices = getDanishVoices();
  $("#voice").innerHTML = "";
  if (voices.length === 0) $("#voice").append(element("option", { value: "", textContent: "Standard (ingen dansk stemme fundet)" }));
  for (const v of voices) {
    $("#voice").append(element("option", { value: v.voiceURI, textContent: v.name, selected: v.voiceURI === settings.voiceURI }));
  }
}

function updateSettings(patch) {
  settings = { ...settings, ...patch };
  saveSettings(settings);
}

$("#key-form").onsubmit = async (event) => {
  event.preventDefault();
  const newKey = $("#api-key").value.trim() || apiKey;
  const password = $("#key-password").value;
  if (!newKey) {
    $("#key-message").textContent = "Indsæt først din API-nøgle.";
    return;
  }
  if (password && password.length < 4) {
    $("#key-message").textContent = "Adgangskoden skal være på mindst 4 tegn.";
    return;
  }
  if (password) {
    updateSettings({ apiKey: "", encryptedKey: await encryptSecret(newKey, password) });
    rememberUnlocked(newKey);
  } else {
    updateSettings({ apiKey: newKey, encryptedKey: null });
    forgetUnlocked();
  }
  apiKey = newKey;
  $("#api-key").value = "";
  $("#key-password").value = "";
  renderSettings();
  $("#key-message").textContent = "Gemt.";
};

$("#lock-now").onclick = lockApp;

$("#model").onchange = (e) => updateSettings({ model: e.target.value });
$("#voice").onchange = (e) => updateSettings({ voiceURI: e.target.value });
$("#conversation-mode").onchange = (e) => updateSettings({ conversationMode: e.target.checked });
$("#test-voice").onclick = () => speak("Hej. Sådan lyder jeg, når jeg læser dine tråde op.", settings.voiceURI);
if (canSpeak) speechSynthesis.onvoiceschanged = renderSettings;

$("#export").onclick = () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = element("a", { href: URL.createObjectURL(blob), download: `tankemakker-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
};

$("#import").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.threads)) throw new Error();
    if (confirm(`Erstat dine nuværende tråde med ${imported.threads.length} tråde fra filen?`)) {
      commit(() => { data = imported; });
    }
  } catch {
    alert("Filen kunne ikke læses som en Tankemakker-sikkerhedskopi.");
  }
  e.target.value = "";
};

$("#wipe").onclick = () => {
  if (confirm("Slet ALLE tråde og noter? Det kan fortrydes med Fortryd-knappen, indtil du lukker appen.")) {
    commit(() => { data = { threads: [] }; });
  }
};

// ---------- Navigation & startup ----------

function showView(name) {
  for (const view of document.querySelectorAll(".view")) view.hidden = view.id !== `view-${name}`;
  for (const tab of document.querySelectorAll("nav button")) tab.classList.toggle("active", tab.dataset.view === name);
  if (name === "settings") renderSettings();
}

for (const tab of document.querySelectorAll("nav button")) tab.onclick = () => showView(tab.dataset.view);

if (!canListen) {
  $("#mic").disabled = true;
  setStatus("Talegenkendelse virker ikke i denne browser. Brug Chrome, eller skriv nedenfor.", "idle");
} else {
  setStatus("Tryk for at tale", "idle");
}

// ---------- Lock screen ----------

function lockApp() {
  cancelConversation();
  forgetUnlocked();
  apiKey = "";
  $("#unlock-password").value = "";
  $("#unlock-message").textContent = "";
  document.body.classList.add("locked");
  $("#lock").hidden = false;
  $("#unlock-password").focus();
}

function start() {
  document.body.classList.remove("locked");
  $("#lock").hidden = true;
  renderThreads();
  showView(apiKey ? "talk" : "settings");
  // Opened via the "Tal nu" shortcut: start listening straight away.
  if (canListen && apiKey && new URLSearchParams(location.search).has("lyt")) conversation();
}

$("#unlock-form").onsubmit = async (event) => {
  event.preventDefault();
  $("#unlock-message").textContent = "Låser op…";
  const key = await decryptSecret(settings.encryptedKey, $("#unlock-password").value);
  if (!key) {
    $("#unlock-message").textContent = "Forkert adgangskode.";
    $("#unlock-password").select();
    return;
  }
  apiKey = key;
  rememberUnlocked(key);
  start();
};

$("#forgot").onclick = () => {
  if (!confirm("Fjern den gemte API-nøgle? Dine tråde bliver ikke slettet, men du skal indsætte nøglen igen.")) return;
  updateSettings({ apiKey: "", encryptedKey: null });
  start();
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

if (settings.encryptedKey && !apiKey) lockApp();
else start();
