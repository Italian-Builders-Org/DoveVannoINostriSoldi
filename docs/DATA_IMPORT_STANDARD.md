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
   `docs/SOURCE_SNAPSHOT_INVENTORY.md`.
5. Stessi tre assi semantici (soldi, periodo, provenance) nel metadata dello
   snapshot.
6. Preferire nel tempo di **derivare** lo snapshot da byte già nel corpus, non
   da un download parallelo non hashed.

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
