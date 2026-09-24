import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  __testOnly_cameraGroupAt,
  __testOnly_senatoGroupAt,
} = await import("../src/lib/politici-voti-tema.ts");
const { countRepublicVoteStates } = await import("../src/lib/politici-vote-states.ts");

const graph = getRepubblicaGraph();
const deputyId = graph.people.find((person) => person.chamberId === "camera").id;
const senatorId = graph.people.find((person) => person.chamberId === "senato").id;
const nonParliamentarianId = graph.people.find((person) => person.chamberId === null).id;
const meloniId = "dep-302103";

test("public theme history keeps each chamber's verified date and coverage", async () => {
  const response = await getThemeHistory(new Request("http://localhost/api/politici/voti-tema?tema=lavoro"));
  assert.equal(response.status, 200);
  const body = await response.json();
  for (const chamber of ["camera", "senato"]) {
    const snapshot = JSON.parse(readFileSync(new URL(`../src/data/generated/${chamber}-atti-voti-xix.json`, import.meta.url)));
    assert.equal(body.coverage[chamber].periodLabel, snapshot.period.label);
    assert.equal(body.coverage[chamber].observedDate, snapshot.period.observedDate);
    assert.equal(body.coverage[chamber].acquiredAt, snapshot.provenance.acquiredAt);
    assert.equal(body.coverage[chamber].included, snapshot.coverage.finalVotes);
    assert.equal(body.coverage[chamber].excluded, chamber === "camera"
      ? snapshot.coverage.finalVotesExcluded : snapshot.coverage.finalVotesOnOtherActs);
  }
});

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
  assert.equal(lavoro.summary.totale, lavoro.votes.length);
  assert.equal(countRepublicVoteStates(lavoro.summary), lavoro.summary.totale);
  assert.equal(lavoro.summary.fuoriMandato, null);
  assert.equal(Object.hasOwn(lavoro.summary, "nonVotato"), false);
  assert.equal(Object.hasOwn(lavoro.summary, "altro"), false);
  assert.ok(Array.isArray(lavoro.years));
  assert.ok(lavoro.years.every((year) => countRepublicVoteStates(year) === year.events));
  assert.ok(lavoro.votes.every((vote) => vote.actTitle.length > 0 && vote.date.length === 10));
  assert.ok(lavoro.votes.every((vote) => vote.matchedNeedles.length > 0));
});

test("Meloni chip counts are expressed votes, not chamber inventory alone", () => {
  const lavoro = getRepubblicaThemeVotes({ personId: meloniId, themeId: "lavoro" });
  assert.ok(lavoro);
  const chip = lavoro.themes.find((theme) => theme.id === "lavoro");
  assert.ok(chip.chamberVotes >= 1);
  assert.equal(chip.expressedVotes, 0);
  assert.equal(lavoro.summary.mancatePartecipazioni, lavoro.summary.totale);
  assert.equal(lavoro.summary.datiNonRilevati, 0);
  assert.ok(lavoro.years.every((year) => year.mancatePartecipazioni === year.events));
});

test("Senate presence, mission and missing data remain separate in summaries and event trails", () => {
  const castellone = getRepubblicaThemeVotes({ personId: "sen-s32600", themeId: "europa" });
  assert.ok(castellone.summary.presenzeSenzaVoto >= 1);
  assert.ok(castellone.summary.datiNonRilevati >= 1);
  assert.equal(countRepublicVoteStates(castellone.summary), castellone.summary.totale);

  const salvini = getRepubblicaThemeVotes({ personId: "sen-s25407", themeId: "lavoro" });
  assert.ok(salvini.summary.missioniOCongedi >= 1);
  assert.ok(salvini.summary.totale >= 1);

  const laRussa = getRepubblicaThemeVotes({ personId: "sen-s1275", themeId: "lavoro" });
  assert.ok(laRussa.summary.datiNonRilevati >= 1);
  assert.equal(countRepublicVoteStates(laRussa.summary), laRussa.summary.totale);

  const europaHistory = getThemeVoteHistory({
    themeId: "europa",
    personQuery: "castellone",
    chamber: "senato",
    expressedOnly: false,
  });
  const castelloneHistory = europaHistory.members.find((member) => member.personId === "sen-s32600");
  assert.equal(castelloneHistory.otherVotes["19-40-29"], "P");

  const lavoroHistory = getThemeVoteHistory({
    themeId: "lavoro",
    personQuery: "salvini",
    chamber: "senato",
    expressedOnly: false,
  });
  const salviniHistory = lavoroHistory.members.find((member) => member.personId === "sen-s25407");
  assert.equal(salviniHistory.otherVotes["19-40-18"], "M");
});

test("free-text theme search finds equo compenso votes for a deputy", () => {
  const result = getRepubblicaThemeVotes({ personId: deputyId, query: "equo compenso" });
  assert.ok(result.summary.totale >= 1);
  assert.ok(result.votes.every((vote) => /equo compenso/i.test(vote.actTitle)));
});

test("title refine within a theme ANDs the query instead of widening the theme", () => {
  const themeOnly = getThemeVoteHistory({ themeId: "sicurezza" });
  assert.ok(themeOnly.events.length >= 2);
  const refined = getThemeVoteHistory({ themeId: "sicurezza", query: "divertimento" });
  assert.ok(refined.events.length >= 1);
  assert.ok(refined.events.length < themeOnly.events.length);
  assert.ok(refined.events.every((event) => /divertimento/i.test(event.actTitle)));
  assert.ok(refined.events.every((event) => /sicurezza/i.test(event.actTitle)));
  const personRefined = getRepubblicaThemeVotes({
    personId: deputyId,
    themeId: "sicurezza",
    query: "divertimento",
  });
  assert.ok(personRefined.votes.every((vote) => /divertimento/i.test(vote.actTitle)));
});

test("Senato official pages use the live scheda-ddl idFase, not the retired Ddliter idDdl path", () => {
  const history = getThemeVoteHistory({ themeId: "sicurezza", query: "divertimento" });
  const divertimento = history.events.find((event) => event.actNumber === "S.282");
  assert.ok(divertimento);
  assert.equal(
    divertimento.officialPage,
    "https://www.senato.it/leggi-e-documenti/disegni-di-legge/scheda-ddl?did=55943",
  );
  assert.ok(!/BGT\/Schede\/Ddliter/i.test(divertimento.officialPage));
  const lavoro = getThemeVoteHistory({ themeId: "lavoro", chamber: "senato" });
  assert.ok(lavoro.events.length >= 1);
  assert.ok(lavoro.events.every((event) => (
    event.chamber !== "senato"
    || /^https:\/\/www\.senato\.it\/leggi-e-documenti\/disegni-di-legge\/scheda-ddl\?did=\d+$/u.test(event.officialPage)
  )));
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

  const cameraEvents = history.events.filter((event) => event.chamber === "camera");
  assert.ok(cameraEvents.length >= 1);
  assert.ok(history.events.every((event) => Array.isArray(event.groupVotes)));
  assert.ok(history.events.every((event) => event.groupVotes.every((group) => (
    Number.isInteger(group.favorevoli)
    && Number.isInteger(group.contrari)
    && Number.isInteger(group.astenuti)
    && !Object.hasOwn(group, "unanimous")
  ))));
  assert.ok(history.events.every((event) => {
    const totals = event.groupVotes.reduce((result, group) => ({
      favorevoli: result.favorevoli + group.favorevoli,
      contrari: result.contrari + group.contrari,
      astenuti: result.astenuti + group.astenuti,
    }), { favorevoli: 0, contrari: 0, astenuti: 0 });
    return totals.favorevoli === event.favorevoli
      && totals.contrari === event.contrari
      && totals.astenuti === event.astenuti;
  }));
  assert.equal(__testOnly_cameraGroupAt("300480", "2023-11-19"), "gr4135");
  assert.equal(__testOnly_cameraGroupAt("300480", "2023-11-20"), "gr4211");
  assert.equal(__testOnly_cameraGroupAt("300480", "2022-10-17"), null);

  const voterAt = (voteId, personId) => {
    const event = history.events.find((item) => item.voteId === voteId);
    return [...event.voters.favorevoli, ...event.voters.contrari, ...event.voters.astenuti]
      .find((voter) => voter.personId === personId);
  };
  assert.equal(voterAt("vs19_192_032", "dep-300480").groupLabel, "Az");
  assert.equal(voterAt("vs19_214_001", "dep-300480").groupLabel, "IV");

  const cameraOnly = getThemeVoteHistory({ themeId: "lavoro", chamber: "camera" });
  assert.ok(cameraOnly.members.every((member) => member.chamber === "camera"));
  assert.ok(cameraOnly.events.every((event) => event.chamber === "camera"));

  const withAbsents = getThemeVoteHistory({ themeId: "lavoro", expressedOnly: false, chamber: "camera" });
  assert.ok(withAbsents.members.length >= cameraOnly.members.length);

  const byName = getThemeVoteHistory({ themeId: "lavoro", personQuery: "giorgia meloni", expressedOnly: false });
  const meloni = byName.members.find((member) => member.personId === meloniId);
  assert.ok(meloni && meloni.expressedVotes === 0);
  assert.equal(meloni.summary.mancatePartecipazioni, meloni.summary.totale);
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
  assert.ok(body.events.every((event) => Array.isArray(event.groupVotes)));
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

test("Senate vote history attributes members and distributions to their group on the vote date", () => {
  assert.equal(__testOnly_senatoGroupAt("29293", "2023-04-25"), "g49");
  assert.equal(__testOnly_senatoGroupAt("29293", "2023-04-26"), "g91");
  assert.equal(__testOnly_senatoGroupAt("29293", "2022-10-17"), null);
  const history = getThemeVoteHistory({ themeId: "sicurezza", chamber: "senato" });
  const event = (id) => history.events.find((item) => item.voteId === id);
  const groupOf = (id, personId) => {
    const voters = event(id).voters;
    return [...voters.favorevoli, ...voters.contrari, ...voters.astenuti]
      .find((voter) => voter.personId === personId)?.groupLabel;
  };

  assert.equal(groupOf("19-40-18", "sen-s29293"), "PD-IDP");
  assert.equal(groupOf("19-86-14", "sen-s29293"), "Az-IV-RE");
  assert.equal(history.senatoGroupSourceUrl, "https://dati.senato.it/sparql");
  const vote = event("19-86-14");
  assert.ok(vote.groupVotes.some((group) => group.groupLabel === "Azione-ItaliaViva-RenewEurope"));
});

test("a final vote linked from multiple acts is counted and rendered once", () => {
  const history = getThemeVoteHistory({ themeId: "sicurezza", chamber: "senato" });
  const event = history.events.find((item) => item.voteId === "19-81-9");
  assert.deepEqual(event.linkedActs.map((act) => act.number), ["S.344", "S.538"]);
  const voters = [...event.voters.favorevoli, ...event.voters.contrari, ...event.voters.astenuti];
  assert.equal(new Set(voters.map((voter) => voter.personId)).size, voters.length);
  assert.ok(history.members.every((member) => member.summary.totale === history.events.length));
});
