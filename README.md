# DoveVannoINostriSoldi

> **Dove vanno i soldi pubblici, fonte per fonte.**

DoveVannoINostriSoldi è un progetto civico open source per capire come vengono usati i soldi pubblici italiani.

Riunisce dati ufficiali oggi dispersi tra portali diversi. Da un grafico, un ente o un progetto si può arrivare alla fonte originale, vedere la data del dato e capire i suoi limiti. Non crea classifiche dello scandalo e non trasforma un segnale in un'accusa.

## Principio fondamentale

**Nessun numero senza fonte, data e spiegazione.**

“Aggiornato” significa aggiornato quanto la fonte. DoveVannoINostriSoldi controlla quando arrivano nuovi dati ufficiali e mostra separatamente:

- la data a cui si riferisce il dato;
- quando la piattaforma lo ha acquisito;
- se la fonte risponde;
- quanto spesso la fonte pubblica nuovi dati;
- i calcoli applicati.

## Cosa vogliamo unire

- pagamenti e incassi della PA tramite SIOPE / SIOPE+ e OpenBDAP;
- bilancio e pagamenti dello Stato pubblicati dalla Ragioneria Generale dello Stato;
- contratti pubblici, CIG, stazioni appaltanti e aggiudicazioni ANAC / BDNCP;
- dati sui pagamenti pubblicati dalle singole amministrazioni ai sensi dell'art. 4-bis del D.Lgs. 33/2013;
- anagrafe degli enti tramite IPA;
- opere pubbliche, CUP, PNRR e politiche di coesione;
- consulenze e incarichi pubblici;
- bilanci, gare e dati economici pubblicati da Camera e Senato;
- in seguito: sovvenzioni, partecipate, patrimonio, personale e indicatori di pagamento.

Il registro pubblico è in [`src/lib/sources.ts`](src/lib/sources.ts); le policy operative di freshness sono in [`src/lib/data/source-policy.ts`](src/lib/data/source-policy.ts).

## Cosa c'è già

### Home dashboard-first

La route `/` è direttamente il prodotto: non contiene una landing promozionale e non usa valori dimostrativi.

- ricerca reale degli enti sul datastore IPA;
- quadro SIOPE dei pagamenti di cassa dei Comuni e flusso mensile ufficiale;
- mappa delle 20 regioni alimentata dai valori SIOPE pro capite e dai confini ISTAT 2026;
- pagina `/controlli` con i numeri del dossier 2026, colori semantici e limiti di lettura espliciti;
- riepilogo OpenCoesione con rapporto finanziario distinto dall'avanzamento fisico;
- data di riferimento, pubblicazione della fonte, acquisizione e frequenza di controllo visibili;
- percorsi diretti verso dashboard di dettaglio, metodologia e fonti originali.

I tooltip sono riservati ai termini che richiedono una spiegazione contabile; freschezza e provenienza non vengono nascoste al loro interno.

### Spese dello Stato

`/spese` usa esclusivamente dataset ufficiali RGS/OpenBDAP e scopre automaticamente il periodo più recente disponibile.

La dashboard contiene:

- Totale Pagato del Bilancio dello Stato;
- pagamenti per Missione;
- pagamenti per Amministrazione;
- classificazione economica;
- canali di pagamento;
- riconciliazione automatica dei totali tra dataset indipendenti;
- serie cumulativa 2026;
- flusso mensile derivato come differenza tra due snapshot cumulativi consecutivi;
- link diretti ai CSV e package ufficiali RGS.

API:

- `/api/spese/stato`
- `/api/spese/stato/storico`

### Registro nazionale degli enti

L'Indice PA è la prima anagrafe canonica del progetto.

- ricerca full-text in `/enti`;
- pagina canonica `/enti/[codice]` per Codice IPA;
- API normalizzata `/api/enti` e `/api/enti/[codice]`;
- aggregazioni reali via Data API SQL;
- grafico della distribuzione per tipologia;
- provenienza e licenza esposte insieme al record.

Le schede ente leggono inoltre i dataset IPA **Unità Organizzative** e **Aree Organizzative Omogenee**:

- relazioni UO padre-figlio solo quando dichiarate da IPA;
- collegamenti UO → AOO tramite gli identificativi ufficiali;
- conteggi e prime 24 unità nella scheda, fino a 500 record nell'API;
- endpoint `/api/enti/[codice]/struttura`;
- nessuna deduzione automatica “UO = dipartimento”.

La pagina `/enti` espone anche l'indice strutturale IPA C1 di ministeri, Presidenza del Consiglio e Avvocatura.

### Partecipazioni pubbliche

`/partecipazioni` usa il CSV ufficiale del censimento MEF riferito al 31 dicembre 2023 e pubblicato il 10 marzo 2026.

- 53.656 relazioni amministrazione–partecipata;
- 8.360 amministrazioni dichiaranti;
- 7.979 organizzazioni partecipate;
- distinzione tra partecipazioni dirette e indirette;
- segnali dichiarati di controllo analogo e affidamento diretto presentati come evidence datata, non come status legale corrente;
- provenienza completa con URL, SHA-256, codifica rilevata e licenza;
- endpoint `/api/partecipazioni`;
- refresh automatico giornaliero senza commit se il rilascio ufficiale è invariato.

```bash
python3 scripts/etl/mef_participations_snapshot.py
python3 scripts/etl/mef_participations_snapshot.py --check
```

### Politiche di coesione

`/coesione` usa l’aggregato nazionale dell’API ufficiale OpenCoesione e pubblica uno snapshot verificato, senza numeri dimostrativi.

La dashboard contiene:

- costo pubblico, pagamenti e numero di progetti;
- rapporto finanziario pagamenti/costo, esplicitamente distinto dall’avanzamento fisico;
- letture interattive per tema, natura e stato con tabella accessibile equivalente;
- serie annuale cumulativa di impegni e pagamenti;
- data del rilascio sorgente, acquisizione, cadenza dichiarata e frequenza di controllo separate;
- riconciliazioni ricalcolate dei totali generali e della componente coesione, con avvertenza sui progetti multilocalizzati.

API e aggiornamento:

- `/api/coesione`
- `python3 scripts/etl/opencoesione_snapshot.py` per verificare e aggiornare lo snapshot;
- `python3 scripts/etl/opencoesione_snapshot.py --check` per la validazione offline;
- workflow schedulato ogni 6 ore, con retry limitati e commit soltanto quando cambia il payload normalizzato, esclusi i timestamp di osservazione.

### Stato delle fonti

`/fonti/stato` separa tre concetti che spesso vengono confusi:

1. **integrazione**: esiste un adapter di DoveVannoINostriSoldi?
2. **reachability**: l'upstream risponde?
3. **freshness**: quanto è vecchio il dato secondo un timestamp ufficiale e una soglia coerente con la fonte?

L'API corrispondente è `/api/fonti/stato`.

Per una fonte ancora soltanto mappata non mostriamo un falso semaforo online/offline.

## Architettura delle sorgenti

Ogni nuovo adapter deve usare progressivamente il layer condiviso in `src/lib/data/`:

```text
source-policy.ts   cadenza, timeout, retry, cache tag, stale threshold
source-fetch.ts    HTTPS + host allowlist + GET/HEAD + timeout + retry transitori
freshness.ts       classificazione fresh / stale / unknown
source-health.ts   reachability e timestamp ufficiali
Delimited parser   parsing riutilizzabile per CSV pubblici
```

Il fetch layer non accetta host arbitrari, non consente write verso gli upstream e non permette agli adapter di sovrascrivere direttamente la cache policy.

Leggi [`docs/FRESHNESS_AND_REFRESH.md`](docs/FRESHNESS_AND_REFRESH.md).

## Aggiornamento automatico

La cache applicativa è segmentata per source tag. L'endpoint interno:

```text
POST /api/internal/refresh-sources
```

è disabilitato se `SOURCE_REFRESH_SECRET` non è configurato e accetta soltanto identificativi di fonti conosciute.

Dopo il deployment:

1. genera un secret lungo e casuale;
2. configura `SOURCE_REFRESH_SECRET` nell'ambiente del deployment;
3. configura lo stesso valore come repository secret GitHub `SOURCE_REFRESH_SECRET`;
4. configura il repository secret `REFRESH_URL` con l'origin del deployment, per esempio `https://example.org`.

I workflow separati fanno poi:

- **Source refresh**: invalidazione source-scoped ogni ora;
- **Source health**: probe ogni 6 ore degli adapter inclusi nel monitor applicativo; OpenCoesione è controllata dal workflow snapshot dedicato.
- **OpenCoesione snapshot**: controllo dell’API ogni 6 ore e aggiornamento del file versionato soltanto quando cambia il payload normalizzato.
- **MEF partecipazioni**: discovery giornaliera del CSV annuale e commit soltanto quando cambia hash, schema o trasformazione.

Un outage RGS/AgID può rendere rosso il monitor delle fonti, ma **non** la CI del codice.

## Stack

- Next.js 16.3
- React 19.2
- TypeScript strict
- Recharts per le visualizzazioni dashboard
- CSS nativo con design tokens
- Impeccable come design quality gate
- Node.js 22.23.2 nel progetto/CI
- npm lockfile committato e installazioni CI riproducibili con `npm ci`

La persistenza verrà introdotta quando i volumi e le query cross-fonte la rendono necessaria. Il progetto evita di costruire un database attorno a ipotesi di join non ancora validate.

## Avvio locale

```bash
npm ci
npm run dev
```

Controlli completi:

```bash
npm run lint
npm test
npm run typecheck
npm run design:check
npm run build
```

La CI richiede **zero warning ESLint**, test verdi, TypeScript verde, detector Impeccable verde e production build verde.

Per lavorare sul design con un harness supportato da Impeccable:

```bash
npx impeccable install
```

Il contesto persistente del prodotto è in [`PRODUCT.md`](PRODUCT.md); il sistema visuale è in [`DESIGN.md`](DESIGN.md).

## Architettura dati

Ogni record normalizzato dovrà conservare almeno:

```text
source_id
source_record_id
source_url
source_published_at
observed_at
ingested_at
entity_identifiers
raw_hash
schema_version
transform_version
```

Gli identificativi di dominio, come Codice IPA, codice fiscale dell'ente, CIG, CUP e codici territoriali, rimangono separati. Nessun join probabilistico viene promosso a fatto senza una regola documentata.

Leggi [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Regole per grafici e mappe

Una visualizzazione entra in produzione soltanto quando esiste un dato verificabile.

- fonte e data devono essere visibili o immediatamente raggiungibili;
- assi e unità devono dichiarare che cosa viene misurato;
- valori cumulati non vengono presentati come valori periodali senza trasformazione documentata;
- mappe e marker devono rappresentare una misura reale o uno stato di copertura;
- se il dato manca, mostriamo uno stato vuoto, non una serie dimostrativa;
- le animazioni non devono alterare o spettacolarizzare la percezione di un dato finanziario.

La geometria regionale della home è generata in modo riproducibile dal pacchetto ufficiale ISTAT. Fonte, checksum, licenza e procedura sono documentati in [`docs/ISTAT_REGIONAL_MAP.md`](docs/ISTAT_REGIONAL_MAP.md).

## Alert e anomalie

Una procedura poco concorrenziale, un prezzo elevato o un fornitore ricorrente possono meritare un controllo, ma **non provano un illecito**.

Gli indicatori futuri dovranno essere:

1. riproducibili;
2. spiegabili;
3. confrontati tra casi omogenei;
4. collegati ai record originali;
5. presentati come segnali di verifica, non come sentenze.

Leggi [`docs/LEGAL_AND_ETHICS.md`](docs/LEGAL_AND_ETHICS.md).

## Indipendenza

DoveVannoINostriSoldi è un progetto civico indipendente. Non è un sito ufficiale dello Stato italiano, di ANAC, RGS, Banca d'Italia, AgID, Camera o Senato.

I dati restano attribuiti alle rispettive fonti e vengono riutilizzati nel rispetto delle licenze, delle condizioni applicabili e della normativa sulla protezione dei dati personali.

## Contribuire

Le contribution più utili sono:

- nuovi adapter verso fonti ufficiali;
- test di qualità e riconciliazione dei dati;
- documentazione delle classificazioni contabili;
- miglioramenti di accessibilità e data visualization;
- metodologie robuste per benchmark e anomaly detection;
- segnalazioni di fonti pubbliche mancanti.

Per una nuova fonte, aprire una issue indicando almeno proprietario, URL ufficiale, licenza, formato, frequenza, identificativi e chiavi utili al join.

## Licenza

Codice rilasciato con licenza MIT. I dataset incorporati o collegati mantengono le licenze e le condizioni delle rispettive fonti.

Le attribuzioni degli asset e dei dati incorporati sono raccolte in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
