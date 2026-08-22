# Verifica UI batch 3 — Fisco territoriale

Base iniziale: HEAD `7d95812`, build locale, 390×844 e 1280×1000, tema light e italiano. Dark N/A: il prodotto non offre un tema scuro. Ogni full-page è divisa matematicamente in S1–S4 contigue e copre il 100% dell’altezza. Prove iniziali: `.audit/batch-3-initial/`; conferma di Fisco e Confronto: `.audit/batch-3-confirmation/`; ricattura IRPEF sull’HEAD finale: `.audit/batch-3-final-head/`.

Due revisori Luna xhigh, ciechi rispetto alla soluzione e indipendenti, hanno valutato le 24 fasce. Accordo: le tre viste desktop sono leggibili; IRPEF spiega già la tabella larga; Fisco e Confronto su mobile mostravano solo le prime colonne senza un segnale visibile. Disaccordo: un revisore ha segnalato il taglio della navigazione mobile; la misura e il comportamento già verificato mostrano invece una barra intenzionalmente scorrevole con “SCORRI →”, quindi non è stato riaperto in questa slice. Le misure oggettive di overflow, focus e scorrimento prevalgono sui giudizi soggettivi.

Ogni Observation considera comprensione in 5 secondi, priorità del dato, linguaggio, gerarchia in scala di grigi, densità/keyline, colore ridondante, leggibilità, periodo/perimetro/denominatore, reflow e overflow. Focus e tastiera sono provati dal browser E2E, non dedotti dalle immagini.

## `/territori/fisco`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof dopo fix | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Titolo semplice, anno, fonte e tre KPI precedono il contesto; unità e natura pro capite sono esplicite. | Prima lettura comprensibile senza colore. | MUST perimetro; SHOULD gerarchia. | Nessun fix. | Fonte, periodo, unità e perimetro nel primo tratto. | `fisco-mobile-s1.png`; manifest 390 px, CLS 0. | PASS |
| Mobile | S2 | Barre e tabella distinguono entrate, spese e saldo; inizialmente mancava un invito visibile alle colonne laterali, ora presente. | Evita di scambiare la prima colonna per il record completo. | MUST accesso dati/reflow. | Aggiungere istruzione mobile, conservando i valori esatti. | Hint visibile; regione focalizzabile; ArrowRight, Fine e Inizio funzionanti. | `fisco-mobile-s2.png`; E2E. | PASS |
| Mobile | S3 | La tabella prosegue con righe regolari e valori raggiungibili nello scroll locale; nessun overflow pagina. | Lookup completo su schermo stretto. | MUST overflow; SHOULD densità. | Nessun ulteriore fix. | Root entro 390 px e colonne raggiungibili. | `fisco-mobile-s3.png`; manifest. | PASS |
| Mobile | S4 | Caveat sul consolidato CPT, fonte ufficiale, download e footer chiudono la pagina. | Limita interpretazioni improprie del saldo. | MUST fonte/limiti. | Nessun fix. | Fonte, periodo e perimetro restano raggiungibili. | `fisco-mobile-s4.png`. | PASS |
| Desktop | S1 | Titolo, metadati e KPI guidano subito alla lettura per residente; gerarchia stabile in grigio. | Comprensione in 5 secondi. | MUST/SHOULD. | Nessun fix. | Nessuna dipendenza dal colore o collisione. | `fisco-desktop-s1.png`. | PASS |
| Desktop | S2 | Grafico e tabella offrono confronto visivo e valori esatti con intestazioni allineate. | Scansione e verifica rapide. | MUST equivalente testuale. | Nessun fix. | Barre ridondanti con testo; tabella completa. | `fisco-desktop-s2.png`; E2E focus. | PASS |
| Desktop | S3 | Le righe territoriali mantengono ritmo e numeri tabulari; l’istruzione mobile resta nascosta. | Densità adatta al lookup. | SHOULD densità. | Nessun fix. | Nessun overflow desktop inatteso. | `fisco-desktop-s3.png`; E2E. | PASS |
| Desktop | S4 | Limiti, fonte e footer sono separati dal dettaglio tramite keyline e spazio. | Provenienza verificabile. | MUST fonte. | Nessun fix. | Link ufficiali e caveat visibili. | `fisco-desktop-s4.png`. | PASS |

Stati: snapshot filled PASS. Loading/empty/error non esposti dalla pagina statica: N/A.

## `/territori/irpef`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Titolo, anno d’imposta, dichiarazioni, pubblicazione, snapshot e caveat precedono sei totali. | Periodi e natura del dato sono immediati. | MUST freschezza/perimetro. | Nessun fix. | Metadati e limite “non gettito” nella prima fascia. | `irpef-mobile-s1.png`; manifest 390 px, CLS 0. | PASS |
| Mobile | S2 | Controlli territoriali raggruppati; la tabella dichiara scroll e comandi da tastiera prima delle righe. | Interazione prevedibile e dato esatto preservato. | MUST affordance/focus. | Nessun fix. | Istruzioni visibili e regione focalizzabile. | `irpef-mobile-s2.png`; E2E. | PASS |
| Mobile | S3 | Le venti Regioni restano in ordine, con valori laterali nello scroller locale e senza overflow globale. | Lookup completo, pur con densità elevata. | MUST integrità; SHOULD densità. | Nessun fix. | Root entro 390 px; Fine/Inizio raggiungono gli estremi. | `irpef-mobile-s3.png`; E2E. | PASS |
| Mobile | S4 | Definizioni, soppressioni, fonte MEF, copertura e impronta dello snapshot chiudono la prova. | Denominatori e limiti non restano impliciti. | MUST fonte/denominatore. | Nessun fix. | Fonte, periodo, copertura e trasformazioni visibili. | `irpef-mobile-s4.png`. | PASS |
| Desktop | S1 | Titolo, metadati, caveat e sei totali formano una gerarchia netta anche in scala di grigi. | Lettura primaria forte. | MUST/SHOULD. | Nessun fix. | Nessuna collisione; unità adiacenti ai valori. | `irpef-desktop-s1.png`. | PASS |
| Desktop | S2 | Filtri e inizio tabella separano scelta e risultato; intestazioni e numeri sono allineati. | Confronto rapido e controllabile. | SHOULD affordance. | Nessun fix. | Controlli etichettati e tabella focalizzabile. | `irpef-desktop-s2.png`; E2E. | PASS |
| Desktop | S3 | La tabella lunga mantiene schema e keyline costanti; lo scroll è confinato alla regione. | Nessuna perdita informativa. | MUST overflow. | Nessun fix. | Pagina senza overflow orizzontale globale. | `irpef-desktop-s3.png`; manifest. | PASS |
| Desktop | S4 | Ultime righe, glossario e fonti seguono il dettaglio senza sovrapposizioni. | Auditabilità completa. | MUST fonte/metodo. | Nessun fix. | Link ufficiali, copertura e limite dell’impronta presenti. | `irpef-desktop-s4.png`. | PASS |

Stati: Regioni filled PASS. Lo stato preparatorio dei Comuni e i controlli filtro/ricerca sono coperti dal browser E2E. Error state: NOT VERIFIED. Dark N/A.

## `/territori/confronto`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof dopo fix | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Titolo, periodo, fonte e spiegazione distinguono spesa storica e fabbisogno standard prima dei filtri. | Riduce la lettura del confronto come giudizio di qualità. | MUST evidence boundary. | Nessun fix. | Definizione e periodo prima dei risultati. | `confronto-mobile-s1.png`; manifest 390 px. | PASS |
| Mobile | S2 | Risultati, ordinamento e tabella erano corretti ma senza cue visibile; ora un testo elenca colonne e tasti. | Le metriche laterali non sembrano assenti. | MUST accesso dati/reflow. | Istruzione mobile e componente scroll condiviso. | Hint visibile, regione focalizzabile e scroll da tastiera. | `confronto-mobile-s2.png`; E2E. | PASS |
| Mobile | S3 | Le righe comunali restano entro lo scroller locale con nomi leggibili e valori esatti raggiungibili. | Lookup preservato senza comprimere le colonne. | MUST overflow. | Nessun ulteriore fix. | Nessun overflow globale; estremi raggiungibili. | `confronto-mobile-s3.png`; E2E. | PASS |
| Mobile | S4 | Metodo, limiti OpenCivitas, fonte e footer completano il confronto. | Spiega perimetro e assenza di causalità. | MUST fonte/limiti. | Nessun fix. | Metodo e fonti raggiungibili. | `confronto-mobile-s4.png`. | PASS |
| Desktop | S1 | Titolo, spiegazione e filtri precedono il riepilogo, con gruppi distinti e whitespace coerente. | Il compito è chiaro in 5 secondi. | SHOULD gerarchia. | Nessun fix. | Controlli e risultato non si confondono. | `confronto-desktop-s1.png`. | PASS |
| Desktop | S2 | Tabella ampia espone spesa, fabbisogno, differenze e servizi con unità nelle intestazioni. | Confronto preciso senza dipendere dal colore. | MUST integrità. | Nessun fix. | Colonne allineate e numeri tabulari. | `confronto-desktop-s2.png`; E2E focus. | PASS |
| Desktop | S3 | La lista mantiene densità uniforme e separatori leggeri; nessun contenuto è tagliato. | Scansione stabile. | SHOULD densità. | Nessun fix. | Nessun overflow desktop inatteso. | `confronto-desktop-s3.png`; E2E. | PASS |
| Desktop | S4 | Paginazione, metodo, fonte e footer sono distinti dal corpo dati. | Chiusura verificabile. | MUST fonte/affordance. | Nessun fix. | Link e controlli raggiungibili da tastiera. | `confronto-desktop-s4.png`. | PASS |

Stati: risultati filled PASS. Empty/error e combinazioni estreme dei filtri: NOT VERIFIED visualmente. Dark N/A.

## Before | After | Why

| Before | After | Why |
| --- | --- | --- |
| Fisco mobile mostrava le prime colonne senza cue visibile | Istruzione breve sopra la regione scrollabile, con tasti supportati | Rende evidente che spese, saldo e totali sono laterali |
| Confronto mobile nascondeva metriche laterali dietro uno scroll non dichiarato | Cue responsive e componente condiviso con label e descrizione accessibili | Conserva la tabella esatta e riduce l’ambiguità |
| Prova browser assumeva overflow anche quando la tabella entrava nel desktop | Il test distingue viewport con overflow da viewport senza overflow e verifica comunque il focus | L’assenza di scroll desktop non è un difetto; l’overflow mobile resta obbligatoriamente testato |

## Prove eseguite

- PASS: 60 immagini iniziali/finali tra full-page e S1–S4, viewport esatti, CLS 0 e nessun errore runtime.
- PASS: browser E2E canonico contro build di produzione, incluse tabelle Fisco, IRPEF e Confronto, focus, Frecce, Inizio/Fine e form Consulenza.
- PASS: 269/269 test Node, lint, typecheck e build Next.js 16.3.1 (37 pagine) prima della sola aggiunta documentale.
- NOT VERIFIED: tema dark non supportato, audit assistivo completo e stati non raggiungibili elencati sopra.
