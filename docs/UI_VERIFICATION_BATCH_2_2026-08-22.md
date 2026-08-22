# Verifica UI batch 2 — Invalidità, Sanità e Stato

Base iniziale: HEAD `56ab329`, build locale, 390×844 e 1280×1000, tema light e italiano. Dark N/A: il prodotto non offre un tema scuro. Ogni full-page è divisa matematicamente in S1–S4 contigue, senza sovrapposizioni, per coprire il 100% dell'altezza. Prove iniziali: `.audit/batch-2-initial/`; conferma delle tre route modificate: `.audit/batch-2-confirmation/`.

Due revisori Luna xhigh, ciechi rispetto alla soluzione e indipendenti, hanno valutato le 32 fasce. Accordo: Invalidità è leggibile; Sanità conserva dati esatti ma su mobile deve dichiarare lo scroll delle tabelle; Stato e amministrazione devono calcolare le barre sul massimo reale; la pagina amministrazione aveva overflow globale. Disaccordo: un revisore considerava la densità Sanità un rischio P2, l'altro un FAIL mobile. La misura oggettiva prevale: le tabelle restano complete e focalizzabili, ma l'assenza iniziale di affordance era FAIL; dopo gli avvisi espliciti e la prova da tastiera è PASS.

Ogni Observation include comprensione in 5 secondi e priorità, linguaggio, gerarchia in scala di grigi, densità/keyline, colore ridondante, leggibilità, periodo/perimetro/denominatore, reflow e overflow. Focus/tastiera sono provati dal browser E2E e non dedotti dalle immagini.

## `/spese/invalidita`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Titolo semplice, tre KPI con anno/unità e avvertenza sul perimetro; gray hierarchy netta e colore non essenziale. | La spesa complessiva non viene confusa con una sola misura. | MUST semantica; SHOULD gerarchia. | Nessun fix. | Valore, anno, unità e perimetro visibili nel primo tratto. | `invalidita-mobile-s1.png`; manifest CLS 0/390 px. | PASS |
| Mobile | S2 | Le due componenti 2024 e lo stock sono separati con testo esplicativo; valori testuali accompagnano le barre. | Confronto comprensibile senza inferire additività impropria. | MUST evidence boundary. | Nessun fix. | Barre sempre ridondanti con label e importo. | `invalidita-mobile-s2.png`. | PASS |
| Mobile | S3 | Serie nazionale e tabella regionale dichiarano anno completo/parziale e copertura di 18 regioni. | Periodi non omogenei restano riconoscibili. | MUST periodo/copertura. | Nessun fix. | Stato parziale e totale copertura adiacenti ai dati. | `invalidita-mobile-s3.png`. | PASS |
| Mobile | S4 | Limiti territoriali, non-classifica, documenti ufficiali con data/pagine e footer completano la prova. | Riduce letture accusatorie e rende il dato verificabile. | MUST fonte/limiti. | Nessun fix. | Fonti, periodo, perimetro e limiti raggiungibili. | `invalidita-mobile-s4.png`. | PASS |
| Desktop | S1 | Titolo → KPI → avvertenza → componenti crea una lettura primaria stabile anche in grigio. | Comprensione in 5 secondi. | SHOULD gerarchia. | Nessun fix. | Nessuna collisione o dipendenza dal rosso. | `invalidita-desktop-s1.png`. | PASS |
| Desktop | S2 | Serie e inizio confronto regionale usano numeri tabulari, righe e intestazioni coerenti. | Lookup e scansione rapidi. | SHOULD densità. | Nessun fix. | Colonne allineate e anni espliciti. | `invalidita-desktop-s2.png`. | PASS |
| Desktop | S3 | Tabella termina con totale/copertura e caveat, poi separa disponibilità territoriale e interpretazione. | Dati mancanti non sembrano zeri. | MUST dato mancante. | Nessun fix. | `n.d.`/assenze e limiti restano testuali. | `invalidita-desktop-s3.png`. | PASS |
| Desktop | S4 | Documenti ufficiali includono ente, data, controllo, pagine e identificativo; footer reflow corretto. | Provenienza verificabile. | MUST fonte. | Nessun fix. | Link e riferimenti accessibili da tastiera. | `invalidita-desktop-s4.png`; E2E shell. | PASS |

Stati: filled PASS. Loading/empty/error non esposti dalla pagina statica: N/A. Dati regionali parziali PASS perché rappresentati esplicitamente, non simulati.

## `/spese/sanita`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof dopo fix | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | KPI, perimetro contabile e caveat precedono la prima tabella. Inizialmente le colonne fuori vista non avevano un invito esplicito; ora compare l'avviso di scroll. | Evita di scambiare la prima colonna per l'intero record. | MUST accesso dati/reflow. | Avviso mobile, tabella esatta invariata. | Hint visibile ≤620 px; regione focalizzabile e scorrevole. | `sanita-mobile-s1.png`; E2E. | PASS |
| Mobile | S2 | Il confronto regionale è lungo ma alfabetico, con unità e totale; avviso di scroll prima della tabella. | Denso, ma utile per lookup esatto. | SHOULD densità; MUST accesso. | Conservare tabella, dichiarare interazione. | Nessun overflow globale; colonne raggiungibili da tastiera. | `sanita-mobile-s2.png`; manifest 390 px. | PASS |
| Mobile | S3 | Dettaglio per ente continua con territorio e valori; la pagina non usa colore per il significato. | Alto costo di scansione, nessuna perdita informativa. | P2 euristica. | Nessun ulteriore fix nel round. | Ordine stabile, righe complete via scroll locale. | `sanita-mobile-s3.png`. | PASS |
| Mobile | S4 | Ultimi enti, metodo, fonte ufficiale, controllo e caveat sulla contabilità chiudono la pagina. | Verificabilità completa nonostante la lunghezza. | MUST fonte/perimetro. | Nessun ulteriore fix. | Fonte, periodo e limite “non pagamenti” visibili. | `sanita-mobile-s4.png`. | PASS |
| Desktop | S1 | Titolo, tre KPI, caveat e riepilogo nazionale precedono i territori; gerarchia e keyline chiare. | Prima lettura forte. | MUST/SHOULD. | Nessun fix. | Perimetro e unità immediati. | `sanita-desktop-s1.png`. | PASS |
| Desktop | S2 | Dettaglio ente molto lungo con colonne coerenti e righe leggere. | Densità elevata ma adatta al lookup. | SHOULD. | Nessun fix. | Testo leggibile e colonne allineate. | `sanita-desktop-s2.png`. | PASS |
| Desktop | S3 | La tabella prosegue senza salti o cambi di schema. | Continuità affidabile. | MUST integrità visuale. | Nessun fix. | Nessuna sovrapposizione o riga tronca. | `sanita-desktop-s3.png`. | PASS |
| Desktop | S4 | La tabella termina prima di metodo/fonte/caveat e footer. | Chiusura metodologica raggiungibile. | MUST fonte. | Nessun fix. | Controllo, perimetro e link ufficiali presenti. | `sanita-desktop-s4.png`. | PASS |

Stati: snapshot filled PASS. Loading/empty/error non raggiungibili dalla route statica: N/A. Le tre regioni tabella hanno `tabindex=0`; E2E prova ArrowRight quando c'è overflow.

## `/stato`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof dopo fix | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Periodo, fonte, rilascio e KPI principale precedono trend e confronto; titolo e metriche rientrano nel viewport. | Nessun dato primario tagliato. | MUST reflow/metadati. | Wrap robusto e scala mobile ridotta. | Root 390 px, un h1, fonte/periodo visibili. | `stato-mobile-s1.png`; manifest. | PASS |
| Mobile | S2 | Trend cumulato/mensile con tabella equivalente e metodo; grafici hanno label/assi testuali. | Confronto comprensibile senza colore. | MUST equivalente testuale. | Nessun fix. | Disclosure “Dati del grafico in tabella” raggiungibile. | `stato-mobile-s2.png`; E2E shell. | PASS |
| Mobile | S3 | Missioni, amministrazioni e categorie mostrano ranking più tabella; nomi lunghi restano nel contenitore locale. | Lookup disponibile, densità controllata. | MUST overflow; SHOULD densità. | Wrap dei titoli e contenitori `min-width:0`. | Nessun overflow globale. | `stato-mobile-s3.png`; manifest 390 px. | PASS |
| Mobile | S4 | Canali proporzionali, controllo di coerenza, fonti originali e footer. | La barra maggiore è matematicamente corretta, non legata all'ordine. | MUST accuratezza. | Massimo calcolato su tutti i valori. | Riga col massimo = 100%; nessuna barra >100%. | `stato-mobile-s4.png`; E2E dati. | PASS |
| Desktop | S1 | Controllo periodo, fonte e KPI sono netti; il taglio S1 attraversa l'area grafici senza costituire uno stato vuoto. | Nessun problema prodotto; limite dell'artefatto segmentato. | Proof rule. | Valutare insieme a S2/full-page. | Grafici presenti nella full-page e in S2, zero errori. | `stato-desktop-full.png`; S1–S2. | PASS |
| Desktop | S2 | Trend e missioni sono leggibili, con unità e tabella equivalente. | Confronto rapido. | MUST a11y dati. | Nessun fix. | Testo equivalente e fonte CSV. | `stato-desktop-s2.png`. | PASS |
| Desktop | S3 | Amministrazioni/categorie affiancate; una colonna termina prima ma senza perdita. | Squilibrio P3, non blocca uso. | Euristica. | Nessun ulteriore fix. | Tabelle e grafici restano associati. | `stato-desktop-s3.png`. | PASS |
| Desktop | S4 | Canali, coerenza e file originali usano piena larghezza e numeri allineati. | Provenienza e riconciliazione evidenti. | MUST accuratezza/fonte. | Scala sul massimo reale. | Massimo 100%, fonti ufficiali raggiungibili. | `stato-desktop-s4.png`; E2E. | PASS |

Stati: rilascio mensile filled PASS; consuntivo alternativo coperto dai contratti esistenti ma non ricatturato in questo batch: NOT VERIFIED visualmente. Error state della query non raggiunto: NOT VERIFIED.

## `/stato/amministrazioni/2`

| Vista | Fascia | Observation | Impact | Rule strength | Decision | Acceptance criteria | Proof dopo fix | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | S1 | Iniziale: titolo, metadati e KPI allargavano la pagina a 442 px. Dopo: titolo spezza, riepilogo e metrica rientrano a 390 px. | Il dato primario non è più tagliato. | HARD/MUST overflow. | Wrap, `min-width:0`, scala mobile. | Root/body ≤391 px, h1 e KPI nel viewport. | `amministrazione-mobile-s1.png`; manifest 390 px. | PASS |
| Mobile | S2 | Due grafici distinguono funzioni e tipi, con tabelle equivalenti. | Priorità e gerarchia stabili in grigio. | MUST equivalente. | Nessun fix. | Label e valori raggiungibili senza colore. | `amministrazione-mobile-s2.png`. | PASS |
| Mobile | S3 | Il dettaglio economico è più largo del contenitore ma ora lo dichiara prima della regione scrollabile. | Colonne codice/importo non sembrano assenti. | MUST affordance/focus. | Hint mobile + scroll locale. | Nessun overflow pagina; regione focalizzabile. | `amministrazione-mobile-s3.png`; E2E. | PASS |
| Mobile | S4 | Canali, coerenza, fonti e footer rientrano; barre scalate sul massimo reale. | Confronto numericamente fedele. | MUST accuratezza. | Massimo robusto all'ordine. | Valore massimo = barra 100%; fonti presenti. | `amministrazione-mobile-s4.png`; E2E. | PASS |
| Desktop | S1 | Breadcrumb, nome ente, periodo/fonte e KPI sono leggibili e allineati. | Identità e perimetro chiari. | MUST metadati. | Nessun fix. | Nessuna collisione a 1280. | `amministrazione-desktop-s1.png`. | PASS |
| Desktop | S2 | Grafici e inizio tabella esatta creano progressione overview→dettaglio. | Buona gerarchia. | SHOULD. | Nessun fix. | Tabelle equivalenti visibili. | `amministrazione-desktop-s2.png`. | PASS |
| Desktop | S3 | Dettaglio economico completo, ordinato per valore, con codice e importo. | Lookup preciso. | MUST integrità. | Nessun fix. | Colonne complete e allineate. | `amministrazione-desktop-s3.png`. | PASS |
| Desktop | S4 | Canali, coerenza e fonti originali chiudono senza overflow. | Auditabilità completa. | MUST fonte/accuratezza. | Scala robusta. | Barra massima 100%; link ufficiali. | `amministrazione-desktop-s4.png`; E2E. | PASS |

Stati: ente valido/filled PASS. Ente assente, dati parziali ed errore non raggiunti in questa fixture: NOT VERIFIED. Dark N/A.

## Before | After | Why

| Before | After | Why |
| --- | --- | --- |
| Tabelle Sanità mobile scorribili ma senza indicazione | Tre avvisi contestuali, visibili solo quando le colonne richiedono attenzione | Fa capire che esistono altri valori senza rimuovere la tabella esatta |
| Barre dei canali dipendenti dal primo elemento dell'array | Massimo calcolato sull'intera serie e verificato nel browser | L'ordine del dataset non deve alterare la rappresentazione |
| Pagina amministrazione larga 442 px su viewport 390 | Titolo, metrica e metadati spezzano entro 390 px; tabella usa solo scroll locale | Elimina clipping globale mantenendo valori e codici completi |

## Prove eseguite

- PASS: manifest iniziale e conferma, CLS 0, nessun errore runtime; conferma 390/1280 senza overflow globale.
- PASS: 268/268 test Node, lint, typecheck e build Next.js 16.3.1 (37 pagine).
- PASS: browser E2E canonico contro build di produzione, incluse tabelle Sanità, barre Stato/amministrazione, focus tabella e form Consulenza.
- NOT VERIFIED: tema dark (non supportato), audit assistivo completo e stati non raggiungibili elencati sopra.
