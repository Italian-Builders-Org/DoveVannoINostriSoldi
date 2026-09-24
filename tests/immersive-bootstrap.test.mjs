import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import "./helpers/register-ts-alias.mjs";
const { IMMERSIVE_INIT_SCRIPT, isPoliticiImmersive } = await import("../src/lib/politici-immersive.ts");

test("prepaint bootstrap and client navigation agree for atlas, subdomain and normal pages", () => {
  for (const hostname of ["www.dovevannoinostrisoldi.com", "politici.dovevannoinostrisoldi.com", "localhost"]) {
    for (const pathname of ["/", "/politici", "/politici/", "/politici/europa", "/privacy"]) {
      const document = { documentElement: { dataset: {} } };
      runInNewContext(IMMERSIVE_INIT_SCRIPT, { location: { hostname, pathname }, document });
      assert.equal(document.documentElement.dataset.immersive === "politici", isPoliticiImmersive(pathname, hostname), `${hostname}${pathname}`);
    }
  }
});
