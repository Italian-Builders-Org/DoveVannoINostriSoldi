import assert from "node:assert/strict";
import test from "node:test";
import attiVotiJson from "../src/data/generated/camera-atti-voti-xix.json" with { type: "json" };
import senatoAttiVotiJson from "../src/data/generated/senato-atti-voti-xix.json" with { type: "json" };
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/politici/[id]/atti/route.ts");
const { getRepubblicaGraph } = await import("../src/lib/politici-repubblica.ts");

const signerNumericId = attiVotiJson.acts[0].firstSignerId.replace(/^d/, "").replace(/_19$/, "");
const deputyId = `dep-${signerNumericId}`;
const senatorId = `sen-s${senatoAttiVotiJson.acts[0].firstSignerId}`;
const nonParliamentarianId = getRepubblicaGraph().people.find(
  (person) => person.chamberId === null,
).id;

test("politici atti serves the signed acts of a Camera deputy", async () => {
  const response = await GET(
    new Request(`http://localhost/api/politici/${deputyId}/atti`),
    { params: Promise.resolve({ id: deputyId }) },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /s-maxage=86400/);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.personId, deputyId);
  assert.equal(body.legislature.id, "19");
  assert.equal(body.source.chamber, "camera");
  assert.ok(body.source.sourceUrl.startsWith("https://"));
  assert.ok(body.source.sourceLabel.length > 0);
  assert.ok(body.source.licenseLabel.length > 0);
  assert.ok(Array.isArray(body.source.outcomeClasses));
  assert.ok(Array.isArray(body.source.caveats));
  assert.ok(Array.isArray(body.firstSigned));
  assert.ok(Array.isArray(body.coSigned));
  assert.ok(body.firstSigned.length > 0);
  assert.equal(body.firstSigned[0].role, "primo-firmatario");
  const voteCodes = new Set(["F", "C", "A", "N", "V", "non-rilevato"]);
  for (const act of [...body.firstSigned, ...body.coSigned]) {
    assert.equal(act.chamber, "camera");
    assert.match(act.id, /^ac19_\d+(?:-[A-Za-z]+)?$/);
    for (const vote of act.finalVotes) assert.ok(voteCodes.has(vote.ownVote), vote.id);
  }
});

test("politici atti serves the signed acts of a Senato member", async () => {
  const response = await GET(
    new Request(`http://localhost/api/politici/${senatorId}/atti`),
    { params: Promise.resolve({ id: senatorId }) },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /s-maxage=86400/);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.personId, senatorId);
  assert.equal(body.source.chamber, "senato");
  assert.ok(body.source.sourceUrl.startsWith("https://"));
  assert.ok(Array.isArray(body.source.outcomeClasses));
  assert.ok(Array.isArray(body.source.caveats));
  assert.ok(body.firstSigned.length > 0);
  assert.equal(body.firstSigned[0].role, "primo-firmatario");
  const voteCodes = new Set(["F", "C", "A", "P", "M", "non-rilevato"]);
  for (const act of [...body.firstSigned, ...body.coSigned]) {
    assert.equal(act.chamber, "senato");
    assert.match(act.id, /^ddl-\d+$/);
    assert.ok(Array.isArray(act.phases));
    assert.match(act.currentStateRamo, /^[SC]$/);
    for (const vote of act.finalVotes) {
      assert.ok(voteCodes.has(vote.ownVote), vote.id);
      assert.equal(typeof vote.voteType, "string");
    }
  }
});

test("politici atti returns 404 for unknown ids and non-parliamentarians", async () => {
  const unknown = await GET(
    new Request("http://localhost/api/politici/unknown/atti"),
    { params: Promise.resolve({ id: "unknown" }) },
  );
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get("cache-control"), "no-store");
  assert.equal((await unknown.json()).ok, false);

  const nonParliamentarian = await GET(
    new Request(`http://localhost/api/politici/${nonParliamentarianId}/atti`),
    { params: Promise.resolve({ id: nonParliamentarianId }) },
  );
  assert.equal(nonParliamentarian.status, 404);
  assert.equal((await nonParliamentarian.json()).ok, false);
});
