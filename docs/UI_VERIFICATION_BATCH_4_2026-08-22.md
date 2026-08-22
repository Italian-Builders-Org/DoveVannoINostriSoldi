# Verifica UI batch 4 — Progetti ed enti

Base iniziale: HEAD `361953c`, build locale, 390×844 e 1280×1000, tema light e italiano. Dark N/A: il prodotto non offre un tema scuro. Ogni full-page è divisa matematicamente in S1–S4 contigue e copre il 100% dell’altezza. Prove iniziali: `.audit/batch-4-initial/`; conferma sull’HEAD modificato: `.audit/batch-4-confirmation/`.

Due revisori Luna xhigh, ciechi rispetto alla soluzione e indipendenti, hanno valutato le 32 fasce. Accordo: la traccia CUP e il registro Enti sono leggibili; Asili non dichiarava vicino ai KPI che valori, fonte e data descrivono l’intero archivio; la struttura IPA richiedeva una verifica dinamica perché la cattura mobile aveva raggiunto il fallback mentre il desktop era filled. Disaccordo: un revisore ha considerato la densità delle card Asili un rischio lieve, l’altro l’ha accettata; un revisore ha riaperto la nav mobile. Le misure prevalgono: la nav è uno scroller intenzionale con “SCORRI →” già coperto dal test; le card mobile perdono comunque l’altezza minima desktop perché 1.018 px erano solo spazio vuoto.

Ogni Observation considera comprensione in 5 secondi, priorità del dato, linguaggio, gerarchia in scala di grigi, densità/keyline, colore ridondante, leggibilità, periodo/perimetro/denominatore, reflow e overflow. Focus e tastiera sono provati dal browser E2E, non dedotti dalle immagini.

## `/coesione/asili?q=Roma`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof dopo fix | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Titolo, ricerca, quattro KPI e risultati sono chiari. Inizialmente i KPI globali sembravano riferiti ai 319 risultati filtrati; ora “Intero archivio” espone 3.841 CUP, misura, data e fonte. | Evita un denominatore implicito e un confronto di perimetri diversi. | MUST fonte/periodo/denominatore. | Aggiungere riga di perimetro adiacente ai KPI. | Archivio, misura, data e link ufficiale visibili prima dei valori. | `asili-mobile-s1.png`; manifest 390 px, CLS 0. | PASS |
| Mobile | S2 | Card a una colonna con CUP, stato testuale, luogo, importo, gare, aggiudicatari e CTA; l’altezza minima desktop è rimossa. | Riduce scorrimento privo d’informazione senza perdere campi. | SHOULD densità; MUST integrità. | Altezza guidata dal contenuto sotto 650 px. | Tutti i campi presenti, nessun clipping, card non forzata a 330 px. | `asili-mobile-s2.png`. | PASS |
| Mobile | S3 | Titoli lunghi e stati validato/non validato vanno a capo; il colore è ridondato dal testo. | Lettura stabile in grigio e su schermo stretto. | MUST reflow/colore. | Nessun altro fix. | Nessun titolo o valore tronco. | `asili-mobile-s3.png`. | PASS |
| Mobile | S4 | Ultime card, paginazione, caveat ReGiS e footer coprono la chiusura. | Limiti e totalità della pagina restano raggiungibili. | MUST limiti/fonte. | Nessun altro fix. | Paginazione e caveat presenti; root entro 390 px. | `asili-mobile-s4.png`; manifest. | PASS |
| Desktop | S1 | Hero, ricerca, perimetro archivio, KPI e inizio risultati creano una progressione overview→lookup. | Comprensione in 5 secondi e perimetro verificabile. | MUST/SHOULD. | Riga fonte/perimetro sopra i KPI. | 3.841 CUP, M4C1I1.01.00, 13 giugno 2026 e Italia Domani visibili. | `asili-desktop-s1.png`. | PASS |
| Desktop | S2 | Griglia a tre colonne mantiene card uniformi, keyline e metriche allineate. | Confronto rapido tra progetti. | SHOULD densità. | Conservare altezza coerente desktop. | Titolo, luogo e metriche non collidono. | `asili-desktop-s2.png`. | PASS |
| Desktop | S3 | Le card continuano con schema stabile e badge testuali. | Nessuna dipendenza dal colore. | MUST colore ridondante. | Nessun fix. | Stato sempre scritto accanto alla tinta. | `asili-desktop-s3.png`. | PASS |
| Desktop | S4 | Paginazione e caveat separano finanziamento, gara e pagamento prima del footer. | Riduce conclusioni improprie. | MUST evidence boundary. | Nessun fix. | ReGiS mancante dichiarato e non stimato. | `asili-desktop-s4.png`. | PASS |

Stati: risultati filled PASS. Filtro valido e paginazione coperti dal browser E2E; empty e filtro invalido presenti nel codice ma NOT VERIFIED visualmente. Loading N/A per la pagina server-rendered. Dark N/A.

## `/progetti/B11B21001610005`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | CUP, stato, titolo, localizzazione e legenda osservato/collegato/derivato/mancante sono leggibili senza affidarsi al colore. | La provenienza di ogni livello è immediata. | MUST evidenza. | Nessun fix. | Badge con testo e breadcrumb visibili. | `progetto-mobile-s1.png`; CLS 0. | PASS |
| Mobile | S2 | Quattro valori, caveat, soggetto attuatore e tempi si impilano senza overflow. | Finanziamento, gara, aggiudicazione e pagamento non si confondono. | MUST semantica/reflow. | Nessun fix. | Origine adiacente a ogni valore; date complete. | `progetto-mobile-s2.png`. | PASS |
| Mobile | S3 | Otto gare conservano CIG, descrizione e importo; titoli lunghi vanno a capo. | Lookup completo su mobile. | MUST integrità. | Nessun fix. | Nessun codice o importo tagliato. | `progetto-mobile-s3.png`. | PASS |
| Mobile | S4 | OpenBDAP, fonte primaria, estrazione, licenza, chiavi e limiti CUP precedono il footer. | Tracciabilità completa. | MUST fonte/perimetro. | Nessun fix. | Fonte, data e caveat sulle localizzazioni raggiungibili. | `progetto-mobile-s4.png`. | PASS |
| Desktop | S1 | Titolo dominante, CUP, stato e localizzazione sono netti; la legenda completa la prima fascia. | Comprensione rapida. | MUST/SHOULD. | Nessun fix. | Gerarchia stabile in scala di grigi. | `progetto-desktop-s1.png`. | PASS |
| Desktop | S2 | Quattro livelli e due pannelli separano importi, soggetto e validazione. | Evita scorciatoie causali. | MUST evidence boundary. | Nessun fix. | Valori e badge riconciliabili testualmente. | `progetto-desktop-s2.png`. | PASS |
| Desktop | S3 | Elenco gare ordinato con CIG, oggetto e importo su keyline coerenti. | Scansione precisa. | SHOULD densità. | Nessun fix. | Colonne leggibili e numeri tabulari. | `progetto-desktop-s3.png`. | PASS |
| Desktop | S4 | MOP e fonte/limiti chiudono la traccia con link ai dati. | Provenienza verificabile. | MUST fonte. | Nessun fix. | Data 13 giugno 2026, licenza e chiavi presenti. | `progetto-desktop-s4.png`. | PASS |

Stati: CUP valido/filled PASS. Not found, campi mancanti e gara assente sono supportati ma NOT VERIFIED visualmente in questo batch. Il pagamento mancante è PASS perché rappresentato esplicitamente. Dark N/A.

## `/enti`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Titolo, periodo 2023, pubblicazione 2026, cinque KPI, ricerca e inizio ministeri si impilano correttamente. | Perimetro e azione primaria chiari. | MUST metadati/reflow. | Nessun fix. | KPI e ricerca entro 390 px. | `enti-mobile-s1.png`; manifest. | PASS |
| Mobile | S2 | Nomi ministeriali lunghi, categoria e codice IPA restano leggibili. | Nessuna perdita di identità. | MUST integrità. | Nessun fix. | Tre colonne conservate senza clipping. | `enti-mobile-s2.png`. | PASS |
| Mobile | S3 | Grafico IPA ha equivalente tabellare; dichiarazioni e società mostrano valori esatti. | Colore non essenziale e lookup disponibile. | MUST equivalente. | Nessun fix. | Disclosure dati raggiungibile da tastiera. | `enti-mobile-s3.png`; E2E. | PASS |
| Mobile | S4 | Società, fonti, identificativo, licenza e periodo partecipazioni chiudono la pagina. | Provenienza completa. | MUST fonte. | Nessun fix. | Link AgID/MEF e licenza visibili. | `enti-mobile-s4.png`. | PASS |
| Desktop | S1 | Titolo, anno, KPI, ricerca e tabella ministeri sono allineati e leggibili in 5 secondi. | Priorità forte. | MUST/SHOULD. | Nessun fix. | Periodo e significato dei conteggi presenti. | `enti-desktop-s1.png`. | PASS |
| Desktop | S2 | Ministeri completi e inizio grafico/dichiarazioni mantengono keyline e unità. | Scansione coerente. | SHOULD densità. | Nessun fix. | Codici e categorie allineati. | `enti-desktop-s2.png`. | PASS |
| Desktop | S3 | Grafico e tabella società proseguono; rimane spazio vuoto P3 accanto al grafico più corto. | Squilibrio lieve, nessuna perdita dati. | Euristica P3. | Nessun fix nel solo round. | Dati e equivalente tabellare restano associati. | `enti-desktop-s3.png`. | PASS |
| Desktop | S4 | Ultime società e fonti riempiono la chiusura senza overflow. | Auditabilità completa. | MUST fonte. | Nessun fix. | File ID, licenza e link ufficiali presenti. | `enti-desktop-s4.png`. | PASS |

Stati: overview filled PASS. Ricerca, risultati ed errore della ricerca rapida sono coperti dal browser E2E; empty della pagina registro NOT VERIFIED visualmente. Dark N/A.

## `/enti/PCM`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Titolo, codice, data, categoria, sito e identità amministrativa reflowano senza clipping. | Identità e freschezza immediate. | MUST metadati. | Nessun fix. | Codice e aggiornamento visibili. | `ente-mobile-s1.png`. | PASS |
| Mobile | S2 | Conferma filled: 207 UO, 58 AOO e prime unità con codici. Il baseline aveva raggiunto il fallback ufficiale, con identità conservata e nessuna gerarchia inventata. | Entrambi gli stati sono espliciti; nessuna dipendenza dal breakpoint. | MUST stato/error boundary. | Verifica dinamica bounded, nessun cambio dati. | Richieste alternate mobile/desktop coerenti; fallback non trasforma l’assenza in zero. | `ente-mobile-s2.png`; baseline error + conferma filled. | PASS |
| Mobile | S3 | La struttura prosegue con nomi e codici; la lunghezza è alta ma i valori restano completi. | Lookup disponibile, costo di scansione elevato. | SHOULD densità. | Nessun fix nel solo round. | Nessun overflow e limite 24 dichiarato. | `ente-mobile-s3.png`. | PASS |
| Mobile | S4 | Contatti, collegamenti, fonte, licenza, data e API JSON chiudono la pagina. | Provenienza e limiti raggiungibili. | MUST fonte. | Nessun fix. | Nessun valore economico inferito. | `ente-mobile-s4.png`. | PASS |
| Desktop | S1 | Identità e metadati fonte affiancano riepilogo e inizio struttura. | Contesto forte. | MUST fonte/metadati. | Nessun fix. | Data e titolare visibili. | `ente-desktop-s1.png`. | PASS |
| Desktop | S2 | La struttura continua nella colonna principale mentre la colonna fonte termina; resta vuoto P3. | Squilibrio visuale, nessuna perdita o ambiguità. | Euristica P3. | Nessun fix nel solo round. | Tabella integra e nessun overflow. | `ente-desktop-s2.png`. | PASS |
| Desktop | S3 | Le 24 unità mantengono schema UO/codice/AOO e keyline. | Lookup preciso. | MUST integrità. | Nessun fix. | Nomi lunghi e codici completi. | `ente-desktop-s3.png`. | PASS |
| Desktop | S4 | Dataset, limite 24, contatti, collegamenti e footer chiudono la scheda. | Trasparenza su copertura e assenza di stime. | MUST fonte/limiti. | Nessun fix. | Limit/offset e link ufficiali presenti. | `ente-desktop-s4.png`. | PASS |

Stati: struttura filled PASS e fallback upstream PASS su mobile; quattro richieste alternate hanno escluso una dipendenza dal viewport. Errore totale della scheda, not found e loading: NOT VERIFIED visualmente. Dark N/A.

## Before | After | Why

| Before | After | Why |
| --- | --- | --- |
| Quattro KPI globali adiacenti a 319 risultati filtrati senza denominatore esplicito | “Intero archivio: 3.841 CUP”, misura, data e fonte prima dei KPI | Separa copertura del dataset dal totale della ricerca corrente |
| Card Asili mobile forzate a 330 px anche con contenuto breve | Altezza naturale sotto 650 px; griglia desktop invariata | Elimina 1.018 px di spazio non informativo mantenendo ogni campo |
| Fallback IPA mobile e filled desktop potevano sembrare una regressione responsive | Baseline conserva l’errore reale; conferma e quattro richieste alternate provano lo stato filled su entrambi gli user agent | Distingue stato esterno transitorio da comportamento del layout |

## Prove eseguite

- PASS: 80 immagini tra baseline e conferma, full-page e S1–S4, viewport esatti, CLS 0 e nessun errore runtime.
- PASS: 269/269 test Node, lint, typecheck e build Next.js 16.3.1 (37 pagine).
- PASS: browser E2E canonico, inclusi catalogo/CUP a 320/390/768/1280, navigazione, focus, shell e form Consulenza. La prima esecuzione ha trovato un selettore stale nel test del dettaglio Stato; la seconda e ultima, corretta sul ruolo accessibile reale, è PASS.
- PASS: diagnosi bounded IPA, quattro richieste alternate mobile/desktop tutte filled.
- NOT VERIFIED: tema dark non supportato, audit assistivo completo e stati non raggiungibili elencati sopra.
