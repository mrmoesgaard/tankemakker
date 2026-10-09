const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const canListen = Boolean(Recognition);
export const canSpeak = "speechSynthesis" in window;

// Listens for one utterance. Resolves with the final text ("" if nothing was heard).
// onInterim receives the partial transcript while the user is talking.
export function listenOnce({ onInterim } = {}) {
  return new Promise((resolve, reject) => {
    const rec = new Recognition();
    rec.lang = "da-DK";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    rec.onresult = (event) => {
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

    listenOnce.current = rec;
    rec.start();
  });
}

export function stopListening() {
  listenOnce.current?.abort();
}

export function getDanishVoices() {
  if (!canSpeak) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("da"));
}

export function speak(text, voiceURI) {
  return new Promise((resolve) => {
    if (!canSpeak || !text) return resolve();
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

export function stopSpeaking() {
  if (canSpeak) speechSynthesis.cancel();
}
