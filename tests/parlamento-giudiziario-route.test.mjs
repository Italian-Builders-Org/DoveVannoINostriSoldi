import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/politici/giudiziario/route.ts");
const { graphPersonId } = await import("../src/lib/parlamento-giudiziario.ts");

test("the judicial route answers with cases keyed by the id the map uses", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");

  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.dataset, "parlamento-giudiziario-xix");
  assert.ok(payload.caveats.length > 0, "la risposta deve dichiarare i limiti");
  assert.match(payload.coverageNote, /non ne ha trovati/u);

  const ids = Object.keys(payload.byPerson);
  assert.ok(ids.length > 0);
  for (const id of ids) {
    assert.match(id, /^(dep-\d+|sen-s\d+)$/u, `id fuori formato: ${id}`);
  }
});

test("every case carries its sources and the stage the proceeding reached", async () => {
  const payload = await (await GET()).json();
  for (const cases of Object.values(payload.byPerson)) {
    for (const item of cases) {
      assert.ok(item.sources.length > 0, `${item.caseId} senza fonti`);
      assert.ok(item.events.length > 0, `${item.caseId} senza gradi di giudizio`);
      assert.ok(item.statusLabel.length > 0);
      assert.match(item.statusAsOf, /^\d{4}/u);
      const hasOfficialAct = item.sources.some((source) => source.kind === "primary");
      const publishers = new Set(item.sources.map((source) => source.publisher.toLowerCase()));
      assert.ok(hasOfficialAct || publishers.size >= 2, `${item.caseId} sotto lo standard di evidenza`);
    }
  }
});

test("the route never exposes a case as an established finding without a definitive ruling", async () => {
  const payload = await (await GET()).json();
  const findings = Object.values(payload.byPerson)
    .flat()
    .filter((item) => item.evidenceLabel === "official-finding");
  for (const item of findings) {
    assert.ok(
      ["condanna_definitiva", "contabile_definitiva"].includes(item.status),
      `${item.caseId} etichettato come accertamento senza condanna definitiva`,
    );
  }
});

test("graph ids map back to the chamber ids without collisions", () => {
  assert.equal(graphPersonId("d307394_19"), "dep-307394");
  assert.equal(graphPersonId("s32"), "sen-s32");
  assert.equal(graphPersonId("qualcosa"), null);
});
