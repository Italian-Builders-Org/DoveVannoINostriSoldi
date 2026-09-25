import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { getMunicipalityRealEstate, readCommunication } = await import("../src/lib/municipality-real-estate.ts");

test("a Comune that sent the 2023 communication keeps its own completeness declaration", async () => {
  const roma = await getMunicipalityRealEstate("02438750586");
  assert.equal(roma.status, "available");
  assert.deepEqual(roma.communication, { sent: true, negative: false, complete: false });
});

test("a Comune that did not send it still shows the assets of the previous communication", async () => {
  const cinquefrondi = await getMunicipalityRealEstate("00008010803");
  assert.equal(cinquefrondi.status, "available");
  assert.deepEqual(cinquefrondi.communication, { sent: false, negative: null, complete: null });
});

test("without assets, the empty state tells a negative declaration from a missing communication", async () => {
  const cerchio = await getMunicipalityRealEstate("00185810660");
  assert.equal(cerchio.status, "not_found");
  assert.deepEqual(cerchio.communication, { sent: true, negative: true, complete: true });
  assert.match(cerchio.message, /dichiarato di non avere beni/);

  const valguarnera = await getMunicipalityRealEstate("00046840864");
  assert.equal(valguarnera.status, "not_found");
  assert.equal(valguarnera.communication?.sent, false);
  assert.match(valguarnera.message, /non ha inviato la comunicazione 2023/);

  const absent = await getMunicipalityRealEstate("00000000000");
  assert.equal(absent.communication, null);
  assert.match(absent.message, /Non significa che il Comune non possieda immobili/);
});

test("communication values outside the source domain fail closed", () => {
  const sent = { "Invio comunicazione 2023": "Si", "Dichiarazione negativa": "No", "Dichiarazione di completezza": "Si" };
  assert.deepEqual(readCommunication(sent), { sent: true, negative: false, complete: true });
  assert.throws(() => readCommunication({ ...sent, "Invio comunicazione 2023": "Sì" }), /fuori dominio/);
  assert.throws(() => readCommunication({ ...sent, "Dichiarazione negativa": "" }), /fuori dominio/);
  assert.throws(() => readCommunication({ ...sent, "Invio comunicazione 2023": "No" }), /fuori dominio/);
});
