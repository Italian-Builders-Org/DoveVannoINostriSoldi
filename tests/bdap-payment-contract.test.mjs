import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOpenBdapComponentTotal,
  parseOpenBdapAmount,
} from "../src/lib/data/bdap-payment-contract.ts";

test("OpenBDAP amount parser preserves zero and rejects missing or invalid cells", () => {
  assert.equal(parseOpenBdapAmount("0.00", "Totale Pagato"), 0);
  assert.equal(parseOpenBdapAmount("1234,56", "Totale Pagato"), 1234.56);
  assert.throws(() => parseOpenBdapAmount("", "Totale Pagato"), /mancante/);
  assert.throws(() => parseOpenBdapAmount("non disponibile", "Totale Pagato"), /non valido/);
});

test("OpenBDAP payment components must reconcile with the row total", () => {
  const components = {
    opErario: 1,
    opTesoreria: 2,
    opEsterno: 3,
    oaTesoreria: 4,
    oaSpesaFunzDeleg: 5,
    rsfStipendi: 6,
    rsfAltro: 7,
    noteImputazione: 8,
    totalPaid: 36,
  };
  assert.doesNotThrow(() => assertOpenBdapComponentTotal(components));
  assert.throws(
    () => assertOpenBdapComponentTotal({ ...components, totalPaid: 35 }),
    /non riconciliano/,
  );
});
