import { z } from "zod";
import { CONTACT_EMAIL } from "@/lib/site";

export const ORGANIZATION_TYPES = {
  azienda: "Azienda",
  pa: "Ente pubblico o PA",
  altro: "Altro",
} as const;

export const CONSULTING_TOPICS = {
  lettura: "Lettura guidata di un ente, un territorio o un progetto",
  dashboard: "Report o cruscotto interno",
  formazione: "Formazione per uffici e team",
  imprese: "Supporto a imprese che lavorano con la PA",
  altro: "Altro",
} as const;

export type OrganizationType = keyof typeof ORGANIZATION_TYPES;
export type ConsultingTopic = keyof typeof CONSULTING_TOPICS;

const MIN_SUBMIT_MS = 4_000;

const leadFields = z.object({
  name: z.string().trim().min(2, "Indica nome e cognome.").max(120),
  email: z.email("Indica un indirizzo email valido.").max(180),
  organization: z.string().trim().min(2, "Indica l'organizzazione o l'ente.").max(180),
  organizationType: z.enum(
    Object.keys(ORGANIZATION_TYPES) as [OrganizationType, ...OrganizationType[]],
    { error: "Scegli il tipo di organizzazione." },
  ),
  role: z.string().trim().max(120).optional(),
  topic: z.enum(
    Object.keys(CONSULTING_TOPICS) as [ConsultingTopic, ...ConsultingTopic[]],
    { error: "Scegli l'argomento della richiesta." },
  ),
  message: z
    .string()
    .trim()
    .min(20, "Descrivi in almeno una frase che cosa ti serve.")
    .max(4000),
  consent: z.literal(true, { error: "Serve il consenso al trattamento dei dati." }),
});

export type Lead = z.infer<typeof leadFields>;

export type LeadParseResult =
  | { status: "valid"; lead: Lead }
  | { status: "invalid"; error: string }
  | { status: "discarded" };

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isFilledHoneypot(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isTooFast(startedAt: unknown, now: number): boolean {
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return true;
  if (startedAt > now) return true;
  return now - startedAt < MIN_SUBMIT_MS;
}

export function parseLead(payload: unknown, now = Date.now()): LeadParseResult {
  const record = asRecord(payload);

  if (isFilledHoneypot(record.website) || isTooFast(record.startedAt, now)) {
    return { status: "discarded" };
  }

  const parsed = leadFields.safeParse({
    name: record.name,
    email: record.email,
    organization: record.organization,
    organizationType: record.organizationType,
    role: record.role === "" ? undefined : record.role,
    topic: record.topic,
    message: record.message,
    consent: record.consent === true || record.consent === "true" || record.consent === "on",
  });

  if (!parsed.success) {
    return { status: "invalid", error: parsed.error.issues[0]?.message ?? "Richiesta non valida" };
  }

  return { status: "valid", lead: parsed.data };
}

export function formatLeadEmail(lead: Lead, receivedAt: Date): string {
  const received = new Intl.DateTimeFormat("it-IT", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(receivedAt);

  const role = lead.role?.trim() ? lead.role : "non indicato";

  return [
    "Nuova richiesta di consulenza da DoveVannoINostriSoldi.",
    "",
    `Ricevuta: ${received}`,
    `Nome: ${lead.name}`,
    `Email: ${lead.email}`,
    `Organizzazione: ${lead.organization}`,
    `Tipo: ${ORGANIZATION_TYPES[lead.organizationType]}`,
    `Ruolo: ${role}`,
    `Argomento: ${CONSULTING_TOPICS[lead.topic]}`,
    "",
    "Messaggio:",
    lead.message,
  ].join("\n");
}

export function leadEmailSubject(lead: Lead): string {
  return `Richiesta consulenza: ${lead.organization}`;
}

export function leadInbox(): string {
  return process.env.LEAD_INBOX_EMAIL?.trim() || CONTACT_EMAIL;
}

export function leadFromAddress(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "DoveVannoINostriSoldi <beth.t@example.com>";
}

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";
