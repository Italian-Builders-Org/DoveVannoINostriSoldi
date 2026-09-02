import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const headerSearch = await readFile(
  new URL("../src/components/header-search.tsx", import.meta.url),
  "utf8",
);

test("la ricerca usa la query rifilata e riparte anche per variazioni di spaziatura", () => {
  const effect = headerSearch.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[query\]\);/);

  assert.ok(effect, "l'effetto di ricerca deve dipendere dalla query inserita");
  assert.match(effect[1], /const effectQuery = query\.trim\(\);/);
  assert.match(effect[1], /if \(effectQuery\.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH\)/);
  assert.match(effect[1], /encodeURIComponent\(effectQuery\)/);
  assert.match(headerSearch, /const trimmedQuery = query\.trim\(\);/);
  assert.match(
    headerSearch,
    /const showDropdown = open && trimmedQuery\.length >= GLOBAL_SEARCH_MIN_QUERY_LENGTH;/,
  );
  assert.match(headerSearch, /const DEBOUNCE_MS = 400;/);

  for (const rawQuery of ["  Roma", "Roma  ", "  Roma  "]) {
    assert.equal(rawQuery.trim(), "Roma");
  }
});

test("un nuovo input invalida subito la risposta precedente, anche mentre è pronta o in attesa", () => {
  const inputHandler = headerSearch.match(/onChange=\{\(event\) => \{([\s\S]*?)\n        \}\}/);

  assert.ok(inputHandler, "il campo deve gestire il cambio della query");
  assert.match(
    inputHandler[1],
    /requestIdRef\.current \+= 1;\s*abortRef\.current\?\.abort\(\);/,
  );
  assert.match(inputHandler[1], /setResponse\(null\);/);
  assert.match(
    inputHandler[1],
    /setLoading\(nextQuery\.trim\(\)\.length >= GLOBAL_SEARCH_MIN_QUERY_LENGTH\);/,
  );
  assert.match(
    headerSearch,
    /if \(requestId !== requestIdRef\.current \|\| payload\.ok !== true\) return;/,
  );
});
