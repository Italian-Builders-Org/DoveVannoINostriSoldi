# Verifica UI batch 6 — Fonti, metodo, Assistente e MCP

Baseline: HEAD `6534293`; conferma sulla build di produzione con le modifiche della slice. Viewport 390×844 e 1280×1000, light. Dark N/A: il prodotto non offre un tema scuro. `.audit/batch-6-initial/` e `.audit/batch-6-confirmation/` contengono per ogni route una full-page e quattro fasce contigue S1–S4 che coprono il 100% dell’altezza.

Due revisori Luna xhigh ciechi e indipendenti hanno valutato le 40 fasce iniziali. Accordo: `/fonti` perdeva la freschezza fuori dalla prima porzione mobile; `/mcp` comprimeva cinque colonne, nascondeva filtri/limiti e produceva vuoti enormi. Un revisore ha inoltre rilevato la contraddizione tra endpoint localhost e pubblico. Disaccordo: uno ha riaperto la nav mobile; le misure e il test prevalgono perché è uno scroller intenzionale con cue “SCORRI →”.

## `/fonti`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Titolo, 14 fonti e prime righe sono chiari. La tabella ora mantiene una geometria di 980 px e dichiara che frequenza e ultimo dato continuano lateralmente. | Freschezza scopribile senza comprimere cinque colonne. | MUST fonte/periodo. | Min-width + hint + `aria-describedby`. | Cue visibile; dati completi; root 390 px. | `fonti-mobile-s1.png`; CLS 0. | PASS |
| Mobile | S2 | Le fonti centrali hanno righe più basse e testo leggibile; proprietà e copertura restano associate. | Scorrimento ridotto di 703 px sull’intera pagina. | MUST integrità; SHOULD density. | Conservare tabella esatta. | Nessun campo rimosso o troncato. | `fonti-mobile-s2.png`. | PASS |
| Mobile | S3 | Fine registro, principi e link ufficiali reflowano in una colonna. | Metodo e riuso restano subordinati ai dati. | MUST gerarchia/fonte. | Nessun altro fix. | Blocco tecnico dopo il registro. | `fonti-mobile-s3.png`. | PASS |
| Mobile | S4 | Link, caveat su “aggiornato” e footer chiudono la pagina. | Evita equivalenza tra controllo e tempo reale. | MUST freschezza. | Nessun fix. | Caveat e Stato fonti raggiungibili. | `fonti-mobile-s4.png`. | PASS |
| Desktop | S1 | Hero, conteggio e cinque colonne complete sono leggibili in 5 secondi. | Priorità netta. | MUST. | Hint nascosto. | Desktop invariato. | `fonti-desktop-s1.png`. | PASS |
| Desktop | S2 | Registro prosegue con frequenze e ultimi dati allineati. | Confronto preciso. | MUST. | Nessun fix. | Date e periodi tabulari. | `fonti-desktop-s2.png`. | PASS |
| Desktop | S3 | Principi e collegamenti seguono il registro, non lo precedono. | Progressione dato→metodo→fonti. | SHOULD. | Nessun fix. | Nessun card soup aggiuntivo. | `fonti-desktop-s3.png`. | PASS |
| Desktop | S4 | Caveat e footer restano discreti. | Chiusura verificabile. | MUST. | Nessun fix. | Link operativi. | `fonti-desktop-s4.png`. | PASS |

Stati: filled PASS. Fonte senza latest usa “scoperta automatica” nel codice ma NOT VERIFIED isolatamente. Empty/error/loading N/A per il registro statico. Dark N/A.

## `/fonti/stato`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Titolo semplice, quattro KPI e spiegazione separano collegamento, raggiungibilità e data; il kicker duplicato è rimosso. | Prima vista più diretta. | MUST 5s; craft floor. | Eliminare eyebrow. | H1 unico e perimetro chiaro. | `fonti-stato-mobile-s1.png`; −21 px. | PASS |
| Mobile | S2 | Prime fonti mostrano proprietario, cadenza, latenza, record e timestamp. | Nessun semaforo privo di testo. | MUST colore ridondante. | Nessun altro fix. | Stato sempre scritto. | `fonti-stato-mobile-s2.png`. | PASS |
| Mobile | S3 | Fonti centrali mantengono tutti i metadati in stack. | Audit operativo completo. | MUST. | Nessun fix. | Nessun campo perso. | `fonti-stato-mobile-s3.png`. | PASS |
| Mobile | S4 | Ultime fonti e nota finale spiegano unknown/down/stale. | Limiti espliciti. | MUST. | Nessun fix. | Nessuna certezza inventata. | `fonti-stato-mobile-s4.png`. | PASS |
| Desktop | S1 | H1, KPI ed explainer formano una gerarchia più pulita senza kicker. | Riduce rumore. | SHOULD/craft floor. | Rimozione label ridondante. | Nessun buco sopra il titolo. | `fonti-stato-desktop-s1.png`. | PASS |
| Desktop | S2 | Griglia a quattro colonne allinea fonte, integrazione, risposta e data. | Confronto rapido. | MUST. | Nessun fix. | Label e valori completi. | `fonti-stato-desktop-s2.png`. | PASS |
| Desktop | S3 | Stati intermedi conservano caveat e denominatori. | Colore non decisivo. | MUST. | Nessun fix. | Testo accanto ai marker. | `fonti-stato-desktop-s3.png`. | PASS |
| Desktop | S4 | Coda e nota metodologica chiudono la matrice. | Interpretazione corretta. | MUST. | Nessun fix. | Nota unknown visibile. | `fonti-stato-desktop-s4.png`. | PASS |

Stati: filled con reachability up/fresh PASS. Down, stale, not-probed e unknown sono supportati ma NOT VERIFIED visualmente in questa cattura. La route dinamica non mostra skeleton; loading NOT VERIFIED. Dark N/A.

## `/metodologia`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Titolo e prime regole parlano direttamente; i numeri 01–06 senza funzione sono rimossi. | Riduce ornamento e altezza. | Craft floor. | Eliminare indici decorativi. | Il titolo porta la gerarchia. | `metodologia-mobile-s1.png`; −150 px pagina. | PASS |
| Mobile | S2 | Regole centrali restano brevi, con keyline e ritmo coerenti. | Scansione più rapida. | SHOULD. | Nessun altro fix. | Testi completi. | `metodologia-mobile-s2.png`. | PASS |
| Mobile | S3 | Ultime regole e warning separano metodo e limite legale. | Evidenza cauta. | MUST. | Nessun fix. | Warning testuale, non solo cromatico. | `metodologia-mobile-s3.png`. | PASS |
| Mobile | S4 | Warning e footer chiudono senza overflow. | Integrità. | MUST. | Nessun fix. | Root 390 px. | `metodologia-mobile-s4.png`. | PASS |
| Desktop | S1 | Titolo e griglia iniziano senza etichette ornamentali. | Gerarchia grayscale più netta. | Craft floor. | Rimuovere numeri. | H2 leggibili senza colore. | `metodologia-desktop-s1.png`. | PASS |
| Desktop | S2 | Sei principi mantengono una griglia regolare. | Confronto tra regole. | SHOULD. | Nessun fix. | Spacing coerente. | `metodologia-desktop-s2.png`. | PASS |
| Desktop | S3 | Warning finale espone il limite del prodotto. | Previene accuse. | MUST. | Nessun fix. | Nessun claim automatico. | `metodologia-desktop-s3.png`. | PASS |
| Desktop | S4 | Footer completo nel viewport minimo di pagina. | Chiusura. | MUST. | Nessun fix. | Link visibili. | `metodologia-desktop-s4.png`. | PASS |

Stati: pagina statica filled PASS; empty/error/loading N/A. Dark N/A.

## `/assistente`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Scopo deterministico/read-only, form e domanda sono chiari. | Aspettative corrette. | MUST. | Nessun fix. | “Sola lettura” e perimetro visibili. | `assistente-mobile-s1.png`; CLS 0. | PASS |
| Mobile | S2 | Textarea, limite 500, CTA disabilitata ed esempi reflowano. | Affordance coerente con stato iniziale. | MUST states. | Nessun fix. | Disabled non scambiato per errore. | `assistente-mobile-s2.png`; browser. | PASS |
| Mobile | S3 | Placeholder risposta e limiti restano separati. | Fonte/periodo promessi prima dell’uso. | MUST. | Nessun fix. | Nessun risultato inventato. | `assistente-mobile-s3.png`. | PASS |
| Mobile | S4 | Privacy/logging e footer chiudono la pagina. | Confini operativi chiari. | MUST privacy. | Nessun fix. | Link privacy visibile. | `assistente-mobile-s4.png`. | PASS |
| Desktop | S1 | Titolo, form e limite occupano la priorità corretta. | Comprensione in 5s. | MUST. | Nessun fix. | Una sola azione primaria. | `assistente-desktop-s1.png`. | PASS |
| Desktop | S2 | Esempi e area risposta sostengono il percorso. | Progressive disclosure. | SHOULD. | Nessun fix. | Domande verificabili. | `assistente-desktop-s2.png`. | PASS |
| Desktop | S3 | Limiti funzionali e privacy sono leggibili. | Nessuna promessa AI generica. | MUST. | Nessun fix. | Testo semplice. | `assistente-desktop-s3.png`. | PASS |
| Desktop | S4 | Footer rimane subordinato. | Chiusura. | MUST. | Nessun fix. | Nessun overflow. | `assistente-desktop-s4.png`. | PASS |

Stati: empty/disabled PASS da cattura. Filled PASS nel browser a 390/1280 con risposta verificata, periodo, fonte e caveat. Help deterministico PASS a 320/390/768/1280. Error e loading transitorio NOT VERIFIED visualmente. Dark N/A.

## `/mcp`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Box e prompt mostrano ora lo stesso endpoint pubblico; strumenti e uso responsabile restano prima del catalogo. | Elimina istruzione operativa contraddittoria. | MUST. | Usare `PUBLIC_MCP_ENDPOINT` una volta. | Nessun localhost nella UI. | `mcp-mobile-s1.png`; browser 320. | PASS |
| Mobile | S2 | Catalogo con min-width 1100 px e hint evita la compressione; righe iniziali hanno altezza naturale. | Filtri/limiti restano raggiungibili e la pagina perde 1.922 px vuoti. | MUST integrity; SHOULD density. | Geometria reale + hint. | 19 dataset completi; root 390 px. | `mcp-mobile-s2.png`. | PASS |
| Mobile | S3 | Dataset centrali mantengono titolo, sintesi e fonti senza righe deformate. | Scansione sostanzialmente più rapida. | MUST/SHOULD. | Nessun altro fix. | Nessun link tronco nel contenuto scrollabile. | `mcp-mobile-s3.png`. | PASS |
| Mobile | S4 | Ultimi dataset e MCP complementare restano separati per proprietario e accesso. | Provenienza chiara. | MUST. | Nessun fix. | Servizio esterno marcato. | `mcp-mobile-s4.png`. | PASS |
| Desktop | S1 | Endpoint canonico, strumenti, cautela e client compatibili sono coerenti. | Percorso operativo unico. | MUST. | Costante condivisa. | Box=prompt. | `mcp-desktop-s1.png`. | PASS |
| Desktop | S2 | Prompt e inizio catalogo mantengono cinque colonne. | Dati esatti. | MUST. | Hint nascosto. | Desktop invariato. | `mcp-desktop-s2.png`. | PASS |
| Desktop | S3 | Aggiornamento, filtri e limiti restano allineati per ogni dataset. | Evita query fuori perimetro. | MUST. | Nessun fix. | Caveat per riga. | `mcp-desktop-s3.png`. | PASS |
| Desktop | S4 | MCP complementare espone proprietario, accesso, limite e verifica. | Nessuna integrazione implicita. | MUST. | Nessun fix. | Link e data completi. | `mcp-desktop-s4.png`. | PASS |

Stati: catalogo filled PASS. Clipboard idle/layout PASS a 320/1280; copied/error clipboard NOT VERIFIED visualmente. Endpoint HTTP MCP e protocolli coperti dai test Node; errori di rete UI N/A. Dark N/A.

## Before | After | Why

| Before | After | Why |
| --- | --- | --- |
| Endpoint principale locale, prompt pubblico | Un solo `PUBLIC_MCP_ENDPOINT` in box e prompt | Evita configurazioni errate e rimuove hydration dipendente dall’origin |
| Tabelle a cinque colonne compresse in 390 px | Min-width 980/1100 px, hint mobile e descrizione accessibile | Mantiene freschezza, filtri e limiti senza righe enormi |
| `/mcp` mobile alto 7.340 px | 5.418 px con gli stessi 19 dataset | Elimina 1.922 px di spazio generato dal wrapping delle colonne invisibili |
| Kicker “Stato delle fonti” sopra un H1 equivalente | H1 diretto | Rafforza gerarchia e linguaggio semplice |
| Numeri 01–06 privi di funzione nella metodologia | Titoli delle regole senza decorazione | Riduce card-template e altezza senza perdere sequenza necessaria |

## Prove

- PASS: 100 immagini baseline + conferma, full-page e S1–S4; viewport esatti, CLS 0, runtime errors 0, nessun overflow pagina.
- PASS: due review Luna xhigh cieche e indipendenti.
- PASS: 15/15 test focali, 272/272 test completi, lint, typecheck, build Next.js 16.3.1 (37 pagine).
- PASS: browser E2E canonico: MCP 320/1280, Assistente help 320/390/768/1280, risposta filled 390/1280, Consulenza 320/390/768/1024/1280 e submit intercettato.
- NOT VERIFIED: dark theme, audit assistivo completo e stati dinamici elencati sopra.
