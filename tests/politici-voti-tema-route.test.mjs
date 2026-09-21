import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const { GET: getPersonThemeVotes } = await import("../src/app/api/politici/[id]/voti-tema/route.ts");
const { GET: getThemeHistory } = await import("../src/app/api/politici/voti-tema/route.ts");
const { getRepubblicaGraph } = await import("../src/lib/politici-repubblica.ts");
const {
  getRepubblicaThemeVotes,
  getThemeVoteHistory,
  VOTE_THEMES,
} = await import("../src/lib/politici-voti-tema.ts");

const graph = getRepubblicaGraph();
const deputyId = graph.people.find((person) => person.chamberId === "camera").id;
const senatorId = graph.people.find((person) => person.chamberId === "senato").id;
const nonParliamentarianId = graph.people.find((person) => person.chamberId === null).id;
const meloniId = "dep-302103";

test("atlas known theme ids stay aligned with the vote theme catalog", async () => {
  const { KNOWN_THEME_IDS } = await import("../src/app/politici/atlas-model.ts");
  assert.deepEqual([...KNOWN_THEME_IDS].sort(), VOTE_THEMES.map((theme) => theme.id).sort());
});

test("theme catalog exposes curated themes with person-specific chip stats", () => {
  assert.ok(VOTE_THEMES.length >= 6);
  const lavoro = getRepubblicaThemeVotes({ personId: deputyId, themeId: "lavoro" });
  assert.equal(lavoro.personId, deputyId);
  assert.equal(lavoro.chamber, "camera");
  assert.equal(lavoro.theme.id, "lavoro");
  const chip = lavoro.themes.find((theme) => theme.id === "lavoro");
  assert.ok(chip);
  assert.ok(chip.chamberVotes >= 1);
  assert.equal(chip.chamberVotes, lavoro.summary.totale);
  assert.equal(chip.expressedVotes, lavoro.summary.favorevoli + lavoro.summary.contrari + lavoro.summary.astenuti);
  assert.equal(chip.nonVotato, lavoro.summary.nonVotato);
  assert.equal(lavoro.summary.totale, lavoro.votes.length);
  assert.ok(Array.isArray(lavoro.years));
  assert.ok(lavoro.votes.every((vote) => vote.actTitle.length > 0 && vote.date.length === 10));
  assert.ok(lavoro.votes.every((vote) => vote.matchedNeedles.length > 0));
});

test("Meloni chip counts are expressed votes, not chamber inventory alone", () => {
  const lavoro = getRepubblicaThemeVotes({ personId: meloniId, themeId: "lavoro" });
  assert.ok(lavoro);
  const chip = lavoro.themes.find((theme) => theme.id === "lavoro");
  assert.ok(chip.chamberVotes >= 1);
  assert.equal(chip.expressedVotes, 0);
  assert.equal(chip.nonVotato, chip.chamberVotes);
  assert.equal(lavoro.summary.nonVotato, lavoro.summary.totale);
  assert.ok(lavoro.years.every((year) => year.nonVotato >= 1 || year.events >= 1));
});

test("free-text theme search finds equo compenso votes for a deputy", () => {
  const result = getRepubblicaThemeVotes({ personId: deputyId, query: "equo compenso" });
  assert.ok(result.summary.totale >= 1);
  assert.ok(result.votes.every((vote) => /equo compenso/i.test(vote.actTitle)));
});

test("theme history indexes votes once and supports chamber / expressed filters", () => {
  const history = getThemeVoteHistory({ themeId: "lavoro" });
  assert.ok(history.events.length >= 1);
  assert.ok(history.years.length >= 1);
  assert.ok(history.members.every((member) => member.expressedVotes >= 1));
  assert.ok(history.members.every((member) => Array.isArray(member.years)));
  assert.equal(history.chamber, "tutti");
  assert.equal(history.expressedOnly, true);
  assert.ok(history.events.every((event) => (
    object(event.voters)
    && Array.isArray(event.voters.favorevoli)
    && Array.isArray(event.voters.contrari)
    && Array.isArray(event.voters.astenuti)
  )));
  assert.ok(history.events.some((event) => (
    event.voters.favorevoli.length + event.voters.contrari.length + event.voters.astenuti.length >= 1
  )));
  assert.ok(history.events.some((event) => event.actTitle.length > 0 && event.officialPage.length > 0));

  const cameraOnly = getThemeVoteHistory({ themeId: "lavoro", chamber: "camera" });
  assert.ok(cameraOnly.members.every((member) => member.chamber === "camera"));
  assert.ok(cameraOnly.events.every((event) => event.chamber === "camera"));

  const withAbsents = getThemeVoteHistory({ themeId: "lavoro", expressedOnly: false, chamber: "camera" });
  assert.ok(withAbsents.members.length >= cameraOnly.members.length);

  const byName = getThemeVoteHistory({ themeId: "lavoro", personQuery: "giorgia meloni", expressedOnly: false });
  const meloni = byName.members.find((member) => member.personId === meloniId);
  assert.ok(meloni && meloni.expressedVotes === 0);
  assert.ok(meloni.years.length >= 1);
  assert.ok(byName.events.every((event) => (
    !event.voters.favorevoli.some((voter) => voter.personId === meloniId)
    && !event.voters.contrari.some((voter) => voter.personId === meloniId)
    && !event.voters.astenuti.some((voter) => voter.personId === meloniId)
  )));
});

test("politici voti-tema API serves theme timeline and rejects bad input", async () => {
  const ok = await getPersonThemeVotes(
    new Request(`http://localhost/api/politici/${deputyId}/voti-tema?tema=lavoro`),
    { params: Promise.resolve({ id: deputyId }) },
  );
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("cache-control"), /s-maxage=86400/);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.personId, deputyId);
  assert.equal(body.theme.id, "lavoro");
  assert.ok(body.summary.totale >= 1);
  assert.ok(Array.isArray(body.years));
  assert.ok(body.themes[0].chamberVotes >= 0);
  assert.ok(Array.isArray(body.caveats) && body.caveats.length >= 3);

  const senator = await getPersonThemeVotes(
    new Request(`http://localhost/api/politici/${senatorId}/voti-tema?tema=parita`),
    { params: Promise.resolve({ id: senatorId }) },
  );
  assert.equal(senator.status, 200);
  assert.equal((await senator.json()).chamber, "senato");

  const unknownTheme = await getPersonThemeVotes(
    new Request(`http://localhost/api/politici/${deputyId}/voti-tema?tema=inesistente`),
    { params: Promise.resolve({ id: deputyId }) },
  );
  assert.equal(unknownTheme.status, 400);

  const shortQuery = await getPersonThemeVotes(
    new Request(`http://localhost/api/politici/${deputyId}/voti-tema?q=ab`),
    { params: Promise.resolve({ id: deputyId }) },
  );
  assert.equal(shortQuery.status, 400);

  const missing = await getPersonThemeVotes(
    new Request(`http://localhost/api/politici/${nonParliamentarianId}/voti-tema?tema=lavoro`),
    { params: Promise.resolve({ id: nonParliamentarianId }) },
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");
});

test("politici storico voti-tema API serves directory with ramo/espressi", async () => {
  const ok = await getThemeHistory(
    new Request("http://localhost/api/politici/voti-tema?tema=lavoro&persona=meloni&ramo=camera&espressi=0"),
  );
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.theme.id, "lavoro");
  assert.equal(body.chamber, "camera");
  assert.equal(body.expressedOnly, false);
  assert.ok(body.events.length >= 1);
  assert.ok(body.years.length >= 1);
  assert.ok(body.events.every((event) => object(event.voters)));
  assert.ok(body.members.some((member) => /meloni/i.test(member.name)));

  const missingTheme = await getThemeHistory(
    new Request("http://localhost/api/politici/voti-tema"),
  );
  assert.equal(missingTheme.status, 400);

  const badTheme = await getThemeHistory(
    new Request("http://localhost/api/politici/voti-tema?tema=inesistente"),
  );
  assert.equal(badTheme.status, 400);

  const badRamo = await getThemeHistory(
    new Request("http://localhost/api/politici/voti-tema?tema=lavoro&ramo=europa"),
  );
  assert.equal(badRamo.status, 400);
});
