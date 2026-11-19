import attendanceJson from "@/data/generated/camera-partecipazione-voto.json";
import { parseCameraPartecipazioneVotoSnapshot } from "@/lib/data/camera-partecipazione-voto-contract";
import { getRepubblicaMap, type RepublicMapPerson } from "@/lib/politici-repubblica";
import { parsePresencePercent, sourceGroupOf, type PresenceRow } from "@/lib/politici-presenze-stats";

/**
 * Payload of the atlas "Presenze" view (#871): every row of the Camera's official
 * participation table, already validated by the snapshot contract. No new source:
 * the Senate publishes no equivalent table and is not reconstructed from open votes.
 */
export type PresenceDistribution = {
  chamber: "camera";
  periodLabel: string;
  observedDate: string;
  acquiredAt: string;
  sourceUrl: string;
  sourceLabel: string;
  license: string;
  coverage: { rows: number; matchedDeputies: number; unmatchedRows: number; };
  senateGap: string;
  caveats: string[];
  rows: PresenceRow[];
};

const PRESIDENCY_ROLES = new Set(["capo-stato", "presidente-assemblea", "vicepresidente-assemblea", "questore", "segretario-presidenza"]);

function rolesOf(person: RepublicMapPerson | undefined): string[] {
  if (!person) return [];
  return [
    person.government ? "governo" : null,
    PRESIDENCY_ROLES.has(person.roleKind) ? "presidenza" : null,
    person.groupLeader ? "capigruppo" : null,
  ].filter((role): role is string => role !== null);
}

/** "AIELLO DAVIDE" → "Aiello Davide": only for the few rows without an atlas match. */
function titleCase(value: string): string {
  return value.toLocaleLowerCase("it-IT").replaceAll(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, letter: string) => `${sep}${letter.toLocaleUpperCase("it-IT")}`);
}

let cached: PresenceDistribution | null = null;

export function getPresenceDistribution(): PresenceDistribution {
  if (cached) return cached;
  const snapshot = parseCameraPartecipazioneVotoSnapshot(attendanceJson);
  const people = new Map(getRepubblicaMap().people.map((person) => [person.id, person]));
  const rows = snapshot.deputies.map((row): PresenceRow => {
    const candidate = row.numericId ? `dep-${row.numericId}` : null;
    const person = candidate ? people.get(candidate) : undefined;
    const roles = rolesOf(person);
    return {
      key: row.deputyId ?? `riga:${row.sourceName}`,
      name: person?.name ?? titleCase(row.sourceName),
      personId: person ? person.id : null,
      group: sourceGroupOf(row.groupLabel),
      presence: parsePresencePercent(row.presencePercent),
      votesPercent: parsePresencePercent(row.votesCastPercent),
      missionsPercent: parsePresencePercent(row.missionsPercent),
      absencesPercent: parsePresencePercent(row.absencesPercent),
      roles,
      roleLabel: person && (roles.includes("governo") || roles.includes("presidenza")) ? person.roleLabel : null,
    };
  });
  cached = {
    chamber: "camera",
    periodLabel: snapshot.period.label,
    observedDate: snapshot.period.observedDate,
    acquiredAt: snapshot.source.acquiredAt,
    sourceUrl: snapshot.source.pageUrl,
    sourceLabel: "Camera dei deputati, statistiche di partecipazione al voto",
    license: snapshot.source.license,
    coverage: {
      rows: snapshot.coverage.rows,
      matchedDeputies: snapshot.coverage.matchedDeputies,
      unmatchedRows: snapshot.coverage.unmatchedRows,
    },
    senateGap: snapshot.provenance.gap,
    caveats: snapshot.caveats,
    rows,
  };
  return cached;
}
