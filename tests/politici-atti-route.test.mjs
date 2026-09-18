import assert from "node:assert/strict";
import test from "node:test";
import attiVotiJson from "../src/data/generated/camera-atti-voti-xix.json" with { type: "json" };
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/politici/[id]/atti/route.ts");
const { getRepubblicaGraph } = await import("../src/lib/politici-repubblica.ts");

const signerNumericId = attiVotiJson.acts[0].firstSignerId.replace(/^d/, "").replace(/_19$/, "");
const deputyId = `dep-${signerNumericId}`;
const senatorId = getRepubblicaGraph().people.find(
  (person) => person.chamberId === "senato",
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
    assert.match(act.id, /^ac19_\d+(?:-[A-Za-z]+)?$/);
    for (const vote of act.finalVotes) assert.ok(voteCodes.has(vote.ownVote), vote.id);
  }
});

test("politici atti returns 404 for unknown ids and non-deputies", async () => {
  const unknown = await GET(
    new Request("http://localhost/api/politici/unknown/atti"),
    { params: Promise.resolve({ id: "unknown" }) },
  );
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get("cache-control"), "no-store");
  assert.equal((await unknown.json()).ok, false);

  const senator = await GET(
    new Request(`http://localhost/api/politici/${senatorId}/atti`),
    { params: Promise.resolve({ id: senatorId }) },
  );
  assert.equal(senator.status, 404);
  assert.equal((await senator.json()).ok, false);
});
