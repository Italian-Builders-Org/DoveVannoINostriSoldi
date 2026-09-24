import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { getThemeVoteHistory } = await import("../src/lib/politici-voti-tema.ts");
const { compareGroupVoteEvents } = await import("../src/lib/politici-group-patterns.ts");

test("common vote pattern counts only unambiguous choices in one chamber and year", () => {
  const history = getThemeVoteHistory({ themeId: "lavoro" });
  const comparison = compareGroupVoteEvents(history.events, "camera", "gr4133", "gr4111", "2023");

  assert.deepEqual({
    events: comparison.events.length,
    comparable: comparison.comparableEvents,
    common: comparison.commonChoiceEvents,
  }, { events: 11, comparable: 9, common: 6 });
  assert.deepEqual(
    comparison.events.find((event) => event.voteId === "vs19_214_001"),
    { voteId: "vs19_214_001", choiceA: "F", choiceB: "pareggio", agreement: null },
  );
  assert.equal(comparison.events.every((event) => event.voteId.startsWith("vs19_")), true);
});

test("missing and non-expressed group choices cannot become agreements", () => {
  const events = [
    { voteId: "1", chamber: "camera", date: "2023-01-01", groupVotes: [
      { groupId: "a", favorevoli: 2, contrari: 0, astenuti: 0 },
      { groupId: "b", favorevoli: 0, contrari: 0, astenuti: 0 },
    ] },
    { voteId: "2", chamber: "camera", date: "2023-01-02", groupVotes: [
      { groupId: "b", favorevoli: 1, contrari: 0, astenuti: 0 },
    ] },
  ];
  const comparison = compareGroupVoteEvents(events, "camera", "a", "b", "2023");
  assert.equal(comparison.comparableEvents, 0);
  assert.equal(comparison.commonChoiceEvents, 0);
  assert.deepEqual(comparison.events.map(({ choiceA, choiceB, agreement }) => [choiceA, choiceB, agreement]), [
    ["F", "non-determinato", null],
    ["non-determinato", "F", null],
  ]);
});
