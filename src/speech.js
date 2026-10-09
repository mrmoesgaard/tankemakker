import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { SpeechRecognition as NativeRecognition } from "@capacitor-community/speech-recognition";
import { TextToSpeech as NativeTTS } from "@capacitor-community/text-to-speech";

const isNative = Capacitor.isNativePlatform();
const WebRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const canListen = isNative || Boolean(WebRecognition);
export const canSpeak = isNative || "speechSynthesis" in window;

// How long a pause may be before we consider the user finished.
const GAP_MS = 2200;

let stopped = false;
let activeStop = null;

// ---------- Listening ----------

// Listens for one segment of speech. If startTimeoutMs is set and the user
// hasn't started talking by then, resolves with "".
function listenSegmentWeb({ onInterim, startTimeoutMs }) {
  return new Promise((resolve, reject) => {
    const rec = new WebRecognition();
    rec.lang = "da-DK";
    rec.interimResults = true;
    rec.continuous = false;

    let finalText = "";
    let heard = false;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = startTimeoutMs ? setTimeout(() => !heard && rec.abort(), startTimeoutMs) : null;

    rec.onresult = (event) => {
      heard = true;
      let interim = "";
      finalText = "";
      for (const result of event.results) {
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      onInterim?.((finalText + " " + interim).trim());
    };
    rec.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") finish(resolve, "");
      else if (event.error === "not-allowed") finish(reject, new Error("Appen har ikke adgang til mikrofonen."));
      else finish(reject, new Error(`Talegenkendelse fejlede (${event.error}).`));
    };
    rec.onend = () => finish(resolve, finalText.trim());

    activeStop = () => rec.abort();
    rec.start();
  });
}

async function listenSegmentNative({ startTimeoutMs }) {
  const { speechRecognition } = await NativeRecognition.requestPermissions();
  if (speechRecognition !== "granted") throw new Error("Appen har ikke adgang til mikrofonen.");

  let heard = false;
  const handle = await NativeRecognition.addListener("listeningState", ({ status }) => {
    if (status === "started") heard = true;
  });
  const timer = startTimeoutMs ? setTimeout(() => !heard && NativeRecognition.stop(), startTimeoutMs) : null;
  activeStop = () => NativeRecognition.stop();

  try {
    const result = await NativeRecognition.start({ language: "da-DK", maxResults: 1, partialResults: false, popup: false });
    return result.matches?.[0]?.trim() || "";
  } catch {
    // "No match" and timeouts end up here: treat them as silence.
    return "";
  } finally {
    clearTimeout(timer);
    handle.remove();
  }
}

const joinText = (a, b) => [a, b].filter(Boolean).join(" ");

// Listens until the user has been quiet for a moment, so short pauses
// in the middle of a thought don't cut them off.
export async function listen({ onInterim } = {}) {
  stopped = false;
  let text = "";
  while (!stopped) {
    const segmentOptions = {
      onInterim: (partial) => onInterim?.(joinText(text, partial)),
      startTimeoutMs: text ? GAP_MS : null,
    };
    const segment = isNative ? await listenSegmentNative(segmentOptions) : await listenSegmentWeb(segmentOptions);
    if (!segment) break;
    text = joinText(text, segment);
    onInterim?.(text);
  }
  activeStop = null;
  return stopped ? "" : text;
}

export function stopListening() {
  stopped = true;
  activeStop?.();
}

// ---------- Speaking ----------

export const AZURE_VOICES = {
  "da-DK-ChristelNeural": "Christel (kvinde)",
  "da-DK-JeppeNeural": "Jeppe (mand)",
};

let currentAudio = null;
let speakToken = 0;

function escapeXml(text) {
  return text.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);
}

async function fetchAzureAudio(text, { azureKey, azureRegion, azureVoice }) {
  const url = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = `<speak version="1.0" xml:lang="da-DK"><voice name="${azureVoice}">${escapeXml(text)}</voice></speak>`;
  const headers = {
    "Ocp-Apim-Subscription-Key": azureKey,
    "Content-Type": "application/ssml+xml",
    "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
  };

  if (isNative) {
    // Native HTTP avoids browser CORS rules; binary data comes back base64-encoded.
    const res = await CapacitorHttp.post({ url, headers, data: ssml, responseType: "blob" });
    if (res.status !== 200) throw new Error(`Azure-stemmen svarede med fejl ${res.status}.`);
    return `data:audio/mpeg;base64,${res.data}`;
  }
  const res = await fetch(url, { method: "POST", headers, body: ssml });
  if (!res.ok) throw new Error(`Azure-stemmen svarede med fejl ${res.status}.`);
  return URL.createObjectURL(await res.blob());
}

function playAudio(src) {
  return new Promise((resolve) => {
    const audio = new Audio(src);
    currentAudio = audio;
    const done = () => {
      if (currentAudio === audio) currentAudio = null;
      if (src.startsWith("blob:")) URL.revokeObjectURL(src);
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.onpause = done;
    audio.play().catch(done);
  });
}

export function getDanishVoices() {
  if (isNative || !("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("da"));
}

function speakDevice(text, voiceURI) {
  if (isNative) return NativeTTS.speak({ text, lang: "da-DK", rate: 1.0 }).catch(() => {});
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "da-DK";
    const voices = getDanishVoices();
    utterance.voice = voices.find((v) => v.voiceURI === voiceURI) || voices[0] || null;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    speechSynthesis.speak(utterance);
  });
}

// Speaks with the Azure voice when it is set up, otherwise the phone's own voice.
// Falls back to the phone's voice if Azure fails, so the user always hears the answer.
export async function speak(text, settings) {
  if (!text) return;
  stopSpeaking();
  const token = speakToken;
  if (settings.ttsProvider === "azure" && settings.azureKey) {
    try {
      const src = await fetchAzureAudio(text, settings);
      if (token !== speakToken) return;
      await playAudio(src);
      return;
    } catch (err) {
      console.warn("Azure-stemmen fejlede, bruger telefonens stemme", err);
    }
  }
  if (token === speakToken) await speakDevice(text, settings.voiceURI);
}

export function stopSpeaking() {
  speakToken++;
  currentAudio?.pause();
  if (isNative) NativeTTS.stop().catch(() => {});
  else if ("speechSynthesis" in window) speechSynthesis.cancel();
}
