# Server MCP

## Scopo

Il server MCP espone i dati pubblici già disponibili nel portale attraverso un contratto unico, read-only ed estensibile. Non sostituisce provenance, metodologia o cautele: le restituisce insieme ai dati.

La prima interfaccia testuale deterministica del portale è documentata separatamente in
[ASSISTENTE.md](ASSISTENTE.md): non è un provider LLM e non inoltra prompt al server MCP.

L'endpoint Streamable HTTP canonico è `/api/mcp`. `POST /mcp` e `OPTIONS /mcp` sono alias compatibili, mentre `GET /mcp` resta la pagina di presentazione: un client configurato con il percorso breve non riceve quindi un 405. L'implementazione usa l'SDK TypeScript ufficiale e mantiene compatibilità stateless con i client MCP della generazione precedente.

Le procedure per collegare l'endpoint esistente a Manufact, ChatGPT e Claude, insieme a starter
prompt e casi di review, sono in [MCP_DISTRIBUTION.md](MCP_DISTRIBUTION.md). L'endpoint canonico non
va duplicato su un secondo runtime.

## Superficie pubblica

- Tool `list_datasets`: catalogo completo con identificativo stabile, filtri, freschezza e caveat.
- Tool `query_dataset`: query tipizzata; `limit` e `offset` sono accettati soltanto dagli adapter
  che li dichiarano nel catalogo, con limite massimo di 100 record per pagina.
- Le risposte dei tool sono limitate a 750.000 byte UTF-8; una query che supera il budget restituisce `response_too_large` invece di produrre un payload non delimitato.
- Resource `dvns://datasets`: copia JSON del catalogo.
- Resource `dvns://related-mcp-services`: endpoint pubblici complementari, separati dagli adapter
  DVNS e mai inoltrati automaticamente.
- Capability `prompts`: i cinque starter prompt della distribuzione (`docs/MCP_DISTRIBUTION.md`)
  sono esposti anche via `prompts/list` e `prompts/get`, che resta la fonte unica dei testi.

I dataset live interrogano soltanto adapter ufficiali già usati dalle API del sito. I dataset snapshot leggono gli artefatti versionati e validati dagli ETL.

`anac_cig_snapshot` espone la replica aggregata e verificata dei dodici file CIG 2025: copertura, hash, conteggi, procedure, fasce di importo e limiti interpretativi. Non simula una ricerca live per CIG o fornitore. `pnrr_asili` espone il verticale Italia Domani per CUP e accetta `cup`, `query`, `region`, `province`, `limit` e `offset`; restituisce sempre provenienza e avvertenza che il finanziamento non è un pagamento. `inps_invalidita_civile` espone spesa nazionale, stock e nuove pensioni regionali mantenendo distinti perimetro, unità e copertura. Non espone dati comunali o individuali. `inps_pensioni_vigenti` espone lo stock delle pensioni erogate dall'INPS al 1 gennaio 2026, la composizione per natura, categoria e gestione, e la serie dei conteggi 2012-2026. Non lo somma al Casellario ISTAT. `cpt_finanza_regionale` espone entrate, spese e saldo contabile territorializzato della PA consolidata, includendo formula, semantica del segno, popolazione, metodologia e hash delle distribuzioni. Non lo denomina residuo fiscale. `mef_irpef_comunale` restituisce Regioni, Province o Comuni paginati del rilascio 2024, mantiene espliciti segreto statistico e riga non attribuita e chiama la misura soltanto “imposta netta dichiarata”. Non la combina con CPT e non espone il file comunale completo. `opencoesione_progetti` espone anche indicatori derivati ricostruibili per tema, natura e stato; media per progetto e rapporto pagamenti/costo conservano sempre le relative cautele.

`siope_comuni` espone aggregati regionali completi entro il join IPA, le liste nazionali limitate
ai primi 100 Comuni per totale o pro capite e, dopo un refresh raw verificato, `distribution`: un
riepilogo senza righe comunali con quota nazionale, fasce dimensionali, regioni e quantili
nearest-rank pesati per Comune o residenti. Una query con filtro `region` non restituisce la
distribuzione nazionale: usa l'aggregato regionale in `regions` e dichiara sia il limite delle liste
parziali sia, in `queryLimitations.regionAggregateCoverage`, i Comuni e l'importo nazionale non
regionalizzabili. I quantili non vanno ricostruiti dai primi 100 e non sono classifiche di
efficienza o spreco.

`openbdap_ssn_conto_economico` restituisce il dataset snapshot OpenBDAP `spd_ssn_cce_elb_voccn_01_2024`.
Le voci `BA2080`, `BA1350`, `BA1750`, `BA0390` e `BZ9999` sono mantenute con codice e descrizione
ufficiali; gli importi sono costi di competenza economica del Conto Economico consuntivo, non
pagamenti di cassa. La risposta include aggregati nazionali, per codice geografico ufficiale e
per ente con chiave composita, oltre a provenienza, hash e copertura. La provenienza espone tre
input distinti (enti, nazionale e regionale), ciascuno con landing URL e SHA-256. `selectedAggregate`
indica esplicitamente il contesto: `national` senza filtri, `region` con il solo filtro regione e
`entity_match` quando è presente un codice ente, anche se accompagnato da una regione (in
quest'ultimo caso non viene inventato un aggregato). Il codice viene normalizzato una sola volta e
i limiti REST/MCP impediscono risposte non paginabili.
Le voci di consulenze,
collaborazioni, interinale e altre prestazioni di lavoro non vengono rinominate “gettonisti” o
“cooperative”, e il tool non produce classifiche di efficienza o giudizi sulla qualità sanitaria.

## Federazione senza proxy

Il servizio MCP di [Cruscotto Italia](https://cruscotto-italia.dati.gov.it/about.html#accesso-mcp),
gestito da AgID, è registrato come servizio correlato all'indirizzo:

```text
https://cruscotto-italia-mcp.agid.workers.dev/mcp
```

È utile per dati ricomposti per Comune e codice ISTAT. Non è una fonte primaria né un adapter
DVNS: il nostro server non inoltra richieste al Worker AgID, non assume la sua disponibilità e non
fonde automaticamente i suoi aggregati con i nostri. Questa separazione evita costi di proxy,
timeout concatenati, doppia cache e provenance ambigua.

Il client deve scoprire tool e versione al momento della connessione. La sequenza più economica in
token è `search_comune` → `comune_kpi`; `comune_dashboard` è riservato alle richieste che richiedono
array e serie di dettaglio. Copertura, licenza e aggiornamento restano quelli dichiarati dal
servizio e dalle singole fonti. L'implementazione è nel
[repository ufficiale AgID](https://github.com/AgID/cruscotto-italia).

## Aggiungere una fonte

1. Integrare e validare la fonte secondo `docs/ARCHITECTURE.md`.
2. Aggiungere un identificativo stabile a `DATASET_IDS` in `src/lib/mcp/catalog.ts`.
3. Aggiungere il descrittore a `datasetCatalog`, compresi filtri e caveat.
4. Implementare il ramo dell'adapter in `src/lib/mcp/datasets.ts`, riusando il modulo di dominio senza duplicare fetch o normalizzazione.
5. Aggiungere test offline per filtri, limiti, paginazione e semantica.
6. Verificare `tools/list` e almeno una `tools/call` sul server Next.js avviato localmente.

Un adapter non deve accettare URL arbitrari, SQL, percorsi file o nomi di funzione dal client. Gli input devono essere enum o campi di dominio con lunghezza e intervalli limitati.

## Sicurezza e privacy

- Nessun tool modifica dati o avvia refresh.
- Nessuna credenziale di ingestione passa al client.
- Il body HTTP dichiarato è limitato a 1 MB.
- Se `Origin` è presente, deve coincidere con l'origine del deployment o con una voce esplicita in `MCP_ALLOWED_ORIGINS`.
- Le richieste browser ricevono una preflight CORS solo per origini autorizzate. La superficie HTTP pubblica è intenzionalmente stateless e limitata a `POST` e `OPTIONS`; non espone sessioni SSE tramite `GET` o `DELETE`.
- In produzione gli host pubblici ammessi vanno dichiarati, separati da virgola, in `MCP_ALLOWED_HOSTS`. Su Vercel vengono considerati anche `VERCEL_PROJECT_PRODUCTION_URL` e `VERCEL_URL`.
- Ogni dataset accetta soltanto i filtri dichiarati nel catalogo. Un filtro incompatibile produce un errore esplicito e non viene ignorato.
- Le risposte non sono memorizzate in cache condivise dal route handler MCP.
- L'autenticazione MCP non è richiesta finché la superficie resta composta esclusivamente da dati pubblici e operazioni read-only. Prima di introdurre dati privati o mutazioni occorre aggiungere OAuth 2.1 e Protected Resource Metadata.

## Limiti operativi

Le fonti live possono essere indisponibili o lente. In quel caso il tool restituisce un errore esplicito e non sostituisce il dato con valori simulati. I limiti e le date di riferimento delle singole fonti restano quelli documentati nel catalogo del portale.

Il route handler abortisce la richiesta dopo 12 secondi e dichiara `maxDuration` 15, così un client che ritenta dopo un timeout non brucia 60 secondi di compute a colpo. Un limitatore in memoria (30 POST al minuto per IP, solo se `X-Forwarded-For` è presente) e un bulkhead da 8 richieste frenano i burst sulla stessa istanza: non sono un tetto globale. Su Vercel è attiva una regola WAF equivalente per `POST /api/mcp` e `POST /mcp`; `HEAD` e `OPTIONS` restano esclusi per non rompere discovery e preflight. I test di carico ordinari usano concorrenza 6 e restano sotto il cap, mentre il limite esatto `30 + 1` è verificato dalla suite della route. La configurazione segue la [documentazione WAF ufficiale](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules).
