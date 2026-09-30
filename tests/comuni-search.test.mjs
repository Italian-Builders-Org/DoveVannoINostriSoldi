import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/comuni/search/route.ts");
const search = async (q, limit = 8) => (await GET(new Request(`http://localhost/api/comuni/search?${new URLSearchParams({ q, limit: String(limit) })}`))).json();

test("municipal autocomplete finds Roma before similar names with the existing small limit", async () => {
  for (const query of ["Roma", "  rÒma  ", "Roma Capitale"]) {
    for (const limit of [1, 8]) {
      const result = await search(query, limit);
      assert.equal(result.hits[0]?.codiceIpa, "c_h501", `${query}, limit=${limit}`);
      assert.equal(result.hits[0]?.label, "Roma Capitale");
      assert.ok(result.hits.length <= limit);
    }
  }
});

test("municipal autocomplete preserves exact names, IPA codes and request bounds", async () => {
  for (const [query, code] of [["Fiumicino", "c_m297"], ["Mantova", "c_e897"], ["c_h501", "c_h501"]]) {
    assert.equal((await search(query, 1)).hits[0]?.codiceIpa, code);
  }
  assert.deepEqual((await search("r")).hits, []);
  assert.deepEqual((await search("zzzzzz")).hits, []);
  assert.equal((await search("roma", 16)).hits.length, 14);
});
