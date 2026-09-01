# Contratto dati ANAC per pagina ente e appalti

Questa slice pubblica un profilo pubblico minimizzato per ogni ente IPA con
codice fiscale valido e univoco, inclusi gli enti senza procedure nella coorte;
i record ANAC compaiono soltanto quando l'identità è risolta. Il producer costruisce
`src/data/generated/anac-entity-procurement-page/meta.json` e 256 shard
`entities/{sha256(Codice_IPA).slice(0,2)}.jsonl.gz`; il loader server-only in
`src/lib/data/anac-entity-procurement-page.ts` verifica hash, gzip, schema,
provenienza e riconciliazioni prima di restituire un profilo.
L'artifact corrente contiene 23.737 profili IPA, compresi quelli con zero
procedure o aggiudicazioni nella coorte.

La pagina riepilogativa integra la sezione nella scheda di ogni ente in
`/enti/[codice]`. Il drill-down SSR è
`/enti/[codice]/appalti`, con viste per sintesi, procedure, aggiudicazioni,
operatori e dettaglio operatore. Non esiste una nuova API o MCP per questa
slice. Il test consumer e i casi negativi sono in
`tests/anac-entity-procurement-page.test.mjs`.

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

- `distributionKind: sharded-public-profile`;
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

Il join interno usa AUSA e CF soltanto per risolvere l'ente; il relativo valore
AUSA non è pubblicato. L'artifact pagina pubblica il `codiceIpa` e il
`codiceFiscaleEnte` provenienti da IPA per il controllo di identità, oltre alla
denominazione canonica degli operatori economici. Il loader usa il CF per
verificare il profilo corrente e lo scarta dal modello pubblico; i CF degli
operatori, AUSA, righe raw e varianti nominali complete non sono pubblicati.

Ogni profilo pagina contiene solo `summary`, `operators`, `procedures` e
`awards`: le liste sono minimizzate e non sono record raw, non costituiscono un
indice AUSA/CF e non contengono campi di pagamento. Le
chiavi operatori sono riferimenti interni stabili (`op-######`) e non codici
fiscali; `nameVariants` è soltanto il conteggio delle denominazioni osservate.

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

Il manifest della pagina espone coverage aggregate e totali nazionali dello
snapshot, mentre gli shard espongono il profilo pubblico minimizzato di ogni
ente IPA valido/univoco. Le chiavi esatte di `coverage` sono:

```text
ipaRows
ipaRowsWithUniqueValidTaxCode
ipaAmbiguousTaxCodes
ipaCodes
ipaRowsWithMissingOrInvalidTaxCode
resolvedAnacEntityTaxCodes
linkedEntityProfiles
resolvedAnacEntityTaxCodesWithoutIpa
awardeeRows = {
  rawRows, ineligibleKeyRows, knownKeyRows, eligibleKeyRows,
  outOfCohortRows, resolvedRows, unresolvedRows
}
```

Il validator impone le partizioni IPA (`ipaRows = unique + missing/invalid`),
la coerenza `ipaCodes = ipaRows`, l'assenza di codici fiscali ambigui e
`linkedEntityProfiles = ipaRowsWithUniqueValidTaxCode = totals.entities`.
Per gli aggiudicatari impone inoltre:

```text
rawRows = ineligibleKeyRows + knownKeyRows
knownKeyRows = eligibleKeyRows + outOfCohortRows
eligibleKeyRows = resolvedRows + unresolvedRows
```

I totali del manifest riconciliano tutti i 256 shard e hanno le chiavi
`entities`, `procedures`, `awards`, `operators`, `awardeeRelations`,
`positiveAwards`, `awardValue`, `attributedAwardValue` e
`unattributedAwardValue`. Ogni profilo riconcilia procedure, coppie
CIG/identificativo, classi `single-operator`, `multipart`, `ambiguous` e
`no-awardee`, ranking e somme decimali; un importo positivo è attribuito al
ranking per valore soltanto quando esiste un singolo operatore risolto.

Il controllo è fail-closed: un hash, una provenance, una partizione o una
riconciliazione diversa rende l'artifact non disponibile, senza trasformare il
profilo mancante in zeri.

## Artifact e comportamento della pagina

Il profilo è distribuito in 256 shard gzip JSONL, partizionati dai primi due
caratteri dell'hash SHA-256 del `codiceIpa`. Il loader controlla bytes, hash,
gzip, newline, chiavi esatte e limite di decompressione; la cache è limitata e
ricontrolla il fingerprint del file per non mascherare una sostituzione dopo la
prima lettura.

La scheda `/enti/[codice]` mostra procedure, aggiudicazioni, valore dichiarato
e operatori economici identificati, più quote Top 1 / Top 10 e HHI quando la
soglia di 30 osservazioni è soddisfatta. `/enti/[codice]/appalti` offre ranking
per numero e valore attribuibile, liste paginabili da 25/50 righe e dettaglio
operatore. Ogni CIG collega alla pagina ufficiale ANAC. Gli stati di assenza,
identity drift o artifact non disponibile sono espliciti; non vengono mostrati
zeri inventati.

Il periodo è sempre CIG pubblicati nel 2025, tutti i dodici mesi, con snapshot
cross-temporale tra IPA, CIG, aggiudicazioni e aggiudicatari. Il perimetro non è
copertura nazionale corrente. Il valore è importo di aggiudicazione dichiarato,
non pagamento.

## Concentrazione (Top 1 / Top 10 e HHI)

Le quote e l'HHI **non sono scritti negli shard**: il loader li deriva dal
ranking già riconciliato, con aritmetica intera/decimale esatta. Non c'è una
nuova API o un dataset MCP.

- **Per numero:** quote sulle relazioni operatore–aggiudicazione
  (`awardCount`), soglia di 30 aggiudicazioni distinte (`summary.awardCount`).
- **Per valore:** quote sul valore attribuibile a un unico aggiudicatario
  risolto, soglia di 30 aggiudicazioni così attribuite.
- **Top 10:** primi `min(10, n)` operatori nello stesso ordine del ranking.
- **HHI:** somma dei quadrati delle quote percentuali, scala 0–10.000, come
  frazione ridotta. Un decimale non terminante non viene arrotondato: in pagina
  è troncato verso zero a due decimali (ellissi); la frazione compare in chiaro
  solo se è breve da leggere.
- Sotto soglia o senza denominatore il dato è `withheld`, non uno zero
  inventato. CPV, peer group, soglie e bunching restano fuori da questa slice.

Concentrazione, affidamento diretto e vicinanza a una soglia restano segnali
descrittivi: non indicano illecito.

## Privacy e test negativi

Il contratto richiede:

```text
containsEntityTaxIds       = true   # solo il CF pubblico dell'ente IPA
containsOperatorTaxIds     = false
containsOperatorTaxIdHashes = false
containsOperatorNames      = true   # una denominazione canonica
operatorNamesUsedAsKeys    = false
containsAusa                = false
containsRawRows             = false
```

I test rifiutano URL non HTTPS, licenze o parent lock alterati, resource ID non
riconciliati, timestamp o source-spec hash diversi, wire format IPA mancante,
scope diverso, chiavi extra o private, CF ente non valido, CIG o identificativo
aggiudicazione non canonici, date impossibili, status amount incoerenti, somme
float, ranking o conteggi mutati, operatori orfani, duplicazioni e shard
tampered. Verificano anche la presenza di `no-awardee` nel conteggio dei casi
non attribuibili.

La verifica è offline e non scarica le fonti. Quando l'artifact è registrato in
`scripts/ci/generated-artifacts.json`, il test richiede il relativo
`meta.json`, legge un profilo da uno shard e lo valida attraverso il loader.

## Limiti

- Gli snapshot CIG, aggiudicazioni e aggiudicatari non sono sincronizzati.
- `not-asserted` impedisce di presentare i conteggi come copertura nazionale
  corrente.
- Una forma o un checksum validi non certificano l'identità giuridica.
- Un importo dichiarato non dimostra pagamento, prezzo equo, spreco o illecito.
- Un caso `multipart`, `ambiguous` o `no-awardee` resta nel totale delle
  aggiudicazioni ma non riceve attribuzione individuale del valore.
- Il codice fiscale dell'ente è usato per identity drift e non sostituisce una
  verifica giuridica; i codici fiscali degli operatori non sono pubblicati.
- La pagina non offre ricerca live, CPV, soglie o bunching; non è una misura
  dei pagamenti. Quote Top 1 / Top 10 e HHI sono pubblicati solo con almeno 30
  osservazioni nel perimetro, come frazioni esatte, e restano descrittivi.
