# Verifica UI batch 1 — Spese e Territori

Base visuale: HEAD `f3534ff`, build locale, 390×844 e 1280×1000, light/italiano. Dark N/A: il prodotto non offre un tema scuro. Le full-page sono divise matematicamente in S1–S4 contigue e coprono il 100%. Artefatti iniziali: `.audit/batch-1-initial/`; conferma delle fasce toccate: `.audit/batch-1-confirmation/`. Manifest: CLS 0, nessun overflow globale o errore runtime.

Due revisori ciechi Luna hanno giudicato tutte le fasce senza conoscere la direzione proposta. Accordo: `/spese` passa visivamente; `/territori` fallisce inizialmente per la tabella regionale mobile, il caveat interpretativo tardivo e il grande vuoto desktop. Disaccordo: un revisore classifica il vuoto come P3, l'altro come FAIL di densità; la conferma mostra che il vuoto si riduce ma resta nella colonna corta, quindi rimane dichiarato FAIL P3 e non viene aperto un terzo round.

Ogni Observation copre: comprensione in 5 secondi/priorità, italiano semplice/gray hierarchy, leggibilità/colore, densità/keyline, fonti/periodo/denominatore, reflow. Focus/tastiera sono provati separatamente dal browser smoke, non dedotti dalle immagini.

## `/spese`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Titolo, periodo, fonte/data, anno, quattro KPI e denominatore sono immediati; gray hierarchy e keyline reggono, colore ridondante. | Prima lettura chiara. | MUST metadati, SHOULD gerarchia. | Nessun fix. | Conservare periodo/fonte/denominatore; focus anno verificabile. | `spese-mobile-s1.png`; browser smoke. | PASS |
| Mobile | S2 | Scope, quota 55,6%, confronto con stato parziale e distribuzione sono completi; “snapshot/trend” restano termini meno semplici. | Rischio lessicale P2, nessuna perdita dati. | SHOULD copy. | Registrare, non ampliare il batch. | Periodo e denominatore restano vicini al confronto. | `spese-mobile-s2.png`. | PASS |
| Mobile | S3 | Sette voci con importo, quota, descrizione, esatto e barra; numeri rendono il colore non essenziale. | Denso ma scansionabile. | SHOULD leggibilità. | Nessun fix. | Ogni barra conserva valore e percentuale testuali. | `spese-mobile-s3.png`. | PASS |
| Mobile | S4 | Mesi, cumulato, disclosure fonti e footer reflow senza overflow. | Chiusura verificabile. | MUST accesso fonte. | Nessun fix. | Disclosure apribile da tastiera e focus visibile. | `spese-mobile-s4.png`; E2E disclosure. | PASS |
| Desktop | S1 | Titolo → periodo → KPI → scope è netto, anno e valori allineati, fonte visibile. | Comprensione in 5 secondi. | MUST/SHOULD. | Nessun fix. | Nessuna collisione a 1280. | `spese-desktop-s1.png`. | PASS |
| Desktop | S2 | Analisi principale e rail mensile/cumulato sono distinti, con valori esatti e caveat. | Confronto leggibile. | SHOULD. | Nessun fix. | Testo equivalente per barre e stato parziale. | `spese-desktop-s2.png`. | PASS |
| Desktop | S3 | Categorie leggibili e ridondanti; il rail termina prima della lista ma senza perdita informativa. | Squilibrio solo P3. | Euristica. | Nessun fix nel batch. | Ordine DOM coerente e dati completi. | `spese-desktop-s3.png`. | PASS |
| Desktop | S4 | Ultime categorie, metodo e footer chiudono senza overflow. | Fonte raggiungibile. | MUST. | Nessun fix. | Disclosure e link da tastiera. | `spese-desktop-s4.png`; E2E disclosure. | PASS |

Stati: filled PASS; anno alternativo raggiungibile e coperto dai contratti; loading/empty/error N/A perché la pagina server usa snapshot locale e non espone tali stati. Tema dark N/A.

## `/territori`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof dopo fix | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Iniziale: tabella a cinque colonne visibilmente tagliata senza affordance. Dopo: tre macro-aree con pro capite/totale precedono la tabella; istruzione di scroll esplicita, tabella esatta invariata e focalizzabile. | La prima lettura non perde più il confronto; colonne di dettaglio restano via scroll locale. | MUST reflow/accesso dati. | Sommario ridondante + scroll dichiarato. | Tre righe complete, hint visibile, tabella con nome accessibile/tabindex, zero overflow globale. | `territori-mobile-s1.png`; manifest; E2E. | PASS |
| Mobile | S2 | Iniziale: caveat di merito dopo venti righe. Dopo: definizione “confronto di cassa, non merito” subito sotto il titolo, con cause esplicite. | Riduce inferenze errate sui piccoli Comuni. | Evidence boundary MUST. | Caveat vicino al ranking. | Testo leggibile prima della prima riga. | `territori-mobile-s2.png`. | PASS |
| Mobile | S3 | Continuazione classifica e confronto per volume restano completi, numeri non dipendono dal colore. | Lookup esatto conservato. | SHOULD. | Nessun ulteriore fix. | Nomi lunghi e tre colonne senza overflow globale. | `territori-mobile-s3.png`. | PASS |
| Mobile | S4 | Caveat esteso, link territoriali, copertura, fonte/data/denominatore e footer reflow. | Chiusura metodologica completa. | MUST metadati. | Nessun fix. | Fonte, periodo e perimetro raggiungibili. | `territori-mobile-s4.png`. | PASS |
| Desktop | S1 | Tabella regionale ora usa tutta la larghezza: cinque colonne, macro-aree e periodo leggibili. | Priorità regionale più netta. | SHOULD gerarchia. | Regione prima, confronti comunali sotto. | Tutti i campi visibili a 1280. | `territori-desktop-s1.png`. | PASS |
| Desktop | S2 | Due confronti comunali affiancati e caveat già vicino al primo; colonne allineate. | Confronto pro capite/volume immediato. | Evidence boundary + layout. | Grid a due colonne. | Entrambi i titoli e valori visibili; no pagina allargata. | `territori-desktop-s2.png`. | PASS |
| Desktop | S3 | La lista pro capite ha 20 righe, quella per volume 10: resta un'ampia area vuota nella colonna corta prima del caveat full-width. | Ritmo/densità ancora sbilanciati, senza perdita dati. | P3 euristica, disaccordo revisori. | Stop al secondo round; finding residuo dichiarato. | Futuro: flusso che non aspetti l'altezza della colonna lunga. | `territori-desktop-s3.png`. | FAIL |
| Desktop | S4 | Caveat, tre percorsi territoriali, copertura e fonti sono full-width, leggibili e allineati. | Chiusura verificabile. | MUST metadati. | Nessun fix. | Fonte/data/denominatore e link disponibili. | `territori-desktop-s4.png`. | PASS |

Stati: filled PASS; anno alternativo coperto dal browser smoke. Popolazione/pro capite `n.d.` restano contratti di dato ma non sono raggiunti dalla fixture corrente: NOT VERIFIED visivamente. Loading/empty/error N/A per lo snapshot locale. Tema dark N/A. Full accessibility audit NOT RUN; focus/tastiera smoke PASS per tabella, anno, link e disclosure.

## Before / After / Why

| Before | After | Why |
| --- | --- | --- |
| Tabella regionale mobile come unica prima lettura, con colonne fuori vista | Riepilogo macro-aree + hint e tabella esatta scrollabile | Comprensione immediata senza eliminare valori |
| “Più pagamenti per abitante” prima del caveat | Definizione non-meritocratica adiacente al titolo | Un valore alto non è automaticamente bene o male |
| Tabella regionale e lista lunga in due colonne sbilanciate | Regione full-width, confronti comunali affiancati sotto | La geografia primaria guida l'ordine |
