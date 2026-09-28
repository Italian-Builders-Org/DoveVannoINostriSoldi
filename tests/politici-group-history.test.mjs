import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { formationDates, groupChangeCount, groupHistoryEntries } = await import("../src/lib/politici-group-history.ts");
const { parsePoliticiSenatoSnapshot, senatoGroupSegments } = await import("../src/lib/data/politici-senato-contract.ts");
const { getRepubblicaMap, getRepubblicaProfiles } = await import("../src/lib/politici-repubblica.ts");
const senatoSnapshot = (await import("../src/data/generated/politici-senato-xix.json", { with: { type: "json" } })).default;

const labels = { misto: "Misto", a: "Gruppo A", b: "Gruppo B", nuovo: "Gruppo nuovo" };
const context = (rows) => ({
  mixedGroupId: "misto",
  formationDateByGroup: formationDates(rows),
  labelsDuring: (groupId) => labels[groupId] ? [labels[groupId]] : [],
});
const all = [
  { groupId: "a", startDate: "2022-10-18", endDate: null },
  { groupId: "b", startDate: "2022-10-18", endDate: null },
  { groupId: "misto", startDate: "2022-10-18", endDate: null },
  { groupId: "nuovo", startDate: "2022-10-27", endDate: null },
];

test("joining a new group from the Mixed group on its formation day is not a change (#556)", () => {
  const entries = groupHistoryEntries([
    { groupId: "misto", startDate: "2022-10-18", endDate: "2022-10-27" },
    { groupId: "nuovo", startDate: "2022-10-27", endDate: null },
  ], context(all));
  assert.deepEqual(entries.map((entry) => entry.joinedAtFormation), [false, true]);
  assert.equal(entries[1].label, "Gruppo nuovo");
  assert.equal(groupChangeCount(entries), 0);
});

test("leaving an existing group counts, even for a group formed that day (#556)", () => {
  const split = groupHistoryEntries([
    { groupId: "a", startDate: "2022-10-18", endDate: "2022-10-27" },
    { groupId: "nuovo", startDate: "2022-10-27", endDate: null },
  ], context(all));
  assert.equal(split[1].joinedAtFormation, false);
  assert.equal(groupChangeCount(split), 1);
  const later = groupHistoryEntries([
    { groupId: "misto", startDate: "2022-10-18", endDate: "2023-03-01" },
    { groupId: "nuovo", startDate: "2023-03-01", endDate: "2024-01-10" },
    { groupId: "b", startDate: "2024-01-10", endDate: null },
  ], context(all));
  assert.equal(later[1].joinedAtFormation, false);
  assert.equal(groupChangeCount(later), 2);
});

test("a group without an official name at that date stops the build (#556)", () => {
  assert.throws(() => groupHistoryEntries([{ groupId: "ignoto", startDate: "2022-10-18", endDate: null }], context(all)), /denominazione/u);
});

test("Senato rows of the same group merge; different groups stay apart (#556)", () => {
  assert.deepEqual(senatoGroupSegments([
    { groupId: "g1", startDate: "2023-11-21", endDate: null },
    { groupId: "g1", startDate: "2022-10-18", endDate: "2023-11-20" },
    { groupId: "g1", startDate: "2025-02-25", endDate: null },
  ]), [{ groupId: "g1", startDate: "2022-10-18", endDate: null }]);
  assert.deepEqual(senatoGroupSegments([
    { groupId: "g1", startDate: "2022-10-18", endDate: "2024-02-08" },
    { groupId: "g2", startDate: "2024-02-21", endDate: null },
  ]).map((segment) => segment.groupId), ["g1", "g2"]);
  assert.equal(senatoGroupSegments([
    { groupId: "g1", startDate: "2022-10-18", endDate: "2023-01-01" },
    { groupId: "g1", startDate: "2023-06-01", endDate: null },
  ]).length, 2);
});

test("Senato contract rejects overlapping groups and a current group not in the history (#556)", () => {
  const senator = senatoSnapshot.senators[0];
  const numericId = senator.id.slice(1);
  const otherGroup = senatoSnapshot.groups.find((group) => group.id !== senator.groupId).id;
  const overlap = structuredClone(senatoSnapshot);
  overlap.groupMemberships.push({ senatorId: numericId, groupId: otherGroup, startDate: "2024-01-01", endDate: null });
  assert.throws(() => parsePoliticiSenatoSnapshot(overlap), /sovrapposte|non riconcilia/u);
  const closed = structuredClone(senatoSnapshot);
  for (const row of closed.groupMemberships) if (row.senatorId === numericId && row.endDate === null) row.endDate = "2026-01-01";
  assert.throws(() => parsePoliticiSenatoSnapshot(closed), /gruppo corrente non riconcilia/u);
});

test("committed snapshots: every parliamentarian has a coherent group history (#556)", () => {
  const map = getRepubblicaMap();
  const profiles = getRepubblicaProfiles();
  for (const person of map.people) {
    const history = profiles[person.id].groupHistory;
    if (person.chamberId === null) {
      assert.equal(person.groupChanges, null, person.id);
      assert.equal(history, null, person.id);
      continue;
    }
    assert.equal(history.chamber, person.chamberId, person.id);
    assert.equal(history.changes, person.groupChanges, person.id);
    assert.equal(history.entries.at(-1).endDate, null, person.id);
    assert.ok(history.entries.every((entry, index) => index === 0 || entry.startDate > history.entries[index - 1].startDate), person.id);
    assert.ok(history.changes <= history.entries.length - 1, person.id);
  }
  const changed = (chamber) => map.people.filter((person) => person.chamberId === chamber && person.groupChanges > 0).length;
  assert.ok(changed("camera") > 0 && changed("senato") > 0);
  // Noi Moderati and AVS were formed at the Camera on 27 October 2022 by deputies who sat in the Mixed group until then.
  const formations = Object.values(profiles).flatMap((profile) => profile.groupHistory?.entries ?? [])
    .filter((entry) => entry.joinedAtFormation);
  assert.ok(formations.length > 0);
  assert.ok(formations.every((entry) => entry.startDate === "2022-10-27"));
});
