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

Aggiungere il blocco:

```json
{
  "id": "investigative-explorer-incarichi",
  "files": ["src/data/generated/investigative-explorer-incarichi.json"],
  "verificationMode": "snapshot-json",
  "offlineCheck": {
    "command": "python scripts/etl/investigative_explorer_build.py --check --output src/data/generated/investigative-explorer-incarichi.json"
  },
  "reconciliationTests": ["tests/etl/test_investigative_explorer_incarichi.py"],
  "nodeTests": ["tests/investigative-explorer-incarichi.test.mjs"],
  "generator": {
    "command": "python scripts/etl/investigative_explorer_build.py --input <path-fonti-integrare> --output src/data/generated/investigative-explorer-incarichi.json"
  },
  "requiresNetworkInput": false
}
```

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
- [x] Ricerca trasversale persone / CIG-CUP / enti (route + API server-side)
- [x] Grafo generato dai dati integrati DVNS, riallineato ai refresh
- [x] Provenance + caveat su **ogni** relazione
- [x] Nessun auto-merge di persone senza ID stabile (verificato: tuple-arco univoca)
- [x] `requiresNetworkInput: false` (offline-safe)
- [~] Valutazione payload/perf: la slice è ~37k archi, servita via API
      server-side (il client riceve solo i risultati), non l'intero JSON. Da
      misurare con `npm run build` + Lighthouse prima del merge.

## Privacy e sicurezza

- Usate solo le righe **pubbliche**; i campi oscurati non sono inclusi.
- Nessun fetch esterno a runtime: la route legge l'artifact generato a build time.
- Nessun dato personale dell'autore nei commit (identity: superpios / noreply).
