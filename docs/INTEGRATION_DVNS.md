# Integrazione Investigative Explorer nel portale DVNS (issue #105)

Prototipo di **draft PR** con slice verticale su `incarichi-nominativi-shard`.
Ogni arco mantiene provenance completa e un caveat per relazione; **non** si
fonde alcuna persona senza ID stabile. Il grafo è generato dai dati integrati
DVNS, non dal nostro JSON statico (che resta solo fixture/demo).

## File da copiare nel fork `DoveVannoINostriSoldi`

| File (in questo repo) | Destinazione nel fork |
| --- | --- |
| `scripts/etl/investigative_explorer_build.py` | `scripts/etl/investigative_explorer_build.py` |
| `tests/etl/test_investigative_explorer_incarichi.py` | `tests/etl/test_investigative_explorer_incarichi.py` |
| `src/lib/investigative-explorer.ts` | `src/lib/investigative-explorer.ts` |
| `src/app/esplora/page.tsx` | `src/app/esplora/page.tsx` |
| `src/app/esplora/EsploraSearch.tsx` | `src/app/esplora/EsploraSearch.tsx` |
| `src/app/esplora/esplora.module.css` | `src/app/esplora/esplora.module.css` |
| `src/app/api/esplora/route.ts` | `src/app/api/esplora/route.ts` |
| `tests/investigative-explorer-incarichi.test.mjs` | `tests/investigative-explorer-incarichi.test.mjs` |
| `tests/investigative-explorer-incarichi-route.test.mjs` | `tests/investigative-explorer-incarichi-route.test.mjs` |

## Patch 1 — `src/lib/site-navigation.ts`

Aggiungere `/esplora` come voce della sezione "Cosa controllare" (children), ad
esempio dopo `{ href: "/controlli", label: "Segnali" }`:

```ts
{
  href: "/controlli",
  label: "Cosa controllare",
  aliases: ["/appalti", "/incarichi", "/dati", "/trasparenza"],
  children: [
    { href: "/appalti", label: "Appalti" },
    { href: "/incarichi", label: "Incarichi" },
    { href: "/dati", label: "Catalogo dati" },
    { href: "/controlli", label: "Segnali" },
    { href: "/esplora", label: "Esplora relazioni" },
  ],
},
```

(Opzionale, per coerenza footer) aggiungere la stessa voce anche nel gruppo
`"Cosa controllare"` di `SITE_MAP_GROUPS`.

## Patch 2 — `scripts/ci/generated-artifacts.json`

Aggiungere il blocco dentro l'array `"artifacts"` (la radice del file e' un oggetto
con `"schemaVersion"`, `"generatedDataRoots"`, `"exclusions"`, `"artifacts"`):

```json
{
  "id": "investigative-explorer-incarichi",
  "owner": "Investigative Explorer - slice incarichi (issue #105)",
  "files": [
    "src/data/generated/investigative-explorer-incarichi.json",
    "src/data/generated/investigative-explorer-incarichi.meta.json",
    "src/data/generated/investigative-explorer-incarichi.json.gz"
  ],
  "verificationMode": "curated-committed",
  "offlineCheck": {
    "command": "python3 scripts/etl/investigative_explorer_build.py --check --output src/data/generated/investigative-explorer-incarichi.json",
    "coveredBy": "standalone"
  },
  "reconciliationTests": ["tests/etl/test_investigative_explorer_incarichi.py"],
  "nodeTests": ["tests/investigative-explorer-incarichi.test.mjs"],
  "generator": {
    "command": "python3 scripts/etl/investigative_explorer_build.py --input <path-righe-integate-incarichi> --acquired <acquisitionDate> --output src/data/generated/investigative-explorer-incarichi.json",
    "requiresNetworkInput": false
  },
  "trustModel": "Curated slice from committed integrated rows (incarichi-nominativi-shard); --check validates offline, no person auto-merge."
}
```

Note: il `generator` produce tre file (tutti registrati in `files`):
- `investigative-explorer-incarichi.json` — artifact completo validato da `offlineCheck`;
- `investigative-explorer-incarichi.meta.json` — proiezione leggera (solo conteggi,
  caveat, top entità): la SSR di `/esplora` legge **solo** questo, mai l'array archi;
- `investigative-explorer-incarichi.json.gz` — artifact compresso per banda/cold-start
  (servito con `Content-Encoding: gzip`).

## Pipeline di generazione nel fork

L'ETL legge le righe integrate già presenti (no rete, `requiresNetworkInput:
false`), quindi rispetta il network guard. Nel fork l'`--input` punta al path
degli incarichi integrati (es. `data/source-ledger/...` o
`src/data/generated/integrated/rows`); in questo repo legge il CSV di relazioni
già estratte. Il contratto di output è identico.

Comandi da eseguire nel fork prima di aprire la PR:

```bash
npm ci
python scripts/etl/investigative_explorer_build.py --input <path> --output src/data/generated/investigative-explorer-incarichi.json
npm run ci:static
npm run test:etl
npm run test:node
npm run build
```

## Requisiti dei founder (da `leggiadesso.txt`) — stato

- [x] Rotta `/esplora` nell'area "Cosa controllare"
- [x] Ricerca trasversale persone / CIG-CUP / enti (indice invertito lato server, cache)
- [x] Grafo generato dai dati integrati DVNS, riallineato ai refresh
- [x] Provenance + caveat su **ogni** relazione
- [x] Nessun auto-merge di persone senza ID stabile (verificato: `id` arco da hash composto)
- [x] `requiresNetworkInput: false` (offline-safe)

### Esito review founder (PR #128) — fix applicati

Bloccanti segnalati e relativi fix (tutti implementati):

- [x] **SSR non deve parsare 35 MB** → `/esplora` legge solo `*.meta.json` (leggero).
- [x] **`verificationMode` incoerente** → `curated-committed` (coerente con `requiresNetworkInput:false`).
- [x] **API fragile / search lineare / nessun debounce** → route `dynamic` (no `force-static`+searchParams), indice invertito con cache lato server, debounce 250 ms lato client; il client riceve solo i risultati.
- [x] **CIG/CUP solo in nota, non cercati** → `note_source` è nei campi indicizzati; copy onesta sulla slice.
- [x] **`key={source_record_id}` collide** → ogni arco ha `id` stabile (hash di tutti i campi), usato come chiave React.
- [x] **Copy/UI prometteva più della slice** → testo allineato: fetta `incarichi-nominativi-shard` (persona↔ente), CIG/CUP e atti in nota e ricercabili; link forte a `/incarichi`.

Suggerimenti (non bloccanti): compressione/shard (ora `.json.gz` presente), link
`/incarichi`↔`/esplora` (aggiunto), licenza (presente `AGPL-3.0-or-later` nei metadati).

> Nota dimensione: l'artifact `.json` resta nel tree (validato da `offlineCheck`).
> Se i maintainer preferiscono toglierlo dal clone, si può validare il `.json.gz`
> e non committare il `.json`; scelta lasciata alla review.

## Privacy e sicurezza

- Usate solo le righe **pubbliche**; i campi oscurati non sono inclusi.
- Nessun fetch esterno a runtime: la route legge l'artifact generato a build time.
- Nessun dato personale dell'autore nei commit (identity: superpios / noreply).
