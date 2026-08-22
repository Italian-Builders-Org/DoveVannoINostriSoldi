# Verifica UI batch 5 — Controlli, Parlamento e partecipazioni

Base: HEAD `33ad100`, build locale di produzione, 390×844 e 1280×1000, tema light. Dark N/A: il prodotto non offre un tema scuro. Le immagini in `.audit/batch-5-initial/` e `.audit/batch-5-confirmation/` dividono ogni pagina intera in quattro fasce contigue S1–S4 e coprono il 100% dell’altezza.

Due revisori Luna xhigh, ciechi e indipendenti, hanno valutato le 24 fasce iniziali. Accordo: Parlamento è chiaro; le tabelle di Controlli e Partecipazioni conservano i dati nel DOM ma su mobile non rendono evidente la continuazione laterale. Disaccordo: i revisori hanno letto i `<details>` chiusi come blocchi vuoti e uno ha riaperto la nav mobile. Le prove prevalgono: la disclosure usa il controllo nativo e la nav è uno scroller con “SCORRI →”; entrambi restano invariati. Il solo batch di fix aggiunge istruzioni visibili e relazioni accessibili alle tabelle larghe.

Ogni Observation considera comprensione in 5 secondi, priorità del dato, linguaggio, gerarchia in scala di grigi, densità/keyline, colore ridondante, leggibilità, periodo/perimetro/denominatore, reflow e overflow. Focus e tastiera sono distinti dalle sole immagini.

## `/controlli`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Titolo, periodo, limiti e screening 2022 sono chiari. La tabella completa continua lateralmente; ora l’istruzione nomina differenza, popolazione, distanza e tasti freccia. | Rende scopribili le colonne che motivano il segnale. | MUST integrità/affordance. | Aggiungere hint adiacente e `aria-describedby`. | Dati completi nel DOM, cue visibile, root entro 390 px. | `controlli-mobile-s1.png`; manifest CLS 0. | PASS |
| Mobile | S2 | Provenienza OpenCivitas e prime card mantengono valore, periodo, classificazione, caveat e fonte. “Perimetro e stato” è una disclosure chiusa. | Evita di imporre metodologia prima dell’insight. | MUST evidence boundary; SHOULD density. | Nessun altro fix. | Riassunto sempre visibile; dettagli raggiungibili senza testo duplicato. | `controlli-mobile-s2.png`. | PASS |
| Mobile | S3 | Indicatori ufficiali restano impilati con valore e caveat testuali; il colore non è l’unico segnale. | Lettura stabile in scala di grigi. | MUST colore ridondante. | Nessun fix. | Nessun valore o limite tronco. | `controlli-mobile-s3.png`. | PASS |
| Mobile | S4 | Confronto annuale, studio ANAC e scenari restano distinti. La serie annuale ora dichiara lo scorrimento verso quota valore e fonte. | Riduce il rischio di leggere solo la quota numerica. | MUST perimetro/affordance. | Hint mobile; scenari invariati. | Numero, valore, fonte e natura ipotetica raggiungibili. | `controlli-mobile-s4.png`. | PASS |
| Desktop | S1 | Hero, filtro, caveat, KPI e tabella completa sono leggibili in cinque secondi. | Priorità e denominatori chiari. | MUST. | Hint nascosto oltre 620 px. | Nessun testo aggiuntivo inutile su desktop. | `controlli-desktop-s1.png`. | PASS |
| Desktop | S2 | Tabella, provenienza e prime card usano keyline e schema ripetibile. | Confronto rapido tra segnali diversi senza sommarli. | MUST/SHOULD. | Nessun fix. | Fonte, periodo e caveat per card. | `controlli-desktop-s2.png`. | PASS |
| Desktop | S3 | Card dense ma coerenti; i toni osservato/attenzione/policy/stock sono ridondati da etichette e testo. | Nessuna conclusione affidata al rosso. | MUST semantica colore. | Nessun fix. | Etichetta e caveat restano leggibili senza colore. | `controlli-desktop-s3.png`. | PASS |
| Desktop | S4 | Quote per numero/valore, fonti, scenari e composizione centrale separano fatti e ipotesi. | Previene somme o recuperi impliciti. | MUST evidence boundary. | Nessun fix. | “Scenari, non dati osservati” vicino ai valori. | `controlli-desktop-s4.png`. | PASS |

Stati: filled e filtro “Tutti” PASS. Anni validi e anno senza serie ANAC sono presenti nel codice ma NOT VERIFIED visualmente. Empty screening NOT VERIFIED. Disclosure: controllo nativo presente; il tentativo browser specifico di scroll con Freccia destra è FAIL e resta finding. Loading N/A per la pagina server-rendered. Dark N/A.

## `/parlamento`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Camera-only, consuntivo 2025, bilancio 2026 e data controllo sono immediati; previsto e registrato restano separati. | Comprensione rapida del perimetro. | MUST. | Nessun fix. | Ramo, anni e significato dei KPI visibili. | `parlamento-mobile-s1.png`; CLS 0. | PASS |
| Mobile | S2 | Consuntivo, impegni, pagamenti e prime categorie hanno unità e valori testuali. | Barre non essenziali alla lettura. | MUST equivalente testuale. | Nessun fix. | Ogni barra conserva categoria e importo. | `parlamento-mobile-s2.png`. | PASS |
| Mobile | S3 | Il consuntivo termina con caveat e fonte; il bilancio pluriennale inizia come previsione. | Evita confronto improprio tra momenti diversi. | MUST evidence boundary. | Nessun fix. | “Previste” e “registrate” sempre adiacenti. | `parlamento-mobile-s3.png`. | PASS |
| Mobile | S4 | Bilancio, limiti Camera/Senato, fonti e footer chiudono senza overflow. | Dati mancanti non stimati. | MUST fonte/limiti. | Nessun fix. | Link ufficiali e non-pubblicazione visibili. | `parlamento-mobile-s4.png`. | PASS |
| Desktop | S1 | Titolo, scope, quattro KPI e caveat formano una prima vista netta. | Priorità corretta. | MUST/SHOULD. | Nessun fix. | Gerarchia stabile in scala di grigi. | `parlamento-desktop-s1.png`. | PASS |
| Desktop | S2 | Il consuntivo affianca valori di sintesi e dettaglio pagato senza collisioni. | Confronto esatto. | MUST. | Nessun fix. | Numeri tabulari e unità coerenti. | `parlamento-desktop-s2.png`. | PASS |
| Desktop | S3 | Consuntivo e bilancio occupano colonne distinte; titoli e caveat spiegano la diversa natura. | Riduce somma mentale impropria. | MUST. | Nessun fix. | Nessun totale combinato. | `parlamento-desktop-s3.png`. | PASS |
| Desktop | S4 | “Cosa non pubblichiamo ancora” e fonti chiudono la pagina. | Limiti raggiungibili. | MUST. | Nessun fix. | Camera e Senato non sommati. | `parlamento-desktop-s4.png`. | PASS |

Stati: dataset Camera filled PASS. Senato mancante PASS perché dichiarato e non stimato. Empty/error/loading NOT VERIFIED visualmente. Dark N/A.

## `/partecipazioni`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Data 31 dicembre 2023, caveat, quattro KPI e composizione dirette/indirette sono leggibili; legenda e numeri ridondano il colore. | Part-to-whole comprensibile. | MUST. | Nessun fix. | Totale, parti e significato restano adiacenti. | `partecipazioni-mobile-s1.png`; CLS 0. | PASS |
| Mobile | S2 | La tabella continua lateralmente verso codice e amministrazioni; il nuovo hint esplicita contenuti e tasti freccia. | Il dato che ordina la lista non appare più implicitamente assente. | MUST affordance/integrità. | Hint e `aria-describedby`. | Cue visibile prima della tabella; nessun overflow pagina. | `partecipazioni-mobile-s2.png`. | PASS |
| Mobile | S3 | Nomi lunghi e codici reflowano nella tabella; la colonna conteggio resta disponibile nello scroller. | Lookup completo, densità alta ma controllata. | MUST integrità; SHOULD density. | Nessun altro fix. | Nessun nome o codice troncato. | `partecipazioni-mobile-s3.png`. | PASS |
| Mobile | S4 | Ultime righe, caveat, data, pubblicazione, licenza e link ufficiali chiudono la pagina. | Provenienza completa. | MUST fonte/perimetro. | Nessun fix. | Fonte e limiti raggiungibili. | `partecipazioni-mobile-s4.png`. | PASS |
| Desktop | S1 | Titolo, periodo, KPI, composizione e caveat “non sentenze” sono chiari. | Evita equivalenza partecipazione=controllo. | MUST. | Hint nascosto su desktop. | Prima vista invariata. | `partecipazioni-desktop-s1.png`. | PASS |
| Desktop | S2 | Tabella completa con società, codice e conteggio; nomi lunghi restano leggibili. | Confronto preciso. | MUST. | Nessun fix. | Tutte le colonne visibili. | `partecipazioni-desktop-s2.png`. | PASS |
| Desktop | S3 | La tabella prosegue con keyline coerenti e caveat sul significato del conteggio. | Nessuna inferenza su valore o qualità. | MUST evidence boundary. | Nessun fix. | Caveat adiacente alla tabella. | `partecipazioni-desktop-s3.png`. | PASS |
| Desktop | S4 | Data, pubblicazione, acquisizione, formato, licenza e link ufficiali sono completi. | Auditabilità del dataset. | MUST fonte. | Nessun fix. | Metadati e fonte visibili. | `partecipazioni-desktop-s4.png`. | PASS |

Stati: snapshot filled PASS. Empty/error/loading NOT VERIFIED visualmente. Scorrimento programmatico disponibile; prova specifica con tasto Freccia destra FAIL e non ripetuta oltre il limite. Dark N/A.

## Before | After | Why

| Before | After | Why |
| --- | --- | --- |
| Tabelle complete ma continuazione laterale implicita su mobile | Istruzione visibile, contenuti nascosti nominati e `aria-describedby` | Rende scopribile il dato esatto senza sostituire la tabella |
| Colonne fuori dalla prima porzione potevano sembrare assenti | Copy specifica: differenza/popolazione/distanza, quote/valore/fonte, codice/conteggio | Riduce il tempo per capire cosa si trova scorrendo |
| Desktop già completo | Hint nascosti oltre 620 px | Evita rumore dove tutte le colonne sono già visibili |

## Prove

- PASS: 60 immagini baseline + conferma, full-page e S1–S4, viewport esatti; CLS 0, nessun errore runtime e nessun overflow della pagina.
- PASS: 40 test focali, 270/270 test completi, lint, typecheck e build Next.js 16.3.1, 37 pagine.
- PASS: browser E2E canonico sull’HEAD di lavoro, inclusi shell 320 px su `/controlli` e `/partecipazioni`, Parlamento 390/1280 e form Consulenza a 320/390/768/1024/1280 con submit intercettato.
- FAIL: nuova prova browser `ArrowRight` sulle tabelle; regione focalizzabile ma nessuno spostamento osservato entro 2 s. Il loop bounded si è fermato.
- NOT VERIFIED: dark theme non supportato, audit assistivo completo e stati non raggiunti elencati sopra.
