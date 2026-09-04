# Architettura

DVNS rende leggibili i dati pubblici mantenendo fonte, periodo, perimetro e
limiti contabili. È un'applicazione Next.js App Router: pagine server,
componenti interattivi React, route HTTP e un endpoint MCP in sola lettura.
Non richiede un database locale, Docker o un servizio di ingestione per avviarsi.

## Dove passa il dato

1. **Acquisizione**: `scripts/etl/` legge le fonti ufficiali. Source lock e
   specifiche in `scripts/etl/specs/` definiscono input, licenze e perimetri.
2. **Snapshot**: `src/data/generated/` contiene gli artifact versionati insieme
   al codice. Il registro `scripts/ci/generated-artifacts.json` collega ciascun
   gruppo a generatore, verifica offline e workflow di refresh.
3. **Contratti**: `src/lib/data/*-contract.ts` e i contratti specifici degli
   atlanti validano gli artifact prima del consumo. Controlli Python e
   TypeScript proteggono confini diversi: trasformazione e pubblicazione.
4. **Lettura e aggregazione**: i moduli in `src/lib/` espongono le viste usate da
   pagine, API e adapter MCP. Le query pubbliche limitano filtri e paginazione.
5. **Presentazione**: `src/app/` contiene pagine e API, `src/components/` i
   componenti condivisi. Gli snapshot completi restano sul server; i Client
   Component ricevono le serie e i metadati necessari alla visualizzazione.

## Tre percorsi di lettura

- **Snapshot tipizzati**, per esempio SIOPE, IRPEF, sanità e debito: un adapter
  valida il dato versionato e fornisce aggregazioni coerenti a UI, API e MCP.
  IRPEF riconcilia Comune → Provincia → Regione e mantiene le celle oscurate.
- **Corpus integrato**: `integrated-sources.ts` verifica prove, catalogo e chunk
  compressi. `integrated-public-view.ts` è il confine pubblico: applica
  visibilità, cursori, limiti e cancellazione. `data/source-ledger/` lega gli
  artifact a hash, ricevute e provenienza. Non aggirare questo percorso
  importando direttamente i chunk in una route.
- **Fonti live**, soprattutto IPA e OpenBDAP: `data/source-fetch.ts` e
  `data/source-policy.ts` governano accesso e policy; gli adapter gestiscono
  parsing e cache. Le route applicano budget e limiti di concorrenza. Un errore
  della fonte deve restare visibile, senza trasformarsi in zero o successo.

`src/lib/mcp/catalog.ts` descrive i dataset; `datasets.ts` li collega alle
funzioni di dominio. `/api/mcp` espone Streamable HTTP. `POST /mcp` e
`OPTIONS /mcp` sono alias supportati; `GET /mcp` resta la pagina informativa.
L'assistente in `src/lib/assistant/` usa intenti deterministici sugli snapshot.

## Invarianti

- Pagamenti, stanziamenti, costi previsti e stock di debito sono misure diverse.
- Zero, assenza di dato e valore oscurato restano distinti.
- Date di riferimento, pubblicazione, osservazione e ingestione non si scambiano.
- IPA, codice fiscale, CIG, CUP e ISTAT mantengono il significato della fonte.
  Un nome simile non basta a stabilire l'identità di un ente.
- Hash, licenza, copertura, duplicati e riconciliazioni fanno parte del contratto.
  Un outlier non si elimina soltanto perché è insolito.
- Un segnale non dimostra colpa, frode, spreco o causalità politica.
- Cancellazione, timeout e cache condivise devono preservare l'isolamento dei
  chiamanti e liberare gli slot anche in caso di errore.

## Storage e verifica

La decisione attuale è [Git per gli artifact del prodotto](architecture/ADR-001-generated-artifacts-storage.md).
PostgreSQL e object storage sono eventuali evoluzioni, non dipendenze presenti.
Le credenziali dei refresh e dell'App GitHub per le segnalazioni sono soltanto
server-side; l'avvio locale non le richiede.

Per setup, test mirati, build, browser e worktree vedi
[CONTRIBUTING.md](../CONTRIBUTING.md). Per una nuova fonte parti dallo
[standard di import](DATA_IMPORT_STANDARD.md); per significato e limiti dei dati
vedi [principi legali ed etici](LEGAL_AND_ETHICS.md).
