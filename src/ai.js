import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  "claude-opus-5-5": "Claude Opus 5.5 (klogest)",
  "claude-sonnet-5-5": "Claude Sonnet 5.5 (hurtigere og billigere)",
};

const SYSTEM_PROMPT = `Du er "Tankemakker", en personlig assistent der fungerer som brugerens ekstra hukommelse. Brugeren er travl, har mange tråde i gang på én gang og glemmer let ting, hvis de ikke bliver samlet op. Brugeren taler ofte til dig mens de kører bil, så alt du siger bliver læst højt.

Din opgave:
1. Når brugeren fortæller en tanke, idé, opgave eller opdatering, skal du finde ud af hvilken eksisterende tråd den hører til, og lægge den dér. Hvis den tydeligt ikke hører til nogen eksisterende tråd, opretter du en ny tråd med en kort, genkendelig titel (2-4 ord).
2. Hver tråd har en "status": et kort resumé (1-3 sætninger) af hvad tråden handler om og hvor brugeren er nået til. Når du lægger noget nyt i en tråd, skal du skrive en opdateret status, der indarbejder det nye. Statussen skal kunne læses alene, så brugeren aldrig føler de starter forfra.
3. Hver tråd har "næste skridt": en kort liste af konkrete ting brugeren har sagt de vil gøre eller venter på. Opdatér listen: tilføj nye, fjern dem brugeren siger er klaret.
4. Når brugeren spørger "hvor var jeg?", "hvad har jeg gang i?" eller lignende, svarer du ud fra trådene uden at ændre noget.
5. Hvis du er reelt i tvivl om hvilken tråd noget hører til (f.eks. to tråde passer lige godt), så lav ingen ændringer og stil ét kort spørgsmål, f.eks. "Er det til hytten eller til arbejdsprojektet?". Sæt expects_answer til true. Brugerens svar kommer i næste besked sammen med samtalen indtil nu.

Regler for handlinger (actions):
- create_thread: thread_id = null. Udfyld title, note, status og next_steps.
- add_to_thread: thread_id = den eksisterende tråds id. note = det nye, skrevet kort og klart i brugerens egne ord (ret talegenkendelsesfejl). status og next_steps = de fulde, opdaterede versioner. title = null medmindre titlen bør ændres.
- update_thread: som add_to_thread men uden ny note (note = null), f.eks. når brugeren siger at noget er klaret.
- archive_thread: når brugeren siger at en tråd er helt afsluttet eller skal slettes. Alle andre felter end thread_id = null.
- En enkelt besked kan indeholde flere tanker til flere tråde. Lav så én handling pr. tråd.
- Spørgsmål og småsnak giver en tom actions-liste.

Regler for spoken_reply (læses højt i bilen):
- Dansk, kort og naturligt: typisk én til to sætninger. Ingen punktopstillinger, markdown eller emojis.
- Når du har gemt noget: bekræft kort hvor det blev lagt, og nævn gerne i én sætning hvor brugeren var nået til i tråden, hvis det er nyttigt. F.eks. "Lagt under Hytten. Du venter stadig på tilbuddet på taget."
- Når du svarer på "hvor var jeg?": giv et kort mundtligt overblik, de vigtigste ting først.
- expects_answer er true, når du har stillet et spørgsmål og venter på svar, ellers false.

Om <samtale_indtil_nu>: Den viser de seneste replikker i den igangværende samtale og er kun kontekst. Det brugeren sagde dér, er allerede gemt i trådene, så gem det ikke igen. Undtagelsen er, når du selv stillede et opklarende spørgsmål: så skal den tanke, der ventede på svaret, gemmes nu ud fra brugerens svar i <ny_besked>.

Teksten fra brugeren kommer fra talegenkendelse og kan indeholde fejl. Tolk den velvilligt.`;

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["actions", "spoken_reply", "expects_answer"],
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "thread_id", "title", "note", "status", "next_steps"],
        properties: {
          type: { type: "string", enum: ["create_thread", "add_to_thread", "update_thread", "archive_thread"] },
          thread_id: nullable({ type: "string" }),
          title: nullable({ type: "string" }),
          note: nullable({ type: "string" }),
          status: nullable({ type: "string" }),
          next_steps: nullable({ type: "array", items: { type: "string" } }),
        },
      },
    },
    spoken_reply: { type: "string" },
    expects_answer: { type: "boolean" },
  },
};

function describeThreads(threads) {
  const active = threads.filter((t) => !t.archived);
  if (active.length === 0) return "(Ingen tråde endnu.)";
  return active
    .map((t) => {
      const notes = t.notes
        .slice(-3)
        .map((n) => `    - ${n.ts.slice(0, 10)}: ${n.text}`)
        .join("\n");
      const steps = t.nextSteps.length ? t.nextSteps.map((s) => `    - ${s}`).join("\n") : "    (ingen)";
      return `[id: ${t.id}] ${t.title}\n  Status: ${t.status}\n  Næste skridt:\n${steps}\n  Seneste noter:\n${notes || "    (ingen)"}`;
    })
    .join("\n\n");
}

function describeDialog(dialog) {
  if (dialog.length === 0) return "";
  const lines = dialog.map((d) => `${d.who === "user" ? "Bruger" : "Dig"}: ${d.text}`).join("\n");
  return `\n\n<samtale_indtil_nu>\n${lines}\n</samtale_indtil_nu>`;
}

export async function askAssistant({ apiKey, model, threads, dialog, utterance }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const now = new Date().toLocaleString("da-DK", { dateStyle: "full", timeStyle: "short" });

  const content =
    `Tidspunkt nu: ${now}\n\n<tråde>\n${describeThreads(threads)}\n</tråde>` +
    describeDialog(dialog) +
    `\n\n<ny_besked>\n${utterance}\n</ny_besked>`;

  const response = await client.beta.messages.create({
    model,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: RESPONSE_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Assistenten afviste beskeden.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Svaret blev for langt og blev afbrudt.");
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Tomt svar fra assistenten.");
  return JSON.parse(text);
}

export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "API-nøglen virker ikke. Tjek den under Indstillinger.";
  if (err instanceof Anthropic.PermissionDeniedError) return "API-nøglen har ikke adgang. Tjek din konto hos Anthropic.";
  if (err instanceof Anthropic.RateLimitError) return "For mange forespørgsler lige nu. Prøv igen om lidt.";
  if (err instanceof Anthropic.BadRequestError) return `Fejl i forespørgslen: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Ingen forbindelse til internettet.";
  if (err instanceof Anthropic.APIError) return `Serverfejl (${err.status}). Prøv igen.`;
  return err?.message || "Ukendt fejl.";
}
