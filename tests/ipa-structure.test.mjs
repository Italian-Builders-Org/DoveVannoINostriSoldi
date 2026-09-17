import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeIpaHomogeneousArea,
  normalizeIpaOrganizationUnit,
} from "../src/lib/data/ipa-structure-contract.ts";

test("normalizes an IPA organization unit without inventing missing fields", () => {
  const unit = normalizeIpaOrganizationUnit({
    Codice_uni_uo: "ABC123",
    Codice_uni_uo_padre: "ROOT01",
    Codice_uni_aoo: "A123456",
    Descrizione_uo: " Dipartimento per i servizi ",
    Data_istituzione: "2024-01-15",
    Mail1: "dipartimento@example.it",
    Mail2: "dipartimento@example.it",
    Url: "governo.it/dipartimento",
  });

  assert.equal(unit.codice, "ABC123");
  assert.equal(unit.codicePadre, "ROOT01");
  assert.equal(unit.denominazione, "Dipartimento per i servizi");
  assert.deepEqual(unit.contatti.email, ["dipartimento@example.it"]);
  assert.equal(unit.contatti.url, "https://governo.it/dipartimento");
  assert.equal(unit.sede.indirizzo, null);
});

test("normalizes IPA AOO protocol flags conservatively", () => {
  assert.deepEqual(
    normalizeIpaHomogeneousArea({
      Codice_uni_aoo: "A123456",
      Codice_IPA: "PCM",
      cod_aoo: "PCM-PROT",
      Denominazione_aoo: "Protocollo generale",
      Protocollo_informatico: "S",
    }),
    {
      codice: "A123456",
      codiceEnte: "PCM",
      denominazione: "Protocollo generale",
      istituitaIl: null,
      aggiornataIl: null,
      protocolloInformatico: true,
    },
  );

  assert.equal(
    normalizeIpaHomogeneousArea({
      Codice_uni_aoo: "A654321",
      Denominazione_aoo: "Archivio",
      Protocollo_informatico: "non dichiarato",
    }).protocolloInformatico,
    null,
  );
});
