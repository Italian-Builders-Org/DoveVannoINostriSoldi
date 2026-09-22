# Contesto per gli agenti

Mappa per attività: ogni sezione dice quando serve, le fonti iniziali davvero
pertinenti, gli invarianti particolari e dove stanno i controlli. Una task
trasversale legge l'unione delle sezioni pertinenti. Per una task non elencata,
cerca percorsi e contratti reali e dichiara l'incertezza invece di classificare
a caso.

## Ingresso

- **Quando serve**: solo se la task appartiene a un dominio mappato; leggi la
  sezione pertinente, non tutta la mappa. Per una task non mappata non usare
  questa mappa come ingresso: parti da
  [docs/ARCHITECTURE.md](ARCHITECTURE.md) per i percorsi del dato e da
  [CONTRIBUTING.md](../CONTRIBUTING.md) per setup, test e gate.
- **Selezione**: una task trasversale legge solo l'unione delle sezioni
  pertinenti. Le sezioni disponibili sono «MCP e API», «UI e browser»,
  «Runtime e CI», «Acquisizione e snapshot», «Finanza e territori»,
  «Progetti enti e altri dati» e «Politici».
- **Invariante**: non leggere tutti i documenti del repository; apri soltanto la
  sezione pertinente e, da lì, le fonti che elenca.

## MCP e API

- **Quando serve**: per modificare o verificare il server MCP (`src/lib/mcp/`),
  il contratto condiviso delle query, il comportamento di `/api/mcp`,
  l'assistente e la chat (`src/lib/assistant/`, `/api/assistant/`), oppure la
  documentazione pubblica per agenti in `/for-agents`.
- **Fonti iniziali**:
  - [src/lib/mcp/query-schema.ts](../src/lib/mcp/query-schema.ts): schema
    `datasetQuerySchema` condiviso tra MCP, assistente e schede pubbliche.
  - [src/lib/mcp/catalog.ts](../src/lib/mcp/catalog.ts): `datasetCatalog` con i
    soli dataset `active`, filtri ammessi, cautele, fonti e `exampleQuery`.
  - [src/lib/mcp/datasets.ts](../src/lib/mcp/datasets.ts): dispatcher
    `queryPublicDataset` e i rami per dataset.
  - [src/lib/mcp/server.ts](../src/lib/mcp/server.ts): registrazione dei tool
    `list_datasets` e `query_dataset` e delle resource.
  - [src/lib/agent-public-docs.ts](../src/lib/agent-public-docs.ts): renderer
    Markdown per l'indice e le schede dataset di `/for-agents`.
  - [src/app/for-agents/route.ts](../src/app/for-agents/route.ts) e
    [src/app/for-agents/datasets/[dataset]/route.ts](../src/app/for-agents/datasets/%5Bdataset%5D/route.ts):
    route che servono il Markdown renderizzato.
  - [scripts/ci/check-agent-public-docs.mjs](../scripts/ci/check-agent-public-docs.mjs):
    checker deterministico del catalogo pubblico; non è l'endpoint `/api/mcp`.
  - [docs/MCP.md](MCP.md): contratto pubblico, semantica e procedura per nuove
    fonti.
- **Percorso tipico**: per cambiare un filtro leggi prima query-schema e catalogo,
  poi segui il ramo del dataset in `queryPublicDataset`. Per `/for-agents` leggi
  il renderer, poi il checker e il catalogo; non duplicare l'indice.
- **Assistente**: per una task sull'assistente leggi
  [docs/ASSISTENTE.md](ASSISTENTE.md); riusa schema MCP, catalogo ed evidenza,
  propone al massimo due query validate e non persiste testo, chiave o
  conversazione. Quota e provider non si riconfigurano senza richiesta.
- **Confine**: `/api/dati/[dataset]` è il corpus integrato, non un ID del catalogo
  MCP. `/for-agents` serve documentazione Markdown; `/api/mcp` serve Streamable
  HTTP. Non inventare equivalenze fra i tre namespace.
- **Validazione e provenance**: lo schema e il catalogo respingono filtri non
  dichiarati; i rami riusano i moduli di dominio senza duplicare fetch o
  normalizzazione. Zero, dato mancante e cella oscurata restano distinti.
- **Test mirati** (percorsi, non lettura obbligatoria):
  [tests/mcp-datasets.test.mjs](../tests/mcp-datasets.test.mjs),
  [tests/mcp-route.test.mjs](../tests/mcp-route.test.mjs).

## UI e browser

- **Quando serve**: per modificare pagine e route (`src/app/`), i componenti
  (`src/components/`) o il confine pubblico del corpus integrato; per una
  verifica browser di una superficie.
- **Scegli il percorso in base alla fonte**:
  - **Corpus integrato** (`/dati/[dataset]`, esplorazioni del corpus): passa
    sempre da [src/lib/integrated-public-view.ts](../src/lib/integrated-public-view.ts):
    visibilità, cursori, limiti e cancellazione. Le route pubbliche non
    importano i chunk in `src/data/generated/integrated/rows`.
  - **Snapshot tipizzati** (`territori/irpef`, `spese/sanita`, `/enti/...`,
    grafici specifici): usa l'adapter e il contratto del dataset, non il corpus
    integrato. Per IRPEF: [src/lib/mef-irpef-snapshot.ts](../src/lib/mef-irpef-snapshot.ts)
    e [src/lib/data/mef-irpef-contract.ts](../src/lib/data/mef-irpef-contract.ts).
  - **Fonti live** (IPA, OpenBDAP, ricerche): `src/lib/data/source-fetch.ts` e
    `src/lib/data/source-policy.ts` governano accesso e policy; le route
    applicano budget e limiti di concorrenza.
  - **`/politici`**: vedi la sezione «Politici».
  - **Pagine editoriali e atlanti** (`/governi`, `/parlamento`, `/imprese`,
    `/istruzione`): segui il contratto e i componenti della pagina; non
    attraversare il corpus integrato se il dato è uno snapshot tipizzato.
- **Fonti iniziali**:
  - [src/lib/integrated-public-view.ts](../src/lib/integrated-public-view.ts):
    confine pubblico del corpus integrato.
  - [src/lib/integrated-sources.ts](../src/lib/integrated-sources.ts): lettore
    server-only del bundle validato; le route pubbliche non importano i chunk.
  - [docs/UI_HIERARCHY_ARCHITECTURE.md](UI_HIERARCHY_ARCHITECTURE.md):
    gerarchia e contratti delle superfici UI.
  - [.agents/skills/verify-dvns-integrated-sources/SKILL.md](../.agents/skills/verify-dvns-integrated-sources/SKILL.md):
    procedura browser con PID e porta propri della run.
- **Invarianti del corpus integrato**: gli snapshot completi restano sul server e
  i Client Component ricevono soltanto serie e metadati necessari; niente righe
  raw nei Client Component; le route pubbliche del corpus passano da
  `integrated-public-view.ts`, mai dai chunk in
  `src/data/generated/integrated/rows`. Zero, dato mancante e cella oscurata
  restano distinti anche in UI.
- **Controlli** (percorsi):
  [tests/integrated-source-public-view.test.mjs](../tests/integrated-source-public-view.test.mjs),
  [tests/site-navigation.test.mjs](../tests/site-navigation.test.mjs). Una
  modifica UI richiede anche browser a 390/768/1280 px, tastiera, focus, stati di
  errore/caricamento/vuoto, console e overflow (CONTRIBUTING).

## Runtime e CI

- **Quando serve**: per modificare workflow, gate o script CI, riprodurre i
  gate di consegna o verificare il registro degli artifact generati.
- **Fonti iniziali**:
  - [CONTRIBUTING.md](../CONTRIBUTING.md): profili full/quick, job e gate.
  - [scripts/ci/generated-artifacts.json](../scripts/ci/generated-artifacts.json):
    registro che lega ogni artifact a generatore, verifica offline e refresh.
  - [.github/workflows/ci.yml](../.github/workflows/ci.yml): job `static`,
    `security`, `node`, `etl`, `production` e aggregatore `required`.
  - [docs/CAPACITY_AND_INCIDENTS.md](CAPACITY_AND_INCIDENTS.md): picchi e
    capacità, separati dai test deterministici.
- **Invarianti**: `ci:static` include `agent-context:check` e `agent-public:check`; il job `required`
  dipende già dalla fase statica e i workflow non si modificano per questo. In CI
  servono soltanto file tracciati di prodotto: nessun file `.scratch`. Il network
  guard blocca le connessioni non-loopback; un `listen EPERM` è un limite
  d'ambiente, non una regressione, e un gate non si disattiva per un verde.
  Avvio del sito e lettura degli snapshot non richiedono database, Docker o
  credenziali.
- **Controlli** (percorsi):
  [tests/action-pins.test.mjs](../tests/action-pins.test.mjs),
  [tests/vercel-ignore-build.test.mjs](../tests/vercel-ignore-build.test.mjs),
  [tests/runtime-health.test.mjs](../tests/runtime-health.test.mjs),
  [tests/agent-context.test.mjs](../tests/agent-context.test.mjs).

## Acquisizione e snapshot

- **Quando serve**: per importare una fonte, aggiungere o rigenerare uno
  snapshot, toccare il ledger o i contratti dati.
- **Fonti iniziali**:
  - [docs/DATA_IMPORT_STANDARD.md](DATA_IMPORT_STANDARD.md): checklist e scelta
    fra corpus integrato e snapshot tipizzato.
  - [docs/INTEGRATED_SOURCE_LEDGER.md](INTEGRATED_SOURCE_LEDGER.md): prove,
    catalogo, chunk e provenienza del corpus.
  - [scripts/ci/generated-artifacts.json](../scripts/ci/generated-artifacts.json):
    ogni gruppo con generatore, verifica offline e workflow.
  - [.agents/skills/import-dvns-dataset/SKILL.md](../.agents/skills/import-dvns-dataset/SKILL.md):
    procedura operativa di import e checklist PR.
- **Invarianti**: il binario predefinito per fonti tabulari è il corpus integrato
  (headers, celle stringa, evidence, URL, hash); lo snapshot tipizzato resta
  l'eccezione per i tipi forti. Il contratto chiude su schema inatteso, licenza o
  periodo incoerenti, hash diversi, duplicati, importi non validi e
  riconciliazioni rotte; date di riferimento, pubblicazione, osservazione e
  verifica restano campi distinti. Cella vuota, zero osservato e valore assente
  sono diversi; un outlier non si elimina perché insolito.
- **Controlli** (percorsi):
  [tests/integrated-curated-datasets.test.mjs](../tests/integrated-curated-datasets.test.mjs),
  [tests/data-import-standard.test.mjs](../tests/data-import-standard.test.mjs),
  [tests/etl/test_integrated_source_release.py](../tests/etl/test_integrated_source_release.py).
  Esegui ETL e snapshot offline con il network guard (CONTRIBUTING).

## Finanza e territori

- **Quando serve**: per SIOPE, bilanci e stanziamenti, IRPEF/IVA, COFOG,
  pensioni, povertà, BES, PIL e conti nazionali, confronti territoriali.
- **Fonti iniziali**:
  - [src/lib/mcp/catalog.ts](../src/lib/mcp/catalog.ts): id, filtri, unità e
    cautele dichiarate di ogni dataset finanziario e territoriale.
  - [docs/MEF_IRPEF_COMUNALE.md](MEF_IRPEF_COMUNALE.md): perimetro e limiti
    IRPEF comunale.
  - [docs/SIOPE_MUNICIPAL.md](SIOPE_MUNICIPAL.md): pagamenti e incassi di cassa.
  - [docs/ISTAT_REGIONAL_MAP.md](ISTAT_REGIONAL_MAP.md): geografia e perimetri
    territoriali ISTAT.
  - [src/lib/data/eurostat-gdp-contract.ts](../src/lib/data/eurostat-gdp-contract.ts):
    PIL e conti nazionali Eurostat, livelli e variazioni distinti.
- **Invarianti**: pagamenti, stanziamenti, costi di competenza e stock di debito
  sono misure diverse e non si sommano in silenzio; incasso non è accertamento e
  imposta o reddito dichiarato non è gettito riscosso. Anno di dichiarazione e
  anno di imposta restano distinti; perimetri, anni e unità (euro, centesimi,
  migliaia, quote) non si sommano né si confrontano senza dichiararlo. Gli
  aggregati compositi contengono già le loro parti.
- **Controlli** (percorsi):
  [tests/mef-irpef.test.mjs](../tests/mef-irpef.test.mjs),
  [tests/siope-snapshot.test.mjs](../tests/siope-snapshot.test.mjs),
  [tests/eurostat-gdp.test.mjs](../tests/eurostat-gdp.test.mjs),
  [tests/istat-poverta.test.mjs](../tests/istat-poverta.test.mjs).

## Progetti enti e altri dati

- **Quando serve**: per PNRR, OpenCoesione, OpenCUP, ANAC e appalti, IPA, atlanti
  imprese e istruzione, TED, fonti OpenCivitas/ISTAT upstream e i dataset attivi
  non finanziari.
- **Fonti iniziali**:
  - [src/lib/mcp/catalog.ts](../src/lib/mcp/catalog.ts): catalogo active e
    configured con cautele e filtri.
  - [docs/PNRR_PROJECTS.md](PNRR_PROJECTS.md): perimetro e identità dei progetti.
  - [docs/TED_NOTICES.md](TED_NOTICES.md): avvisi e committenti.
  - [src/lib/data/anac-entity-procurement-page.ts](../src/lib/data/anac-entity-procurement-page.ts):
    profili ente e join per codice fiscale e Codice IPA.
  - [src/lib/data/pnrr-childcare-contract.ts](../src/lib/data/pnrr-childcare-contract.ts):
    contratto di uno snapshot PNRR tipizzato.
  - [docs/COMPANY_ATLAS_POC.md](COMPANY_ATLAS_POC.md): atlante imprese e
    vincoli di join.
  - [docs/EDUCATION_ATLAS_POC.md](EDUCATION_ATLAS_POC.md): atlante istruzione
    e vincoli di join.
  - [docs/OPENCIVITAS_2015.md](OPENCIVITAS_2015.md),
    [docs/OPENCIVITAS_2016.md](OPENCIVITAS_2016.md),
    [docs/OPENCIVITAS_2022_RIFIUTI.md](OPENCIVITAS_2022_RIFIUTI.md),
    [docs/OPENCIVITAS_2022_VIABILITA.md](OPENCIVITAS_2022_VIABILITA.md) e
    [docs/OPENCIVITAS_2022_SOCIALE_ASILI.md](OPENCIVITAS_2022_SOCIALE_ASILI.md): fonti
    OpenCivitas e relativi contratti.
  - [docs/research/ISTAT_BES_INNOVAZIONE.md](research/ISTAT_BES_INNOVAZIONE.md)
    e [docs/research/ISTAT_POVERTA_SOGLIA_ASSOLUTA.md](research/ISTAT_POVERTA_SOGLIA_ASSOLUTA.md):
    ricerche ISTAT collegate.
- **Invarianti**: il finanziamento dichiarato non è un pagamento osservato e
  l'attuatore non è la localizzazione; la presenza in OpenCUP non prova
  l'appartenenza al PNRR e più registrazioni per CUP restano conservate. IPA,
  codice fiscale, CIG, CUP e ISTAT mantengono il significato della fonte e un
  nome simile non stabilisce l'identità di un ente. I riferimenti opachi degli
  operatori sono relativi allo snapshot, non identificativi persistenti. Un
  segnale non dimostra spreco, frode o causalità. `opencup_progetto` è
  `configured`: non è annunciato dal catalogo attivo e non va presentato come
  disponibile.
- **Controlli** (percorsi):
  [tests/pnrr-projects.test.mjs](../tests/pnrr-projects.test.mjs),
  [tests/anac-entity-procurement-page.test.mjs](../tests/anac-entity-procurement-page.test.mjs),
  [tests/company-atlas.test.mjs](../tests/company-atlas.test.mjs),
  [tests/education-atlas.test.mjs](../tests/education-atlas.test.mjs),
  [tests/opencivitas-2015-route.test.mjs](../tests/opencivitas-2015-route.test.mjs),
  [tests/opencivitas-2022-rifiuti-route.test.mjs](../tests/opencivitas-2022-rifiuti-route.test.mjs),
  [tests/opencivitas-2022-viabilita-route.test.mjs](../tests/opencivitas-2022-viabilita-route.test.mjs),
  [tests/opencivitas-2022-sociale-asili-route.test.mjs](../tests/opencivitas-2022-sociale-asili-route.test.mjs).

## Politici

- **Quando serve**: per modificare o verificare `/politici`, i profili persona,
  le API politiche o i dati della Repubblica (Camera, Senato, Governo,
  Presidente della Repubblica).
- **Fonti iniziali**:
  - [src/lib/politici-repubblica.ts](../src/lib/politici-repubblica.ts): grafo
    unificato, mappe leggere e modelli di profilo; qui avvengono i join fra
    Camera, Senato, Governo e Presidente.
  - [src/app/politici/page.tsx](../src/app/politici/page.tsx): pagina immersiva
    e componenti del grafo (`repubblica-graph.tsx`, `repubblica-panel.tsx`).
  - [src/app/api/politici/](../src/app/api/politici/): endpoint per profili e
    notizie; [src/app/api/politici/[id]/atti/route.ts](../src/app/api/politici/%5Bid%5D/atti/route.ts)
    serve gli atti Camera/Senato,
    [src/app/api/politici/[id]/voti-tema/route.ts](../src/app/api/politici/%5Bid%5D/voti-tema/route.ts)
    lo storico di voto per tema sulla persona,
    [src/app/api/politici/voti-tema/route.ts](../src/app/api/politici/voti-tema/route.ts)
    la directory cercabile (`vista=storico-voti&tema=…`, filtri `ramo`/`espressi`,
    timeline per anno, atti con elenco F/C/A e trail per parlamentare) e
    [src/app/api/politici/giudiziario/route.ts](../src/app/api/politici/giudiziario/route.ts)
    i procedimenti documentati.
  - [src/lib/politici-host.ts](../src/lib/politici-host.ts): host pubblico,
    header immersive e accordo con il proxy.
  - [src/lib/data/camera-atti-voti-contract.ts](../src/lib/data/camera-atti-voti-contract.ts)
    e [src/lib/data/senato-atti-voti-contract.ts](../src/lib/data/senato-atti-voti-contract.ts):
    contratti degli atti firmati e delle votazioni finali dei due rami.
  - [src/lib/data/parlamento-giudiziario-contract.ts](../src/lib/data/parlamento-giudiziario-contract.ts):
    contratto fail-closed dello snapshot giudiziario curato.
  - [docs/POLITICI.md](POLITICI.md): riferimento operativo rapido per moduli,
    superfici, proxy/host, navigazione e verifiche.
- **Invarianti**: l'identità persona si unifica solo su identificativi ufficiali
  della Camera o su nome verificato per i senatori con incarico di governo; non
  si fonde su somiglianza. Un ritratto mancante resta un monogramma, mai una
  fotografia dedotta. Atti Camera e Senato mantengono fonti e identità di ramo.
  Procedimento, assoluzione, prescrizione e condanna non sono sinonimi; stato,
  grado e fonti restano espliciti. `statusAsOf` e la data dell'ultimo atto documentato e deve
  coincidere con l'ultimo grado registrato, mai con la data dell'articolo che lo
  racconta; `verifiedAt` e la data del nostro ultimo controllo e la pagina mostra
  entrambe. Un procedimento non definitivo non riverificato entro
  `coverage.recheckAfterMonths` mesi viene marcato `da-riverificare` e la pagina lo
  dichiara: il dato fermo non puo presentarsi come attuale. La gerarchia istituzionale mostrata è quella
  costituzionale, non una misura di influenza politica.
- **Controlli** (percorsi):
  [tests/camera-atti-voti-contract.test.mjs](../tests/camera-atti-voti-contract.test.mjs),
  [tests/senato-atti-voti-contract.test.mjs](../tests/senato-atti-voti-contract.test.mjs),
  [tests/politici-atti-route.test.mjs](../tests/politici-atti-route.test.mjs),
  [tests/politici-voti-tema-route.test.mjs](../tests/politici-voti-tema-route.test.mjs),
  [tests/parlamento-giudiziario-contract.test.mjs](../tests/parlamento-giudiziario-contract.test.mjs),
  [tests/parlamento-giudiziario-route.test.mjs](../tests/parlamento-giudiziario-route.test.mjs),
  [tests/politici-news-route.test.mjs](../tests/politici-news-route.test.mjs).
  Per verifiche browser vedi [docs/POLITICI.md](POLITICI.md).
