// Encrypts the API key with a password (PBKDF2 + AES-GCM) so it is never stored in plain text.
const ITERATIONS = 250_000;
const UNLOCKED_KEY = "tankemakker.unlocked";

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(secret, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret));
  return { salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

// Returns the secret, or null if the password is wrong.
export async function decryptSecret(box, password) {
  try {
    const key = await deriveKey(password, fromB64(box.salt));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(box.iv) }, key, fromB64(box.data));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// The unlocked key is kept for as long as the app stays open, so it isn't
// asked for again on every reload, but is gone once the app is closed.
export function rememberUnlocked(secret) {
  try { sessionStorage.setItem(UNLOCKED_KEY, secret); } catch {}
}

export function recallUnlocked() {
  try { return sessionStorage.getItem(UNLOCKED_KEY) || ""; } catch { return ""; }
}

export function forgetUnlocked() {
  try { sessionStorage.removeItem(UNLOCKED_KEY); } catch {}
}
