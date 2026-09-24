import type { RepublicActSummary, RepublicLegislativeSource } from "@/lib/politici-repubblica";
import { OWN_VOTE_LABELS } from "@/lib/politici-vote-states";
import { count, object, requestDeadline, text } from "@/app/politici/atlas-data";
import { isSafeExternalUrl, normalizeSearch } from "@/app/politici/atlas-model";

export type LegislativeData = {
  personId: string;
  source: RepublicLegislativeSource;
  firstSigned: RepublicActSummary[];
  coSigned: RepublicActSummary[];
  voted: RepublicActSummary[];
};

export { OWN_VOTE_LABELS } from "@/lib/politici-vote-states";
const nullableText = (v: unknown) => v === null || text(v);
const invalid = (): never => { throw new Error("Risposta degli atti non valida"); };

function validAct(
  value: unknown,
  role: RepublicActSummary["role"],
  chamber: RepublicLegislativeSource["chamber"],
): boolean {
  if (!object(value) || !["id", "number", "natureId"].every((key) => text(value[key]))) return false;
  const initiative = value.initiative;
  const proposer = value.proposer;
  const responsibleGovernment = value.responsibleGovernment;
  const proposerMatchesInitiative = object(initiative) && object(proposer) && (
    (initiative.kind === "parliamentary"
      && proposer.kind === (chamber === "camera" ? "deputy" : "senator")
      && text(proposer.id) && responsibleGovernment === null)
    || (initiative.kind === "government" && proposer.kind === "government")
  );
  const attributionMetadata = object(initiative)
    && (initiative.kind === "parliamentary" || initiative.kind === "government")
    && text(initiative.label)
    && object(proposer)
    && proposerMatchesInitiative
    && text(proposer.label)
    && (responsibleGovernment === null || (object(responsibleGovernment)
      && text(responsibleGovernment.label)
      && (chamber === "senato" && initiative.kind === "government"
        ? responsibleGovernment.id === undefined && responsibleGovernment.uri === undefined
        : text(responsibleGovernment.id) && isSafeExternalUrl(responsibleGovernment.uri))));
  return attributionMetadata
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
  if (source.chamber !== "camera" && source.chamber !== "senato") return invalid();
  const chamber = source.chamber;
  const coverage = source.coverage;
  if (!["periodLabel", "observedDate", "sourceLabel", "licenseLabel"].every((key) => text(source[key]))
    || !object(coverage) || !["acts", "finalVotesIncluded", "finalVotesExcluded"].every((key) => count(coverage[key]))
    || !isSafeExternalUrl(source.sourceUrl) || !Array.isArray(source.caveats) || !source.caveats.every(text)
    || !Array.isArray(source.outcomeClasses) || !source.outcomeClasses.every((item) => object(item) && text(item.id) && text(item.label))
    || !Array.isArray(payload.firstSigned) || !payload.firstSigned.every((act) => validAct(act, "primo-firmatario", chamber))
    || !Array.isArray(payload.coSigned) || !payload.coSigned.every((act) => validAct(act, "cofirmatario", chamber))
    || !Array.isArray(payload.voted) || !payload.voted.every((act) => validAct(act, "votante", chamber))) return invalid();
  const all = [...payload.firstSigned, ...payload.coSigned] as RepublicActSummary[];
  if (new Set(all.map((act) => act.id)).size !== all.length
    || new Set(payload.voted.map((act) => act.id)).size !== payload.voted.length) return invalid();
  return { personId, source, firstSigned: payload.firstSigned, coSigned: payload.coSigned, voted: payload.voted } as LegislativeData;
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
