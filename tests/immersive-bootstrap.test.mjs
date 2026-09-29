import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import "./helpers/register-ts-alias.mjs";
const { IMMERSIVE_INIT_SCRIPT, immersiveKind } = await import("../src/lib/politici-immersive.ts");

test("prepaint bootstrap and client navigation agree for atlas, comuni, subdomain and normal pages", () => {
  const hosts = [
    "www.dovevannoinostrisoldi.com",
    "politici.dovevannoinostrisoldi.com",
    "comuni.dovevannoinostrisoldi.com",
    "localhost",
  ];
  const paths = ["/", "/politici", "/politici/", "/politici/europa", "/comuni", "/comuni/", "/privacy"];
  for (const hostname of hosts) {
    for (const pathname of paths) {
      const document = { documentElement: { dataset: {} } };
      runInNewContext(IMMERSIVE_INIT_SCRIPT, { location: { hostname, pathname }, document });
      const expected = immersiveKind(pathname, hostname);
      assert.equal(
        document.documentElement.dataset.immersive ?? null,
        expected,
        `${hostname}${pathname}`,
      );
    }
  }
});
