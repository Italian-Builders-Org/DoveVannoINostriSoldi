# Readiness contract ANAC per enti e appalti

Questa slice definisce soltanto la readiness del dato ANAC per una futura
analisi degli enti. Il consumer valida un manifest aggregate-only: non
pubblica un indice per ente o procedura, non pubblica identificatori AUSA o
codici fiscali e non aggiunge UI, route, API o MCP.

Il manifest concreto è prodotto da
`scripts/etl/anac_entity_procurement_coverage.py`. Il contratto TypeScript in
`src/lib/data/anac-entity-procurement-contract.ts` ne verifica la forma e le
partizioni. La fixture consumer è in
`tests/anac-entity-procurement-contract.test.mjs`.

## Fonti e provenance

Gli input restano separati e mantengono la loro licenza:

- dodici full snapshot CIG ANAC 2025, uno per mese, CC BY-SA 4.0;
- full snapshot `aggiudicazioni` e `aggiudicatari` come parent già bloccati dal
  contratto `anac-awardees`, CC BY-SA 4.0;
- registro ANAC [stazioni appaltanti](https://dati.anticorruzione.it/opendata/dataset/stazioni-appaltanti),
  distribuzione `stazioni-appaltanti_csv`, CC BY 4.0 (`A21_CCBY40`) e asset
  osservato con `Last-Modified: 2026-08-06T07:31:40Z`. Il record
  [dati.gov.it](https://www.dati.gov.it/node/view-dataset/dataset?id=1b480837-3aed-47d6-8b3f-f178332ee314)
  è conservato soltanto come catalogo secondario legacy: riporta UUID
  `d7ae6177-907f-4f3a-9773-20eafeccbd37` e metadata date `2020-07-20`, che non
  descrivono la freschezza dell'asset corrente.

Per i dodici CIG il source spec conserva pagina dataset, pagina e ID della
singola risorsa, URL del file e relativi lock. Per il registro stazioni conserva
la pagina dataset ANAC e l'URL ufficiale del download, senza attribuire un ID o
una resource page che la fonte osservata non espone. Per tutti questi asset il
producer verifica ultima modifica, osservazione, dimensione, SHA-256
dell'archivio, nome, dimensione, CRC32 e SHA-256 del membro CSV, licenza,
formato e header esatti. Il manifest conserva i lock sorgente e il relativo
SHA-256 del source spec. Gli input `awards` e
`awardees` contengono il lock pubblico completo del rispettivo asset parent
(URL, resource ID, timestamp, bytes, hash, membro CSV, wire format e header),
più la forma esatta `parentSpecPath`, `parentSpecSha256`, `parentInputKey` e
`license`; non esiste un flag `official` scollegato dal lock del parent.

La provenance distingue i tempi che non hanno lo stesso significato:
`catalogObservedAt` (osservazione del catalogo),
`catalogMetadataModifiedAt` (ultima modifica dei metadati, quando disponibile),
`assetObservedAt` (osservazione dei file effettivamente bloccati),
`sourceLastModified` (metadato di ultima modifica dichiarato dalla sorgente) e
`generatedAt` (creazione del manifest). Il parent mantiene inoltre il proprio
percorso, hash e tempi di catalogo; gli hash e i percorsi di source e parent
sono verificati per coerenza con i rispettivi input.

Non esiste una licenza globale del manifest composto: CIG e parent ANAC
restano CC BY-SA 4.0, mentre il registro stazioni resta CC BY 4.0.

## Scope e identità interna

Il perimetro è:

- `distributionKind: full-snapshot`;
- coorte `cig-2025-full`;
- dodici `publicationMonths`, da 1 a 12;
- `nationalPopulationClaim: not-asserted`;
- `temporalAlignment: cross-snapshot`.

La relazione interna usa due colonne ufficiali senza pubblicarne i valori:

- stazione: `codice_ausa`;
- amministrazione appaltante: `cf_amministrazione_appaltante`.

La risoluzione è esatta e fail-closed. AUSA e codice fiscale non possono essere
placeholder; i codici fiscali italiani di 11 o 16 caratteri devono superare il
rispettivo checksum. La data di pubblicazione del CIG deve inoltre ricadere
nell'intervallo `data_inizio`/`data_fine` della stazione. Se AUSA e codice
fiscale sono entrambi valorizzati, devono essere coerenti con il registro;
conflitti, valori invalidi, intervalli non applicabili, assenza di entrambi e
mancati match restano nelle partizioni di coverage. La
`denominazione_amministrazione_appaltante` e i campi di delega sono dati
descrittivi, mai chiavi identitarie.

Il manifest contiene solamente placeholder contrattuali (`ausa:<CODICE_AUSA>`
e `cf:<CF_AMMINISTRAZIONE_APPALTANTE>`), conteggi e motivi di risoluzione.
Non contiene valori AUSA, CF, nomi, righe raw o record per ente.

## Grane e importi

La procedura è il CIG:

```text
procedure = (cig)
award = (cig, id_aggiudicazione)
```

`importo_lotto` e `importo_aggiudicazione` sono misure distinte. L'importo di
aggiudicazione è contato una sola volta per la coppia distinta CIG/ID; righe
multiple di `aggiudicatari`, inclusi RTI e consorzi, non lo moltiplicano.

Il producer usa `Decimal`, non JavaScript float, e conserva i valori come
stringhe decimali esatte. Le partizioni amount sono:

- `positive-exact-cent`: valore positivo rappresentabile in centesimi;
- `positive-subcent`: più di due cifre decimali, senza arrotondamento;
- `conflicting`: coppia award duplicata con valori discordanti;
- `zero`;
- `negative`;
- `missing`;
- `invalid`.

Per ogni sezione il validator richiede che la somma degli status sia uguale a
`distinctRows`, che `positiveRows` sia la somma dei due status positivi e che
`positiveSum` coincida esattamente con la somma delle due componenti positive.
Le somme sono stringhe decimali senza esponente, segno o numero IEEE-754.
Le righe `conflicting` restano conteggiate ma non entrano nelle somme positive:
non si sceglie arbitrariamente una delle varianti discordanti. `positiveSum`
non è un pagamento né un prezzo unitario.

## Coverage e reconciliation

Il manifest non espone records o summary entity-level. Espone soltanto cinque
sezioni di conteggi:

- `registry`: righe, AUSA, CF, distinzione tra CF italiano checksum-valid e CF
  non standard e duplicazioni CF/AUSA;
- `procedures`: righe raw/non-primary/primary, date e importo lotto;
- `identity`: resolved/unresolved/conflict e motivi `via:*`;
- `awards`: chiavi valide, importi, date, duplicati, conflitti amount/date e
  award distinti;
- `awardees`: chiavi valide, coppie distinte, duplicate esatti e coppie con
  più righe.

Il validator controlla le partizioni interne, inclusi:

- raw CIG = non-primary + primary; i CIG osservati sono partizionati in
  esattamente una riga primary, nessuna primary o più primary; i CIG primary
  distinti coincidono con le procedure;
- ogni status data/importo procedura copre le righe primary;
- resolved + unresolved + conflict copre le procedure primary;
- raw award e awardees sono riconciliati con le rispettive chiavi eleggibili;
- i duplicati award distinguono righe identiche, righe non identiche, gruppi con
  conflitto amount, gruppi con conflitto data e gruppi critici;
- award coverage e cohort amount coincidono;
- `awardPairsWithAwardees + awardPairsWithoutAwardees = awardPairsInCohort`;
- importo lotto e importo aggiudicazione non sono confusi.

Le nove metriche di `reconciliation` sono conteggi, non un join pubblicato:

```text
awardPairsTotal
awardPairsInCohort
awardPairsOutOfCohort
awardPairsWithAwardees
awardPairsWithoutAwardees
awardeePairsTotal
awardeePairsInCohort
awardeePairsOutOfCohort
awardeePairsWithoutAward
```

Il validator impone le due partizioni in/out e la partizione con/senza
aggiudicatari; inoltre riconcilia il totale delle coppie award con le righe
award distinte e il totale delle coppie awardee con le coppie di join distinte.

## Risultato dello snapshot bloccato

Il manifest osservato il `2026-08-30T21:30:00Z` misura:

- 48.040 stazioni AUSA nel registro, 46.755 con CF italiano 11/16
  checksum-valid e 1.285 con identificativo ANAC non standard;
- 1.453.920 CIG distinti osservati nei dodici file, di cui 1.453.918 con una
  sola riga prevalente e 2 senza riga prevalente;
- 1.038.129 procedure con identità ente risolta e 415.789 irrisolte: 414.423
  perché la pubblicazione 2025 cade fuori dall'intervallo osservato per l'AUSA
  nel registro corrente, 1.141 per identificativo registro non standard, 224
  senza AUSA e CF e 1 senza una stazione attiva nel fallback CF; nessun nome è
  stato usato per forzare il match;
- 4.852.779 coppie award distinte nel parent, 1.284.202 nella coorte CIG 2025;
- 1.272.304 award della coorte con almeno una coppia awardee e 11.898 senza;
- 6.874 gruppi award duplicati (9.298 righe oltre la prima): 3 gruppi hanno
  un conflitto critico, uno sull'importo e due sulla data;
- 1.266.687 award della coorte con importo positivo, per una somma decimale
  esatta di `366015359646.02162975511857770881`; l'unico importo conflittuale
  è contato ma escluso dalla somma.

Questi sono conteggi di readiness cross-snapshot, non una stima della spesa
nazionale corrente. In particolare, “fuori intervallo” segnala che il registro
stazioni osservato oggi non dimostra la validità temporale per quella
pubblicazione 2025: non dimostra che la procedura fosse invalida. La somma
positiva non comprende importi zero, negativi, mancanti, invalidi o
conflittuali e non sostituisce dati di pagamento.

## Privacy e test negativi

Il contratto richiede:

```text
aggregateOnly       = true
containsRawRows     = false
containsRawTaxIds   = false
containsNames       = false
```

I test rifiutano URL non ufficiali, licenza stazioni alterata, source o parent
hash/path incoerenti, resource ID o timestamp invalidi, mese CIG mancante o
fuori ordine, scope diverso, identità o chiavi alterate, importi float o
decimali non validi, status e reconciliation incoerenti, partizioni registry
alterate, moltiplicazione per aggiudicatario, fusione dei due campi importo e
tentativi di aggiungere un entity index o campi di identità. Quando l'artifact
è registrato in `scripts/ci/generated-artifacts.json`, il test richiede che
`src/data/generated/anac-entity-procurement-coverage.json` esista e ne valida
il contenuto; in assenza di registrazione non viene simulata una pubblicazione.

La verifica è offline e non scarica le fonti. Il registry
`scripts/ci/generated-artifacts.json` va aggiornato soltanto quando artifact e
source spec producer sono presenti e referenziabili; prima di allora il
consumer contract resta una readiness dependency, non un dataset pubblicato.

## Limiti

- Gli snapshot CIG, aggiudicazioni e aggiudicatari non sono sincronizzati.
- `not-asserted` impedisce di presentare i conteggi come copertura nazionale
  corrente.
- Una forma o un checksum validi non certificano l'identità giuridica.
- Un importo dichiarato non dimostra pagamento, prezzo equo, spreco o illecito.
- Questo manifest non abilita ancora pagina ente, ranking, HHI, lista fornitori
  o lookup pubblico.
