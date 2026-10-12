import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  addDays, changeDates, clampTimelineDate, compositionAt, currentRoleStarted, groupAt, groupCountsAt, groupNameAt,
  parseGroupTimeline, sharedTimelineRange, timelineChangeDates,
} = await import("../src/lib/politici-group-timeline.ts");
const { getRepubblicaGraph, getRepubblicaGroupTimeline, getRepubblicaMap } = await import("../src/lib/politici-repubblica.ts");
const { GET } = await import("../src/app/api/politici/gruppi-nel-tempo/route.ts");
const { readAtlasState, atlasUrl, atDate } = await import("../src/app/politici/atlas-model.ts");

// Segments use an exclusive `until`: Camera end dates as published, Senato end dates plus one day.
const fixture = {
  chamber: "senato",
  firstDate: "2022-10-18",
  lastDate: "2024-01-31",
  groups: [
    { id: "senato-a", family: "fam-a", names: [{ label: "Gruppo A", shortLabel: "A", start: "2022-10-13", until: "2023-03-01" }, { label: "Gruppo A rinominato", shortLabel: "A2", start: "2023-03-01", until: null }] },
    { id: "senato-misto", family: "misto", names: [{ label: "Misto", shortLabel: "Misto", start: "2022-10-13", until: null }] },
  ],
  members: [
    { personId: "sen-s1", segments: [{ groupId: "senato-a", start: "2022-10-18", until: "2023-11-22" }, { groupId: "senato-misto", start: "2023-11-22", until: null }] },
    { personId: "sen-s2", segments: [{ groupId: "senato-misto", start: "2023-06-01", until: null }] },
  ],
  former: [{ groupId: "senato-a", start: "2022-10-18", until: "2023-05-01" }],
};
// Government appointments carry only the start of each person's current role.
const government = { members: [{ personId: "gov-1", since: "2022-10-21" }, { personId: "sen-s1", since: "2023-09-01" }] };
const document = (senato = fixture, camera = { ...fixture, chamber: "camera" }, gov = government) => ({ camera, senato, government: gov });

test("groupAt treats `until` as exclusive and dates before the first adhesion as out of office (#556)", () => {
  const [first, second] = fixture.members;
  assert.equal(groupAt(first.segments, "2022-10-17"), null);
  assert.equal(groupAt(first.segments, "2022-10-18"), "senato-a");
  assert.equal(groupAt(first.segments, "2023-11-21"), "senato-a");
  assert.equal(groupAt(first.segments, "2023-11-22"), "senato-misto");
  assert.equal(groupAt(second.segments, "2023-05-31"), null, "a successor is not in office before taking the seat");
  assert.equal(groupAt(second.segments, "2024-01-31"), "senato-misto");
});

test("compositionAt counts former members in the group totals without giving them a seat (#556)", () => {
  const early = compositionAt(fixture, "2023-01-10");
  assert.deepEqual(Object.fromEntries(early.byPerson), { "sen-s1": "senato-a", "sen-s2": null });
  assert.deepEqual(Object.fromEntries(early.counts), { "senato-a": 2 });
  assert.equal(early.formerInOffice, 1);
  const late = compositionAt(fixture, "2024-01-31");
  assert.deepEqual(Object.fromEntries(late.counts), { "senato-misto": 2 });
  assert.equal(late.formerInOffice, 0);
});

test("group names follow the official name in force on the chosen day (#556)", () => {
  assert.equal(groupNameAt(fixture.groups[0], "2023-02-28").shortLabel, "A");
  assert.equal(groupNameAt(fixture.groups[0], "2023-03-01").shortLabel, "A2");
  assert.equal(groupNameAt(fixture.groups[0], "2022-01-01"), null);
});

test("change dates are the days the composition moves, inside the published range (#556)", () => {
  assert.deepEqual(changeDates(fixture), ["2022-10-18", "2023-05-01", "2023-06-01", "2023-11-22"]);
});

test("group counts on a day follow the official names then in force, former members included (#556)", () => {
  assert.deepEqual(groupCountsAt(fixture, "2023-01-10"), [{ groupId: "senato-a", family: "fam-a", label: "A", count: 2 }]);
  assert.deepEqual(groupCountsAt(fixture, "2023-06-15"), [
    { groupId: "senato-a", family: "fam-a", label: "A2", count: 1 },
    { groupId: "senato-misto", family: "misto", label: "Misto", count: 1 },
  ]);
  assert.deepEqual(groupCountsAt(fixture, "2022-10-17"), [], "nobody had joined a group yet");
});

test("the Grafo moves both chambers and the Government on one shared range (#556)", () => {
  const timeline = document(fixture, { ...fixture, chamber: "camera", firstDate: "2022-10-19", lastDate: "2024-02-15" });
  assert.deepEqual(sharedTimelineRange(timeline), { firstDate: "2022-10-19", lastDate: "2024-01-31" }, "only days both chambers publish");
  assert.deepEqual(timelineChangeDates(timeline), ["2022-10-21", "2023-05-01", "2023-06-01", "2023-09-01", "2023-11-22"]);
});

test("a current government role starts on its published day; earlier roles are not in the source (#556)", () => {
  assert.equal(currentRoleStarted(government, "gov-1", "2022-10-20"), false);
  assert.equal(currentRoleStarted(government, "gov-1", "2022-10-21"), true);
  assert.equal(currentRoleStarted(government, "sen-s1", "2023-08-31"), false);
  assert.equal(currentRoleStarted(government, "dep-9", "2022-10-18"), null, "not a government member");
});

test("dates are validated, clamped to the range and moved in UTC days (#556)", () => {
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2024-03-01", -1), "2024-02-29");
  assert.equal(clampTimelineDate(fixture, "2021-01-01"), "2022-10-18");
  assert.equal(clampTimelineDate(fixture, "2030-01-01"), "2024-01-31");
  assert.equal(clampTimelineDate(fixture, "2023-02-30"), null);
  assert.equal(clampTimelineDate(fixture, "ieri"), null);
});

test("the parser refuses an overlapping, unknown or unordered timeline instead of drawing it (#556)", () => {
  assert.doesNotThrow(() => parseGroupTimeline(document()));
  const overlapping = structuredClone(fixture);
  overlapping.members[0].segments[1].start = "2023-11-01";
  assert.throws(() => parseGroupTimeline(document(overlapping)), /sovrappost/);
  const unknown = structuredClone(fixture);
  unknown.former[0].groupId = "senato-x";
  assert.throws(() => parseGroupTimeline(document(unknown)), /gruppo sconosciuto/);
  assert.throws(() => parseGroupTimeline({ camera: fixture }), /Risposta/);
  assert.throws(() => parseGroupTimeline({ camera: { ...fixture, chamber: "camera" }, senato: fixture }), /governo/, "a document without appointments is not drawn");
  assert.throws(() => parseGroupTimeline(document(fixture, undefined, { members: [{ personId: "gov-1", since: "2022-02-30" }] })), /incarico di governo/);
  assert.throws(() => parseGroupTimeline(document(fixture, undefined, { members: [government.members[0], government.members[0]] })), /incarico di governo/);
});

test("committed snapshots: the composition on the observation date is today's map (#556)", () => {
  const timeline = getRepubblicaGroupTimeline();
  const map = getRepubblicaMap();
  parseGroupTimeline(timeline);
  for (const chamber of ["camera", "senato"]) {
    const series = timeline[chamber];
    const people = map.people.filter((person) => person.chamberId === chamber);
    assert.equal(series.firstDate, "2022-10-18");
    assert.deepEqual(new Set(series.members.map((member) => member.personId)), new Set(people.map((person) => person.id)));
    const today = compositionAt(series, series.lastDate);
    for (const person of people) assert.equal(today.byPerson.get(person.id), person.groupId, person.id);
    for (const group of map.groups.filter((item) => item.chamberId === chamber)) {
      assert.equal(today.counts.get(group.id) ?? 0, group.memberCount, group.id);
      assert.ok(groupNameAt(series.groups.find((item) => item.id === group.id), series.lastDate), group.id);
    }
    assert.equal(today.formerInOffice, 0, "nobody out of office is counted on the observation date");
    // Every group ever joined still has an official family: no invented colour.
    for (const item of series.groups) assert.ok(map.groups.some((group) => group.id === item.id && group.partyFamily === item.family));
  }
  assert.ok(timeline.camera.former.length > 0 && timeline.senato.former.length > 0);
  // Government: one entry per member, the earliest current appointment, all in force on the last shared day.
  const members = map.people.filter((person) => person.government);
  assert.deepEqual(new Set(timeline.government.members.map((member) => member.personId)), new Set(members.map((person) => person.id)));
  const { firstDate, lastDate } = sharedTimelineRange(timeline);
  for (const member of timeline.government.members) {
    assert.ok(member.since <= lastDate, member.personId);
    assert.equal(currentRoleStarted(timeline.government, member.personId, lastDate), true, member.personId);
  }
  const graph = getRepubblicaGraph();
  for (const member of timeline.government.members) {
    const since = graph.people.find((person) => person.id === member.personId).roles
      .filter((role) => role.institutionId === "governo").map((role) => role.since).sort()[0];
    assert.equal(member.since, since, member.personId);
  }
  assert.ok(timeline.government.members.some((member) => member.since > firstDate), "some current roles began after the first day");
  // First day of the groups: every sitting member then had a group, and names exist for every group in use.
  for (const chamber of ["camera", "senato"]) {
    const series = timeline[chamber];
    for (const date of changeDates(series)) {
      for (const groupId of compositionAt(series, date).counts.keys()) {
        assert.ok(groupNameAt(series.groups.find((item) => item.id === groupId), date), `${chamber} ${groupId} ${date}`);
      }
    }
  }
});

test("the timeline endpoint is one static, cacheable document (#556)", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /public/);
  const body = await response.json();
  assert.deepEqual(parseGroupTimeline(body), parseGroupTimeline(getRepubblicaGroupTimeline()));
});

test("the chosen date is shareable in the URL only where a view shows it (#556)", () => {
  const map = getRepubblicaMap();
  const read = (query) => readAtlasState(new URLSearchParams(query), map).state;
  assert.equal(read("vista=camera&al=2023-11-22").asOf, "2023-11-22");
  assert.equal(read("vista=senato&al=2023-02-30").asOf, null);
  assert.equal(read("vista=senato&al=2023-13-45").asOf, null, "an impossible month is ignored, not thrown");
  assert.equal(read("vista=grafo&al=2023-11-22").asOf, "2023-11-22");
  assert.equal(read("vista=governo&al=2023-11-22").asOf, null);
  assert.equal(read("vista=camera").asOf, null);
  const url = atlasUrl("https://example.test/politici?utm=x", read("vista=camera&al=2023-11-22"));
  assert.match(url, /al=2023-11-22/);
  assert.match(url, /utm=x/);
  assert.doesNotMatch(atlasUrl("https://example.test/politici", { ...read("vista=camera&al=2023-11-22"), scope: "governo", selection: { kind: "institution", id: "governo" } }), /al=/);
});

test("the chosen day reads as Italian, eliding before 8 and 11 (#556)", () => {
  assert.equal(atDate("2024-06-01"), "al 1 giugno 2024");
  assert.equal(atDate("2023-03-08"), "all'8 marzo 2023");
  assert.equal(atDate("2023-11-11"), "all'11 novembre 2023");
});
