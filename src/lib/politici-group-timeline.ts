/**
 * Parliamentary group composition on a chosen day of the XIX (#556), from the
 * dated adhesions of the Camera and Senato snapshots. Pure and client-safe: the
 * server builds the series, the hemicycle reads it.
 *
 * Every segment carries an exclusive `until`: the Camera publishes exclusive end
 * dates, the Senato inclusive ones, so the builder adds a day to the Senato's.
 */

export type TimelineSegment = { groupId: string; start: string; until: string | null; };
export type TimelineGroupName = { label: string; shortLabel: string; start: string; until: string | null; };
export type TimelineGroup = { id: string; family: string; names: TimelineGroupName[]; };
export type ChamberTimeline = {
  chamber: "camera" | "senato";
  /** First published adhesion of the legislature. */
  firstDate: string;
  /** Observation date of the snapshot: the series says nothing after it. */
  lastDate: string;
  groups: TimelineGroup[];
  /** Sitting members, keyed on the map's person ids. */
  members: Array<{ personId: string; segments: TimelineSegment[]; }>;
  /** Adhesions of people no longer in office: counted in the totals, without a seat or a name. */
  former: TimelineSegment[];
};
export type GroupTimeline = { camera: ChamberTimeline; senato: ChamberTimeline; };
export type Composition = {
  /** `null` when the person was not yet (or no longer) in office that day. */
  byPerson: Map<string, string | null>;
  counts: Map<string, number>;
  /** People in office that day who no longer sit today: counted, not drawn. */
  formerInOffice: number;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

/** Days between two ISO dates, for the slider position. */
export function dayIndex(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const covers = (item: { start: string; until: string | null; }, date: string) =>
  item.start <= date && (item.until === null || date < item.until);

export function groupAt(segments: readonly TimelineSegment[], date: string): string | null {
  return segments.find((segment) => covers(segment, date))?.groupId ?? null;
}

export function groupNameAt(group: TimelineGroup | undefined, date: string): TimelineGroupName | null {
  return group?.names.find((name) => covers(name, date)) ?? null;
}

export function compositionAt(timeline: ChamberTimeline, date: string): Composition {
  const byPerson = new Map<string, string | null>();
  const counts = new Map<string, number>();
  const count = (groupId: string) => counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  for (const member of timeline.members) {
    const groupId = groupAt(member.segments, date);
    byPerson.set(member.personId, groupId);
    if (groupId !== null) count(groupId);
  }
  let formerInOffice = 0;
  for (const segment of timeline.former) {
    if (!covers(segment, date)) continue;
    formerInOffice += 1;
    count(segment.groupId);
  }
  return { byPerson, counts, formerInOffice };
}

/** Days on which some adhesion starts or ends: the only days the composition can move. */
export function changeDates(timeline: ChamberTimeline): string[] {
  const dates = new Set<string>();
  for (const segment of [...timeline.members.flatMap((member) => member.segments), ...timeline.former]) {
    dates.add(segment.start);
    if (segment.until !== null) dates.add(segment.until);
  }
  return [...dates].filter((date) => date >= timeline.firstDate && date <= timeline.lastDate).sort();
}

/** A requested day inside the published range; `null` for anything that is not a real date. */
export function clampTimelineDate(timeline: Pick<ChamberTimeline, "firstDate" | "lastDate">, value: string): string | null {
  if (!isIsoDate(value)) return null;
  if (value < timeline.firstDate) return timeline.firstDate;
  if (value > timeline.lastDate) return timeline.lastDate;
  return value;
}

const invalid = (reason: string): never => { throw new Error(`Risposta del servizio non valida: ${reason}`); };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const until = (value: unknown): value is string | null => value === null || isIsoDate(value);

function parseSegments(value: unknown, groups: ReadonlySet<string>, where: string): TimelineSegment[] {
  if (!Array.isArray(value)) return invalid(`adesioni di ${where}`);
  const segments = value.map((segment) => {
    if (!object(segment) || !text(segment.groupId) || !isIsoDate(segment.start) || !until(segment.until)
      || (segment.until !== null && segment.until <= segment.start)) return invalid(`adesione di ${where}`);
    if (!groups.has(segment.groupId)) return invalid(`gruppo sconosciuto ${segment.groupId}`);
    return { groupId: segment.groupId, start: segment.start, until: segment.until };
  });
  return segments;
}

function parseChamber(value: unknown, chamber: "camera" | "senato"): ChamberTimeline {
  if (!object(value) || value.chamber !== chamber || !isIsoDate(value.firstDate) || !isIsoDate(value.lastDate)
    || value.firstDate > value.lastDate || !Array.isArray(value.groups) || !Array.isArray(value.members) || !Array.isArray(value.former)) {
    return invalid(chamber);
  }
  const groups = value.groups.map((group) => {
    if (!object(group) || !text(group.id) || !text(group.family) || !Array.isArray(group.names) || group.names.length === 0) return invalid(`gruppo ${chamber}`);
    const names = group.names.map((name) => {
      if (!object(name) || !text(name.label) || !text(name.shortLabel) || !isIsoDate(name.start) || !until(name.until)) return invalid(`denominazione ${String(group.id)}`);
      return { label: name.label, shortLabel: name.shortLabel, start: name.start, until: name.until };
    });
    return { id: group.id, family: group.family, names };
  });
  const groupIds = new Set(groups.map((group) => group.id));
  if (groupIds.size !== groups.length) return invalid(`gruppi duplicati ${chamber}`);
  const personIds = new Set<string>();
  const members = value.members.map((member) => {
    if (!object(member) || !text(member.personId) || personIds.has(member.personId)) return invalid(`persona ${chamber}`);
    personIds.add(member.personId);
    const segments = parseSegments(member.segments, groupIds, member.personId);
    // One group at a time: the hemicycle colours a seat with a single group.
    for (let index = 1; index < segments.length; index += 1) {
      const previous = segments[index - 1]!;
      if (previous.until === null || segments[index]!.start < previous.until) return invalid(`adesioni sovrapposte per ${member.personId}`);
    }
    return { personId: member.personId, segments };
  });
  return {
    chamber, firstDate: value.firstDate, lastDate: value.lastDate, groups, members,
    former: parseSegments(value.former, groupIds, `ex componenti ${chamber}`),
  };
}

/** Validate the served series; a broken response is never drawn as a composition. */
export function parseGroupTimeline(payload: unknown): GroupTimeline {
  if (!object(payload)) return invalid("documento");
  return { camera: parseChamber(payload.camera, "camera"), senato: parseChamber(payload.senato, "senato") };
}
