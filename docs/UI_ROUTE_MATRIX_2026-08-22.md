# Route matrix UI — 22 agosto 2026

Inventario derivato dai 27 `src/app/**/page.tsx` e verificato contro `.next/server/app-paths-manifest.json` sull'HEAD `dd12c01`. Sono escluse API, metadata, asset e pagine interne di errore. Tutte le route condividono `Navigation`, skip-link, footer, font e token del layout root; questa dipendenza rende shell, focus e overflow parte del blast radius di ogni batch.

Gli stati elencati sono raggiungibili dal codice o da fixture già presenti. Uno stato non elencato non va segnato PASS per deduzione.

| Route / fixture | Tipo e domanda primaria | Dati e stati raggiungibili | Componenti condivisi | Rischio |
| --- | --- | --- | --- | --- |
| `/` (`?anno=2026`) | Dashboard: quanto, composizione, dove, trend | Snapshot compilato; anno disponibile/default; mese parziale; metadati opzionali | composizione, mappa, tooltip, tabelle, source cards | P0 |
| `/spese` | Composizione dei pagamenti per voce | anno/default; confronto parziale; quote `n.d.` | period controls, tabelle | P0 |
| `/territori` | Pagamenti per regione, macro-area e pro capite | anno/default; popolazione o pro capite `n.d.` | mappa, tabelle, period controls | P0 |
| `/coesione` | Fondi e progetti: costo, pagamenti, stato e trend | snapshot compilato; valori dimensionali `n.d.` | stat strip, tabelle, grafici | P0 |
| `/consulenza` | Richiesta di contatto | idle, validazione browser, sending, error, success | form, notice | P0 protetto |
| `/controlli` (`?anno=2025`) | Segnali da approfondire e confronti ANAC | tutti gli anni/anno; nessun outlier; confronto assente; scenari senza filtro | filtri, tabelle, disclosure | P1 |
| `/spese/invalidita` | Spesa INPS per invalidità civile | snapshot; serie; dettaglio territoriale; null | stat strip, tabelle | P1 |
| `/spese/sanita` | Costi SSN per personale e servizi | snapshot 2024; metriche/righe `n.d.` | stat strip, tabelle | P1 |
| `/stato` | Spesa statale per missione, amministrazione e natura | mensile/consuntivo; anno valido; not found; errore fonte; totali mancanti | period controls, tabelle, notice | P1 |
| `/stato/amministrazioni/2` | Dettaglio di una amministrazione statale | valido; periodo invalido; errore fonte; valori opzionali | period controls, tabelle | P1 dinamica |
| `/territori/fisco` | Entrate, spese e saldo CPT pro capite | saldo positivo/negativo/null; tabella equivalente | grafico, tabella | P1 |
| `/territori/irpef?anno=2024&livello=regione` | Redditi e imposta per livello territoriale | filtri invalidi; not found; empty; paginazione; valori parziali/soppressi | form filtri, tabella | P1 query |
| `/territori/confronto` | Spesa comunale e fabbisogno standard | ricerca, regione, sort, paginazione, empty, warning | form filtri, tabella | P1 query |
| `/coesione/asili?q=Roma` | Catalogo PNRR fino al CUP | filtri validi/invalidi; empty; paginazione; campi mancanti | filtri, result cards/table | P1 |
| `/progetti/B11B21001610005` | Traccia documentale di un progetto | valido; not found; campi mancanti; nessuna gara; controllo opzionale | evidence cards, timeline/table | P1 dinamica |
| `/enti` | Registro IPA e ricerca enti | iniziale; ricerca; risultati/empty; fonte parziale; statistiche mancanti | ricerca, result cards | P1 |
| `/enti/PCM` | Scheda pubblica IPA | valido; not found; errore fonte; struttura opzionale; “Non indicato” | detail lists, tables | P1 dinamica |
| `/parlamento` | Consuntivi e previsioni della Camera | snapshot; anni/valori non disponibili | period controls, tabelle | P1 |
| `/partecipazioni` | Partecipazioni pubbliche e segnali dichiarati | snapshot compilato | stat strip, tabelle | P1 |
| `/fonti` | Catalogo fonti, copertura e cadenza | statico; data o label aggiornamento | source cards | P2 |
| `/fonti/stato` | Stato operativo e freschezza fonti | raggiungibile/non raggiungibile/sconosciuto; fresh/stale/unknown; dettagli mancanti | status list/cards | P1 live |
| `/metodologia` | Regole per leggere dati e segnali | statico | prose, notice | P2 |
| `/assistente` | Domande sui dataset verificati | empty, loading, answer, help, refusal, invalid, unavailable/error | chat form, status | P1 interattiva |
| `/mcp` | Catalogo MCP, endpoint, filtri e cautele | statico; dataset con/senza fonte/caveat | code blocks, source links | P2 |
| `/privacy` | Informativa privacy | statico | prose | P2 legal |
| `/supporto` | Canali di supporto | statico | prose, links | P2 supporto |
| `/termini` | Termini, responsabilità e licenza | statico | prose | P2 legal |

## Batch e PR

Il batch 0 è già coperto dalla PR UI precedente per `/`, `/coesione` e `/consulenza`. Le altre route sono divise per domanda, componenti e stato; ogni PR contiene solo audit, fix e prove del proprio gruppo.

| Batch | Route | Focus / rischio | Dipendenza |
| --- | --- | --- | --- |
| 1 — dashboard adiacenti | `/spese`, `/territori` | gerarchia dato/composizione/geografia; mappa e period controls | stacked su slice C |
| 2 — spesa | `/spese/invalidita`, `/spese/sanita`, `/stato`, `/stato/amministrazioni/2` | unità, periodi, tabelle dense, stato errore | batch 1 solo se usa primitive nuove |
| 3 — territori query | `/territori/fisco`, `/territori/irpef`, `/territori/confronto` | filtri, empty/partial, paginazione, benchmark | indipendente salvo token |
| 4 — progetti ed enti | `/coesione/asili`, `/progetti/B11B21001610005`, `/enti`, `/enti/PCM` | lookup, prove, campi mancanti, route dinamiche | dipende dalla shell soltanto |
| 5 — controllo civico | `/controlli`, `/parlamento`, `/partecipazioni` | fatto vs segnale, denominatori, anni | dipende dalla shell soltanto |
| 6 — fonti e strumenti | `/fonti`, `/fonti/stato`, `/metodologia`, `/assistente`, `/mcp` | freschezza, live/error, code overflow, chat states | separare assistente se richiede fix ampi |
| 7 — legal e supporto | `/privacy`, `/supporto`, `/termini` | leggibilità della prosa, link e footer | può essere audit-only |

## Contratto di esecuzione per batch

1. Fetch di `origin/main`, verifica di `acbc271` come antenato e scansione privacy prima di ogni push.
2. Build dell'HEAD e manifest con route/fixture, browser, viewport, tema, locale e stati.
3. Full-page 390×844 e 1280×1000 per ogni route; divisione matematica dell'intera altezza in S1–S4 contigue, senza gap o overlap.
4. Due revisori Luna ciechi e indipendenti vedono rendering e criteri, non la motivazione della soluzione.
5. Per ogni fascia: Observation, Impact, Rule strength, Decision, Acceptance criteria, Proof e PASS/FAIL/BLOCKED/NOT VERIFIED.
6. Un solo batch di fix e al massimo una conferma. Un fallimento residuo resta dichiarato.
7. Prove oggettive prevalgono sui giudizi soggettivi. Tema dark è N/A finché non esiste; stati non raggiungibili sono N/A o NOT VERIFIED, mai PASS inventati.
8. Se l'HEAD cambia, si ricatturano almeno le fasce nel blast radius. Treemap solo per composizioni additive complete, sempre con equivalente tabellare e fallback mobile.
