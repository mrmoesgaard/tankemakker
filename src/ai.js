import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  "claude-opus-5-5": "Claude Opus 5.5 (klogest)",
  "claude-sonnet-5-5": "Claude Sonnet 5.5 (hurtigere og billigere)",
};

const SYSTEM_PROMPT = `Du er "Tankemakker", en personlig assistent der fungerer som brugerens ekstra hukommelse. Brugeren er travl, har mange tråde i gang på én gang og glemmer let ting, hvis de ikke bliver samlet op. Brugeren taler ofte til dig mens de kører bil, så alt du siger bliver læst højt.

Din opgave:
1. Når brugeren fortæller en tanke, idé, opgave eller opdatering, skal du finde ud af hvilken eksisterende tråd den hører til, og lægge den dér. Hvis den tydeligt ikke hører til nogen eksisterende tråd, opretter du en ny tråd med en kort, genkendelig titel (2-4 ord).
2. Hver tråd har en "status": et kort resumé (1-3 sætninger) af hvad tråden handler om og hvor brugeren er nået til. Når du lægger noget nyt i en tråd, skal du skrive en opdateret status, der indarbejder det nye. Statussen skal kunne læses alene, så brugeren aldrig føler de starter forfra.
3. Hver tråd har en "huskeliste": konkrete punkter brugeren vil gøre eller venter på, hver med et flueben (done). Når brugeren beder om en checkliste, skal punkterne på huskelisten. Når brugeren siger at noget er klaret, sætter du done til true. Fjern kun punkter, hvis brugeren beder om det.
4. Påmindelser: Når brugeren beder dig minde dem om noget, opretter du en påmindelse. Den kan udløses på et tidspunkt ("time"), når brugeren kommer hjem ("arrive_home") eller når brugeren tager hjemmefra ("leave_home"). Hvis brugeren siger "når jeg er hjemme" eller lignende, så brug arrive_home. Ved vage tider ("i morgen formiddag", "i aften") vælger du et fornuftigt konkret tidspunkt og nævner det i svaret. Skriv påmindelsesteksten, så den giver mening alene, når den dukker op som en notifikation, f.eks. "Hytten: tjek de 4 punkter på huskelisten".
5. Når brugeren spørger "hvor var jeg?", "hvad har jeg gang i?" eller lignende, svarer du ud fra trådene uden at ændre noget.
6. Hvis du er reelt i tvivl om hvilken tråd noget hører til (f.eks. to tråde passer lige godt), så lav ingen ændringer og stil ét kort spørgsmål, f.eks. "Er det til hytten eller til arbejdsprojektet?". Sæt expects_answer til true. Brugerens svar kommer i næste besked sammen med samtalen indtil nu.
7. Rettelser: Hvis brugeren retter sig selv ("nej vent", "jeg mente", "ikke X men Y", "det var forkert"), så ret det, du lige har gemt, i stedet for at gemme noget nyt: brug replace_last_note på den tråd, og ret status, huskeliste og påmindelser til, hvis de også var forkerte. Hvis noget havnede i den forkerte tråd, så flyt det med move_last_note.

Regler for handlinger (actions). Alle felter skal være med; brug null for dem, der ikke bruges:
- create_thread: thread_id = null. Udfyld title, note, status og checklist.
- add_to_thread: thread_id = den eksisterende tråds id. note = det nye, skrevet kort og klart i brugerens egne ord (ret talegenkendelsesfejl). status = den fulde, opdaterede status. checklist = den fulde, opdaterede huskeliste, eller null hvis den ikke ændres. title = null medmindre titlen bør ændres.
- update_thread: som add_to_thread men uden ny note (note = null), f.eks. når brugeren siger at noget er klaret.
- replace_last_note: thread_id og note = den rettede tekst, der erstatter trådens seneste note. Opdatér også status/checklist, hvis de skal rettes, ellers null.
- move_last_note: thread_id = tråden noten skal flyttes FRA, target_thread_id = tråden den skal flyttes TIL. Udfyld status for måltråden, hvis den skal opdateres.
- archive_thread: når brugeren siger at en tråd er helt afsluttet eller skal slettes. Kun thread_id udfyldes.
- create_reminder: reminder_text, reminder_when og (kun ved "time") reminder_at som lokal tid "ÅÅÅÅ-MM-DDTTT:MM". thread_id = den tråd påmindelsen hører til, eller null.
- delete_reminder: reminder_id = id på påmindelsen, når brugeren aflyser den eller den er klaret.
- En enkelt besked kan indeholde flere tanker til flere tråde. Lav så én handling pr. tråd, plus eventuelle påmindelser.
- Spørgsmål og småsnak giver en tom actions-liste.

Regler for spoken_reply (læses højt i bilen):
- Dansk, kort og naturligt: typisk én til to sætninger. Ingen punktopstillinger, markdown eller emojis.
- Når du har gemt noget: bekræft kort hvor det blev lagt, og nævn gerne i én sætning hvor brugeren var nået til i tråden, hvis det er nyttigt. F.eks. "Lagt under Hytten. Du venter stadig på tilbuddet på taget."
- Når du har oprettet en påmindelse: sig hvornår den kommer, f.eks. "Jeg minder dig om det, når du kommer hjem."
- Når du svarer på "hvor var jeg?": giv et kort mundtligt overblik, de vigtigste ting først.
- expects_answer er true, når du har stillet et spørgsmål og venter på svar, ellers false.

Om <samtale_indtil_nu>: Den viser de seneste replikker i den igangværende samtale og er kun kontekst. Det brugeren sagde dér, er allerede gemt i trådene, så gem det ikke igen. Undtagelsen er, når du selv stillede et opklarende spørgsmål: så skal den tanke, der ventede på svaret, gemmes nu ud fra brugerens svar i <ny_besked>.

Teksten fra brugeren kommer fra talegenkendelse og kan indeholde fejl. Tolk den velvilligt.`;

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });

const ACTION_FIELDS = {
  type: {
    type: "string",
    enum: [
      "create_thread",
      "add_to_thread",
      "update_thread",
      "replace_last_note",
      "move_last_note",
      "archive_thread",
      "create_reminder",
      "delete_reminder",
    ],
  },
  thread_id: nullable({ type: "string" }),
  target_thread_id: nullable({ type: "string" }),
  title: nullable({ type: "string" }),
  note: nullable({ type: "string" }),
  status: nullable({ type: "string" }),
  checklist: nullable({
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["text", "done"],
      properties: { text: { type: "string" }, done: { type: "boolean" } },
    },
  }),
  reminder_text: nullable({ type: "string" }),
  reminder_when: nullable({ type: "string", enum: ["time", "arrive_home", "leave_home"] }),
  reminder_at: nullable({ type: "string" }),
  reminder_id: nullable({ type: "string" }),
};

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
        required: Object.keys(ACTION_FIELDS),
        properties: ACTION_FIELDS,
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
      const items = t.checklist.length
        ? t.checklist.map((c) => `    - [${c.done ? "x" : " "}] ${c.text}`).join("\n")
        : "    (tom)";
      return `[id: ${t.id}] ${t.title}\n  Status: ${t.status}\n  Huskeliste:\n${items}\n  Seneste noter:\n${notes || "    (ingen)"}`;
    })
    .join("\n\n");
}

const WHEN_LABEL = { arrive_home: "når brugeren kommer hjem", leave_home: "når brugeren tager hjemmefra" };

function describeReminders(reminders) {
  const active = reminders.filter((r) => !r.done);
  if (active.length === 0) return "(Ingen aktive påmindelser.)";
  return active
    .map((r) => `[id: ${r.id}] "${r.text}" – ${r.when === "time" ? `kl. ${r.at.replace("T", " ")}` : WHEN_LABEL[r.when]}`)
    .join("\n");
}

function describeDialog(dialog) {
  if (dialog.length === 0) return "";
  const lines = dialog.map((d) => `${d.who === "user" ? "Bruger" : "Dig"}: ${d.text}`).join("\n");
  return `\n\n<samtale_indtil_nu>\n${lines}\n</samtale_indtil_nu>`;
}

function localIsoNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function askAssistant({ apiKey, model, data, homeIsSet, dialog, utterance }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const weekday = new Date().toLocaleDateString("da-DK", { weekday: "long" });

  const content =
    `Tidspunkt nu: ${weekday} ${localIsoNow()}\n` +
    `Brugerens hjemadresse er ${homeIsSet ? "indstillet" : "IKKE indstillet endnu. Opret gerne hjem-påmindelser alligevel, men sig kort at brugeren skal trykke 'Jeg er hjemme nu' under Indstillinger, næste gang de er hjemme"}.\n\n` +
    `<tråde>\n${describeThreads(data.threads)}\n</tråde>\n\n` +
    `<påmindelser>\n${describeReminders(data.reminders)}\n</påmindelser>` +
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
