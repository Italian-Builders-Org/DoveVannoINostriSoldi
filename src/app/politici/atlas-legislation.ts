import type { RepublicActSummary, RepublicActVote, RepublicLegislativeSource } from "@/lib/politici-repubblica";
import { requestDeadline } from "@/app/politici/atlas-data";
import { isSafeExternalUrl, normalizeSearch } from "@/app/politici/atlas-model";

export type LegislativeData = {
  personId: string;
  source: RepublicLegislativeSource;
  firstSigned: RepublicActSummary[];
  coSigned: RepublicActSummary[];
};

export const OWN_VOTE_LABELS: Record<RepublicActVote, string> = {
  F: "Favorevole",
  C: "Contrario",
  A: "Astenuto/a",
  N: "Non ha votato",
  V: "Voto segreto",
  P: "Presente non votante",
  M: "In congedo o missione",
  "non-rilevato": "Voto non rilevato nella fonte",
};
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const nullableText = (v: unknown) => v === null || text(v);
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const invalid = (): never => { throw new Error("Risposta degli atti non valida"); };

function validAct(value: unknown, role: RepublicActSummary["role"]): boolean {
  return object(value) && ["id", "number", "natureId"].every((key) => text(value[key]))
    && ["title", "presentedDate", "currentState", "currentStateDate", "outcomeClass"].every((key) => nullableText(value[key]))
    && value.role === role && count(value.coSignerCount) && isSafeExternalUrl(value.officialPage)
    && Array.isArray(value.finalVotes) && value.finalVotes.every((vote) => object(vote)
      && text(vote.id) && text(vote.date) && typeof vote.approved === "boolean" && typeof vote.confidenceVote === "boolean"
      && ["favorevoli", "contrari", "astenuti"].every((key) => count(vote[key]))
      && text(vote.ownVote) && Object.hasOwn(OWN_VOTE_LABELS, vote.ownVote));
}

export function parseLegislation(payload: unknown, personId: string): LegislativeData {
  if (!object(payload) || payload.ok !== true || payload.personId !== personId || !object(payload.source)) return invalid();
  const source = payload.source;
  if ((source.chamber !== "camera" && source.chamber !== "senato")
    || !["periodLabel", "observedDate", "sourceLabel", "licenseLabel"].every((key) => text(source[key]))
    || !isSafeExternalUrl(source.sourceUrl) || !Array.isArray(source.caveats) || !source.caveats.every(text)
    || !Array.isArray(source.outcomeClasses) || !source.outcomeClasses.every((item) => object(item) && text(item.id) && text(item.label))
    || !Array.isArray(payload.firstSigned) || !payload.firstSigned.every((act) => validAct(act, "primo-firmatario"))
    || !Array.isArray(payload.coSigned) || !payload.coSigned.every((act) => validAct(act, "cofirmatario"))) return invalid();
  const all = [...payload.firstSigned, ...payload.coSigned] as RepublicActSummary[];
  if (new Set(all.map((act) => act.id)).size !== all.length) return invalid();
  return { personId, source, firstSigned: payload.firstSigned, coSigned: payload.coSigned } as LegislativeData;
}

export function filterActs(acts: RepublicActSummary[], query: string, outcome: string): RepublicActSummary[] {
  const needle = normalizeSearch(query.trim());
  return acts.filter((act) => (!outcome || act.outcomeClass === outcome)
    && (!needle || normalizeSearch(`${act.number} ${act.title ?? ""}`).includes(needle)));
}

export async function loadLegislation(personId: string, signal: AbortSignal): Promise<LegislativeData> {
  if (!/^(?:dep-\d+|sen-s\d+)$/u.test(personId)) {
    throw new Error("Atti legislativi disponibili solo per deputati e senatori del perimetro pubblicato");
  }
  const deadline = requestDeadline(signal, 15_000);
  try {
    deadline.signal.throwIfAborted();
    const response = await fetch(`/api/politici/${encodeURIComponent(personId)}/atti`, {
      signal: deadline.signal, headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Atti non disponibili (HTTP ${response.status})`);
    return parseLegislation(await response.json(), personId);
  } finally { deadline.dispose(); }
}
