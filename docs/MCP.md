# Server MCP

## Scopo

Il server MCP espone i dati pubblici già disponibili nel portale attraverso un contratto unico, read-only ed estensibile. Non sostituisce provenance, metodologia o cautele: le restituisce insieme ai dati.

L'endpoint Streamable HTTP è `/api/mcp`. L'implementazione usa l'SDK TypeScript ufficiale e mantiene compatibilità stateless con i client MCP della generazione precedente.

## Superficie pubblica

- Tool `list_datasets`: catalogo completo con identificativo stabile, filtri, freschezza e caveat.
- Tool `query_dataset`: query tipizzata con limite massimo di 100 record per pagina.
- Resource `dvns://datasets`: copia JSON del catalogo.

I dataset live interrogano soltanto adapter ufficiali già usati dalle API del sito. I dataset snapshot leggono gli artefatti versionati e validati dagli ETL.

`anac_cig_snapshot` espone la replica aggregata e verificata dei dodici file CIG 2025: copertura, hash, conteggi, procedure, fasce di importo e limiti interpretativi. Non simula una ricerca live per CIG o fornitore. `opencoesione_progetti` espone anche indicatori derivati ricostruibili per tema, natura e stato; media per progetto e rapporto pagamenti/costo conservano sempre le relative cautele.

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

Il rate limiting va applicato a livello edge o con uno storage distribuito: una mappa in memoria nel processo non garantirebbe limiti coerenti in un deployment serverless. Allo stesso modo, prima di ampliare gli adapter live con catene di fetch più costose va introdotto un budget temporale complessivo propagato tramite `AbortSignal`, oltre ai timeout delle singole fonti già presenti.
