# Standard di import dei dati

Playbook operativo per aggiungere una fonte ufficiale in modo ripetibile.
Destinatari: contributor umani e agenti (Claude Code, Codex, Cursor).

Complementa [DATA_SOURCES.md](DATA_SOURCES.md),
[INTEGRATED_SOURCE_LEDGER.md](INTEGRATED_SOURCE_LEDGER.md) e
[architecture/source-corpus-integration.md](architecture/source-corpus-integration.md).
Non sostituisce i contratti fail-closed già in repo.

## Decisione iniziale: quale binario?

| Situazione | Binario obbligatorio |
| --- | --- |
| Tabella ufficiale (CSV/API) da pubblicare a righe interrogabili | **Corpus integrato** (`integrated-curated-datasets`) |
| Solo metadati / dump troppo grande / non ancora proiettabile | Corpus con `publication: catalog-only` o `derived-only` |
| Albero tipizzato già usato da una pagina (missioni, CP/RS/CS) | Snapshot tipizzato esistente **oppure** vista derivata; non inventare un terzo schema |
| Nuova verticale UI su dati già hashed | Filtro/aggregazione sul corpus o sugli snapshot; **niente** nuovo JSON ad hoc |

Regola d'oro: la pagina consuma; non reinventa lo schema della fonte.

## Tre campi semantici obbligatori

Ogni dataset pubblicato (corpus o snapshot) deve rendere espliciti questi tre
assi. Se un asse manca nella fonte, si dichiara assente: non si ricostruisce.

### 1. Soldi (unità e natura contabile)

- Unità unica e dichiarata: preferire **centesimi di euro** negli snapshot
  tipizzati; nel corpus le celle restano stringhe e il parser condiviso deve
  documentare come si convertono.
- Per gli ETL Python vedi le [primitive monetarie e le policy degli adapter](ETL_MONETARY_PARSING.md).
- Natura contabile **distinta**, mai sommata in silenzio:
  - stanziamento / previsione
  - impegno
  - pagamento (cassa o competenza, come da fonte)
  - costo previsto vs costo effettivo (opere)
- Zero osservato ≠ cella vuota ≠ “n.d.”.
- Vietato inventare totali nazionali o di evento sommando perimetri diversi.

### 2. Periodo (tempo del fatto economico)

- `referencePeriod` o colonne temporali dedicate (`anno`, `esercizio`, `dal`/`al`).
- Non promuovere un anno trovato in un URL o in testo libero a periodo ufficiale.
- Previsioni e pagamenti di esercizi diversi restano serie separate.

### 3. Provenance (chi, dove, quando)

Campi **distinti** (non collassare in una sola “data aggiornamento”):

| Campo | Significato |
| --- | --- |
| Titolare / holder | Chi pubblica |
| URL canonici | Landing e/o dump ufficiali |
| `publicationDate` | Quando la fonte ha pubblicato il rilascio |
| `acquisitionDate` / `observedAt` | Quando noi abbiamo acquisito i byte |
| `checkedAt` | Ultimo controllo di validità |
| Licenza | Solo se dichiarata; altrimenti `not-declared` (cautela di riuso, non nasconde la riga) |
| Hash | SHA-256 dei byte versionati / ricevuta dataset |

## Checklist import (corpus integrato)

Usare nell'ordine. Fermarsi al primo fallimento (fail-closed).

1. **Issue**
   Aprire o collegare una issue con: titolare, URL, licenza, formato, geografia,
   periodo, frequenza, e cosa il dato *non* misura.

2. **Acquisizione**
   Scaricare solo da URL ufficiali. Conservare byte e hash. Nessuna stima o OCR
   “di comodo” senza dichiarazione esplicita in quarantena.

3. **Classificazione nel corpus**
   Elemento inventariato, famiglia/content class, disposizione
   (`publish` / quarantine). Vedi `source_corpus_intake.py` e
   `scripts/etl/specs/source-corpus-policy.json`.

4. **Contratto di riga**
   Definire `headers` stabili. Celle = `string | null`. Aggiungere
   `evidenceLabel`, `sourceUrls`, eventuali `privateFields` / redazioni.
   Registrare il dataset in
   `scripts/etl/specs/integrated-curated-datasets.source.json` con
   `sourceMetadata` (holder, referencePeriod, dates, canonicalUrls) e caveats.

5. **Proiezione e ricevute**
   Generare chunk `*.part-NNNNN.jsonl.gz`, aggiornare catalogo, dataset-proof e
   release-proof. Chiudere le equazioni del ledger
   (`docs/INTEGRATED_SOURCE_LEDGER.md`).

6. **Verifica offline**
   ```bash
   python3 scripts/etl/source_corpus_intake.py --check
   npm run test:etl
   npm run test:snapshots
   ```
   Nessuna rete verso fonti esterne in questi gate.

7. **Superfici prodotto**
   - Catalogo `/dati/[dataset]` e API integrate via selettore condiviso.
   - MCP: riusare `selectIntegratedDataset` / catalogo esistente; non creare un
     secondo id parallelo “per comodità”.
   - UI editoriale: una vista che **filtra** le righe; copy senza giudizi di
     spreco/frode/efficienza.

8. **PR**
   Branch focalizzato, issue collegata, test eseguiti dichiarati, caveats in
   pagina o in `sourceMetadata`. Review: significato pubblicato, non solo codice.

## Checklist import (snapshot tipizzato)

Solo se il prodotto richiede tipi forti (alberi missione, CP/RS/CS, ecc.) e non
basta una proiezione a celle stringa.

1. Spec `scripts/etl/specs/<nome>.source.json` (URL, hash, schema atteso).
2. Contratto Zod/TS in `src/lib/data/*-contract.ts` con validazione fail-closed.
3. ETL `scripts/etl/*_snapshot.py` (o Node) + `--check` offline.
4. Registrazione in `scripts/ci/generated-artifacts.json` e inventario
   `docs/SOURCE_SNAPSHOT_INVENTORY.md`. Se la fonte ha API, dataset MCP e una
   scheda fra le fonti, i registri sono di più: vedi
   [Registri di una fonte tipizzata](#registri-di-una-fonte-tipizzata).
5. Stessi tre assi semantici (soldi, periodo, provenance) nel metadata dello
   snapshot.
6. Preferire nel tempo di **derivare** lo snapshot da byte già nel corpus, non
   da un download parallelo non hashed.

### Registri di una fonte tipizzata

Una fonte con snapshot tipizzato, API, dataset MCP e scheda fra le fonti compare
in registri espliciti sparsi nel repository. Mancarne uno non rompe il build: fa
cadere un test in CI, spesso con un messaggio che non nomina il registro. La
colonna di destra è il test che se ne accorge.

| Registro | Cosa aggiungere | Chi lo verifica |
| --- | --- | --- |
| `scripts/ci/generated-artifacts.json` | voce dell'artefatto, test ETL e Node, generatore | `scripts/ci/validate-generated-artifacts.py` |
| `docs/SOURCE_SNAPSHOT_INVENTORY.md` | rigenerato con `python scripts/ci/source-snapshot-inventory.py --write` | test ETL: «is stale» |
| `next.config.ts`, `outputFileTracingIncludes` | l'artefatto letto a runtime sulla sua route e nei tre aggregati `/api/assistant/chat`, `/mcp`, `/api/mcp` | `scripts/ci/check-runtime-traces.mjs`, dentro `npm run build` |
| `scripts/ci/check-runtime-traces.mjs` | artefatto → route che devono tracciarlo | `npm run build` |
| `src/lib/mcp/catalog.ts` | id in `DATASET_IDS`, query di esempio, descrittore | `tests/mcp-datasets.test.mjs` |
| `src/lib/mcp/datasets.ts` | ramo dell'adapter | `tests/mcp-datasets.test.mjs` |
| `tests/assistant-byok.test.mjs` | tetto dei metadati alzato quanto serve, misurandolo | «should remain compact» |
| `src/lib/data/source-policy.ts` | `SourceId` e politica della fonte | `npm run typecheck` |
| `src/lib/sources.ts` | scheda pubblica della fonte | `tests/source-latest-data.test.mjs`: schede pubbliche e fonti attive devono coincidere |
| `src/lib/source-latest-data.ts` | etichetta dell'ultimo dato | `npm run typecheck` e `tests/source-latest-data.test.mjs` |
| `src/lib/data/source-fetch.ts` | host consentiti in `ALLOWED_HOSTS`, anche un elenco vuoto | `npm run typecheck` |
| `src/lib/data/source-health-snapshots.ts` | funzione di stato e voce nella mappa | `tests/source-health.test.mjs` |
| `src/data/generated/source-health-snapshots.json` | rigenerato con `npm run source-health:generate`, **mai a mano** | `tests/source-health.test.mjs` |
| `scripts/runtime-health.mjs`, `EXPECTED_SOURCE_IDS` | id della fonte | `tests/source-health-cold-deadline.test.mjs`: «Source health non coincide con il registro operativo» |
| `tests/runtime-health.test.mjs` | id della fonte nell'elenco del test | `tests/source-health-monitor.test.mjs` |

Due regole che la tabella da sola non dice:

- **Inventario e stato fonti si rigenerano dopo aver fuso `main`.** La CI
  valuta il merge con `main`, non il branch: se nel frattempo è entrata
  un'altra fonte, i due artefatti generati prima del merge risultano stale anche
  se in locale erano verdi.
- **Per trovare i registri, parti da una fonte simile già integrata.** Elenca i
  file che ne citano l'id e controlla quali non citano la nuova:

  ```bash
  grep -rl "<id-di-una-fonte-simile>" src/ scripts/ tests/ \
    | xargs grep -L "<id-della-nuova-fonte>"
  ```

  Restano da scartare solo i file propri della fonte di partenza (la sua route,
  il suo contratto, i suoi test). Un registro nuovo che non sta in questa tabella
  salta fuori così.

## Vietato

- Nuovo JSON di pagina che duplica un dataset già nel corpus.
- Sommare previsione + pagamento, o PCM + RGS + LdB, in un “totale unico”.
- Alias di ricerca che rubano query di città/ente (es. nomi di comuni negli
  alias di una verticale).
- Affermazioni su spreco, frode, qualità o responsabilità individuale da soli
  scostamenti contabili.
- Licenza inventata o estesa da un dataset all’altro.

## Skill agente

Per esecuzione assistita: `.agents/skills/import-dvns-dataset/SKILL.md`.
Per verifica post-merge delle superfici: `.agents/skills/verify-dvns-integrated-sources/SKILL.md`.

## Follow-up tecnici (non bloccanti per questa doc)

- Helper condivisi di parsing soldi/periodo accanto a
  `src/lib/integrated-source-contract.ts`.
- Colmare `sourceMetadata` ancora incompleti.
- Esporre più dataset `publication: rows` in MCP senza id duplicati.
- Promuovere snapshot manuali al refresh automatico uno alla volta
  (`docs/SOURCE_SNAPSHOT_INVENTORY.md`).
