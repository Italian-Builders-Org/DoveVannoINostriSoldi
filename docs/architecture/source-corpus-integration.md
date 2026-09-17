# Integrazione completa del corpus di fonti

## Obiettivo

Integrare l'intero corpus di fonti senza perdere righe, versioni, duplicati,
tentativi falliti o prove di provenienza e senza attribuire condizioni di riuso
che la singola risorsa non dichiara.

La completezza ha due livelli distinti:

1. **completezza di ricezione**: tutti i 51.303 elementi sono identificati,
   verificati e classificati;
2. **completezza di prodotto**: ogni dataset sostanziale ha una destinazione
   esplicita, un contratto di riga e una vista interrogabile oppure uno stato
   `catalog-only`/`derived-only` già dichiarato nella specifica corrente.

La seconda non può essere dichiarata se la prima non è verificata.

## Invarianti del corpus

Il listing canonico contiene:

- 46.438 file regolari;
- 4.860 hard link;
- 5 link simbolici;
- 51.303 elementi complessivi.

Le note interne che riportano conteggi o dimensioni differenti non sono una
fonte di autorità. Il gate usa il listing del contenitore e gli hash dei byte.

Per ogni elemento il ledger pubblico conserva un identificativo ordinale
opaco, tipo, dimensione, famiglia neutrale, classe di contenuto, stato
privacy/riuso e disposizione. Conserva inoltre l'hash del payload soltanto per
file regolari e hard link non classificati `restricted` o
`private-quarantine`. Il mapping tra path originario e identificativo rimane
fuori da Git.

Un hard link mantiene un elemento proprio e una relazione con il target. Un
link simbolico non viene seguito e il suo testo resta nella mappa privata. I
file regolari vengono letti in streaming.

## Interfaccia del maintainer

```bash
python3 scripts/etl/source_corpus_intake.py build \
  --archive /percorso/al/corpus.tar.gz \
  --private-map-out /percorso/privato/source-map.json

python3 scripts/etl/source_corpus_intake.py --check
python3 scripts/etl/source_corpus_intake.py verify-source \
  --archive /percorso/al/corpus.tar.gz
```

`build` genera tutto in una directory temporanea e sostituisce gli artefatti
solo dopo la chiusura di ogni controllo. `--check` è offline e verifica i byte
committati. `verify-source` ripete il controllo forte contro il corpus privato.
`--private-map-out` deve indicare un file fuori dal repository e non può essere
un link simbolico preesistente.

L'interfaccia applicativa resta piccola:

```ts
const catalog = await getIntegratedDataOverview();
const result = await selectIntegratedDataset({
  datasetId: "affidamenti-diretti",
  q: "example",
  limit: 50,
  offset: 0,
});
```

Pagina, API e MCP devono usare lo stesso selettore. Nessun chiamante
può passare path, SQL, glob, nomi di file del corpus o flag per aggirare i gate.

## Modello del ledger

```ts
type ElementKind = "regular" | "hardlink" | "symlink";

type ContentClass =
  | "official-source-candidate"
  | "secondary-source"
  | "curated-dataset"
  | "derived-data"
  | "source-document"
  | "backup-or-superseded"
  | "draft-or-candidate"
  | "error-or-failed-attempt"
  | "quality-control"
  | "tooling-or-presentation"
  | "browser-or-session-state";

type PublicationDisposition =
  | "git-raw"
  | "git-derived"
  | "manifest-only"
  | "private-quarantine"
  | "non-product";

type ArchiveElementBase = Readonly<{
  id: `ae-${string}`;
  ordinal: number;
  storedBytes: number;
  logicalBytes: number;
  family: string;
  contentClass: ContentClass;
  authority: "primary" | "official-mirror" | "secondary" | "unknown";
  license: "verified-open" | "restricted" | "not-declared" | "unknown";
  privacy:
    | "clear"
    | "organization-identifiers"
    | "named-professional-role"
    | "review-required"
    | "restricted";
  disposition: PublicationDisposition;
}>;

type ArchiveElementReceipt = ArchiveElementBase &
  (
    | Readonly<{ kind: "regular"; payloadSha256?: string }>
    | Readonly<{
        kind: "hardlink";
        payloadSha256?: string;
        hardlinkTargetId: `ae-${string}`;
      }>
    | Readonly<{ kind: "symlink" }>
  );
```

`unknown` e `not-declared` sono stati espliciti, non campi assenti. Non vengono
trasformati in una licenza inventata e non costituiscono, da soli, un gate che
rimuove le righe dalla proiezione pubblica risultante. Privacy, credenziali,
sessioni, path locali e URL riservati restano invece bloccanti e vengono
redatti con una ricevuta di riga.

## Fedeltà dei dataset

Gli snapshot selezionati sono verificati byte per byte fuori da Git tramite
dimensione e SHA-256. La proiezione pubblica conserva ordine dei campi, lessici
numerici, valori mancanti, note e duplicati sorgente, applicando soltanto le
redazioni di sicurezza registrate. I byte originali non sono necessari al
runtime pubblico.

Ogni riga sostanziale ha una disposizione disgiunta:

```text
13.321.128 righe_sorgente
= 338.782 pubblicate
 + 12.979.505 catalog-only
 + 2.841 derived-only
```

Il bulk OpenCUP conta 11.942.784 record CSV. Le 11.991.275 linee fisiche di
dati includono 48.491 newline interne a campi quotati e non sono quindi un
conteggio di record o progetti. Lo snapshot strutturato Consip mantiene invece
1.028.559 unità fisiche: 1.028.557 record validi e 2 frammenti malformati
conservati come evidenza, senza ricostruirli.

Le 79 ricevute impegnano 2.537.014.778 byte di sorgenti selezionate. Il
catalogo separato riconcilia 262.618 occorrenze in 34.071 identità: 32.578
pubblicate e 1.493 in quarantena. Il file pubblico del catalogo misura
9.286.646 byte e ha SHA-256
`bd28e08c84f5f99f127a7e350b0268314c90f9290881803140f20d6c2662448f`.

Non esiste lo stato `dropped`. La licenza `not-declared` resta una cautela di
riuso visibile, non una quarta disposizione di riga. Un importo mancante non diventa zero; uno zero
osservato resta distinto da un valore assente; una data `01-01` non viene
promossa a data esatta quando la fonte documenta soltanto l'anno.

La mappa privata conserva il path esatto e gli eventuali target simbolici
necessari alla verifica; la vista pubblica espone soltanto identità ordinali
opache e non pubblica né il path né un suo digest non autenticato, che sarebbe
indovinabile per dizionario. Per lo stesso motivo, il record pubblico di un
symlink conserva soltanto i byte logici e non il digest del testo target; gli
hash di payload restano obbligatori nei record pubblici di file regolari e hard
link non classificati `restricted` o `private-quarantine`. Per gli elementi
ristretti il digest esatto resta soltanto nella mappa privata con permessi
`0600`, insieme allo stato interno necessario a verificare gli hard link. Il
build blocca qualsiasi attribuzione
confidenziale, nome del contenitore originario, credenziale, cookie, sessione,
URL riservato o path assoluto della macchina che esegue l'intake.

## Versioni e duplicati

Un nome contenente `latest`, `backup`, `draft` o una data non decide da solo la
versione canonica. Ogni lavoro ha varianti e una decisione separata:

```ts
type VariantDecision =
  | { kind: "selected"; variantId: string; rationale: string }
  | { kind: "merged"; variantIds: readonly string[]; contract: string }
  | { kind: "blocked"; rationale: string };
```

Le copie byte-identiche condividono il contenuto ma mantengono ricevute
separate. Le versioni divergenti mantengono conteggi, hash e schema propri. I
file di release non vengono selezionati o esclusi in blocco.

## Famiglie obbligatorie

Il registro deve coprire almeno:

- anagrafiche IPA, amministrazioni e strutture;
- catalogo Amministrazione Trasparente, accesso civico, FOIA e osservazioni di
  raggiungibilità;
- affidamenti, CIG, aggiudicatari, fornitori, gruppi, Consip e collegamenti CUP;
- incarichi nominativi, consulenze legali e PNRR, CV, collaboratori, rinnovi e
  proroghe;
- personale, staff, indennità, missioni, rimborsi, affitti, auto e welfare;
- eventi, campagne, capitoli contabili e confronti internazionali;
- benchmark, segnalazioni e atti degli organi di controllo;
- C8A-D, OpenCUP, partecipate, inventari, revisioni e visure;
- prototipi, release, backup, errori, output browser e presentazioni come
  famiglie non autorevoli ma comunque contabilizzate.

Le famiglie mantengono grani incompatibili separati. In particolare non si
sommano nominativi e capitoli contabili, pagamenti e previsioni, livelli
territoriali differenti, importi per aggiudicazione replicati su più
aggiudicatari o costi progetto e compensi.

## Fonte e pubblicazione

Ogni dataset pubblico dichiara:

- proprietario della fonte primaria;
- landing e asset URL ufficiali disponibili;
- periodo, data di osservazione e data di pubblicazione quando note;
- byte, SHA-256, encoding, formato, schema e righe;
- licenza a livello di asset, oppure `not-declared`/`unknown`;
- base contabile e base IVA quando applicabili;
- campi fonte e copertura dei collegamenti riga-fonte;
- caveat e stato di pubblicazione.

Una nota del corpus non rende ufficiale un file. Il passaggio a fonte primaria
richiede URL ufficiale e verifica dell'identità del contenuto o dei metadati.
La licenza non si eredita da un dataset vicino, da un anno differente o da una
pagina generale.

I file documentali, le copie storiche e gli artefatti di lavoro restano
contabilizzati nel ledger elemento-per-elemento; i 79 dataset correnti seguono
invece la disposizione fissata nella specifica. Le 338.782 righe pubbliche
restano interrogabili anche quando il riuso non è dichiarato, con il caveat
visibile. Solo contenuto privato o sensibile viene redatto dalla proiezione.
Git LFS e un nuovo object store non vengono introdotti implicitamente.

## Etichette probatorie

La vista pubblica usa soltanto:

- `fatto-documentato`;
- `dato-mancante`;
- `scostamento-verificato`;
- `richiede-spiegazione`;
- `accertamento-ufficiale`.

Un segnale, una differenza, un rinnovo, un URL non raggiungibile o un valore
fuori distribuzione non prova spreco, illecito, corruzione, inefficienza,
recupero o qualità. Un accertamento richiede l'atto della fonte competente.

## Layout

```text
scripts/etl/source_corpus_intake.py
scripts/etl/source_corpus/
  archive_receipt.py
  classification.py
  publication_policy.py
scripts/etl/specs/source-corpus-policy.json
scripts/etl/integrated_curated_datasets.py
scripts/etl/curated_source_identity_ledger.py
scripts/etl/integrated_source_release.py

data/source-ledger/
  receipt.json
  elements/*.jsonl
  sources.jsonl
  source-catalog-proof.json
  datasets/*.receipt.json
  dataset-proof.json
  release-proof.json

src/data/generated/integrated/
  catalog.json
  rows/<dataset-id>.jsonl.gz

src/lib/integrated-source-contract.ts
src/lib/integrated-sources.ts
src/lib/integrated-public-view.ts
```

`integrated-public-view.ts` è l'unico confine di declassificazione. Route,
pagine e MCP non leggono direttamente ledger o raw.

## Gate di completezza

Il comando `--check` deve fallire su:

1. elemento mancante, extra, riordinato o con tipo mutato;
2. hard link rotto, ciclo o symlink seguito;
3. byte sostituiti anche a parità di dimensione;
4. classificazione o disposizione assente;
5. relazione a una variante inesistente;
6. equazione di righe non chiusa;
7. importo mancante trasformato in zero;
8. duplicato eliminato senza ricevuta;
9. licenza ereditata senza prova;
10. artefatto generato non deterministico;
11. attribuzione o metadato confidenziale nel diff pubblico;
12. pagina, API o MCP che usa un dataset non approvato;
13. divergenza tra selettori di pagina, API e MCP.

CI verifica offline gli artefatti committati. Il controllo contro i 51.303
elementi originali è una prova privata più forte e viene eseguito durante
l'intake e prima della PR; il ledger pubblico da solo non pretende di poter
ricostruire i path privati.

## Serving e UI

La UI inizia soltanto quando `release-proof.json` è completo.

Ordine delle superfici:

1. `/fonti/copertura` e catalogo API delle fonti;
2. hub `/dati` con tutti i 79 dataset e i tre stati di riga;
3. affidamenti puntuali, fornitori e rinnovi;
4. consulenze, incarichi, personale e spese operative;
5. trasparenza, FOIA, eventi, campagne, benchmark e atti ufficiali;
6. focus sulle partecipazioni dentro la pagina nazionale MEF esistente;
7. registrazione MCP soltanto per viste pubblicabili e paginate.

Le 21 pagine tematiche e l'anteprima Partecipazioni assegnano ogni dataset a un
solo percorso editoriale canonico. Le 57 proiezioni `rows`/`source-index`
offrono ricerca e paginazione; i 19 insiemi `catalog-only` e i 3
`derived-only` mostrano conteggio e confine strutturale senza righe inventate.
Le pagine principali mostrano al massimo tre anteprime concise; i quattro hub
tematici sono pagine di espansione che rendono raggiungibili tutti i percorsi e
il registro tecnico, non altre liste-preview da comprimere nella home.

I dataset `catalog-only` e `derived-only` restano visibili come conteggio e
motivo, non scompaiono. Le 338.782 righe della proiezione pubblica restano
interrogabili indipendentemente dallo stato di licenza dichiarato.
Non esiste un endpoint generico per leggere file del corpus.
Ogni entry del catalogo dataset include metadati chiusi di fonte e freschezza:
titolare, periodo, pubblicazione, acquisizione, ultimo controllo, frequenza e
portali canonici. La UI usa la ricevuta dataset come fallback quando una riga
non dispone di un URL puntuale e nessun portale canonico è dichiarato.

## Sequenza della singola PR

1. contratto del receipt e test rossi;
2. ledger completo classificato;
3. policy privacy, stati di licenza e specifica dei 79 dataset;
4. registro di tutte le fonti e ricevute di riga;
5. integrazioni per famiglia con ETL deterministici;
6. loader, API e MCP condivisi;
7. gate completo delle fonti;
8. UI e navigazione;
9. prove browser, accessibilità, dimensioni e CI.

I commit restano tematici e bisecabili, ma appartengono alla stessa PR.

## Sintesi architetturale

Sono stati confrontati due disegni indipendenti. È stato scelto come base il
ledger probatorio perché modella correttamente file regolari, hard link,
symlink, varianti e chiusura delle righe. Dal secondo disegno sono stati
integrati:

- l'interfaccia pubblica ridotta a verifica, classificazione, build e load;
- un solo confine di vista pubblica;
- materiali `catalog-only` o `derived-only` che non vengono trasformati in
  righe inventate;
- manifest aggregato con shard di ricevute;
- sequenza receipt-first della PR.

Sono stati rifiutati il mirror indiscriminato dei byte, un warehouse mutabile
come prima fonte di verità, una tabella universale che mescola grani differenti
e l'importazione delle sole tabelle più attraenti senza prova delle omissioni.
