# Struttura del prototipo

## Due alternative

| Struttura                                     | Vantaggi                                                                                  | Vincoli                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Integrazione immediata in Next/corpus         | Dataset interrogabile, navigazione condivisa                                              | Richiede ledger, policy, registri, budget bundle, gate e review delle licenze; anticipa scelte metodologiche ancora da provare |
| Pipeline e visualizzatore offline in research | Risultato reale ispezionabile, nessuna nuova route/funzione/polling, confronti ripetibili | Non è una feature pubblicata nel sito; l'integrazione nel corpus resta una fase distinta                                       |

Scelta: seconda alternativa per il branch esplorativo richiesto. Nessun artifact parallelo viene introdotto in src/data o nelle pagine Next. Per una futura pubblicazione: registrare il feed come derived-only nel corpus, chiudere il ledger e derivare da quei byte, non mantenere due acquisizioni.

## Contratto visibile

Una città e una fascia oraria per volta. Tipi di trasporto dichiarati per città; Bologna usa un perimetro urbano bus/filobus. Il rilievo rappresenta minuti programmati per chilometro; la quota non è altitudine. Una tabella equivalente consente selezione e lettura senza la mappa. Fonti, data del servizio, esclusioni e hash sono verificabili.

## Moduli e uso

`python3 analyze.py --cache DIR --date 2026-10-30 --output DIR`

- feeds.json: holder, URL canonico, licenza e condizioni per città.
- analyze.py: ZIP -> calendario attivo -> mezzi/perimetro dichiarati -> fermate adiacenti -> geometrie -> tempi mediani -> JSON/HTML locali.
- basemap.py: estratti OSM delimitati, ricevute verificate, geometrie semplificate; acquisizione solo offline.
- render.py: compone cartografia verificata e analisi esistente senza ripetere la scansione GTFS.
- viewer.html / viewer.css / viewer.js: renderer Canvas con camera geografica inclinata, pan/zoom, picking e tabella equivalente; niente librerie o richieste remote. Bundle gzip per città, cache decodificata LRU di due città.
- test_analysis.py: fixture ZIP sintetiche per rischi di calendario, orari, integrità e geometria. Le fixture non sono dati del prodotto.

`analyze_feed(path, service_date, receipt, source) -> CityAnalysis`
`active_services(calendar, exceptions, service_date) -> set[str]`
`seconds(gtfs_time) -> int | None`
`segment_geometry(shape, previous_stop, next_stop, ...) -> coordinates | None`

## Rischi da provare prima del codice

- Giorni esclusi/aggiunti da calendar_dates, servizio scaduto e assenza di dati non equivalgono a velocità zero.
- Orari oltre 24:00 non si riducono modulo 24; le fasce sono nel giorno di servizio locale.
- Durata nulla/negativa, orario mancante, stop_sequence duplicata: non produrre velocità.
- Frequencies non espanse: escludere e contare, non inventare numero di corse.
- Non assumere metri per shape_dist_traveled: usarlo solo come coordinata lungo la shape; distanza metrica calcolata dalle coordinate.
- Shape mancante, fermata distante dalla shape, progressione impossibile: escludere e rendere visibile la copertura.
- Percorsi alternativi non vanno fusi; direzioni e geometrie restano distinte.
- Niente confronti/classifiche di efficienza fra città o inferenze su ritardi reali.
- ZIP con file duplicati, budget espansi e JSON HTML con testi ostili: fallire in modo chiuso/escape.

## Costi

Una copia del feed per analisi, con SHA-256 e data acquisizione. Archivio raw fuori Git. Elaborazioni soltanto offline; visualizzatore autosufficiente. Nessuna modifica Vercel, acquisizione periodica, API AI, tiles o nuovo pacchetto. Nessun aggiornamento automatico attivato.

## Iterazione 2: cartografia reale

| Prima                                           | Dopo                                                                    | Perché                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Piccola rete isolata su fondo vuoto             | Rete sopra strade, aree verdi, acqua e nomi OSM                         | Riconoscere città e quartieri come nel riferimento                       |
| Quota SVG in pixel e prospettiva ortografica    | Proiezione geografica con camera inclinata e scala del rilievo coerente | Ridurre l'effetto di pareti ripetute e mantenere il legame con le strade |
| Inquadratura dell'intera rete con molto margine | Vista centrale ampia, pan/zoom e comando inquadra rete                  | Esplorare i tratti senza comprimere tutto in un simbolo                  |

Alternative: MapLibre con servizio tile esterno oppure renderer Canvas su estratti vettoriali OSM locali. Scelta: estratti locali, per non aggiungere richieste a ogni visita, chiavi o servizi a pagamento. L'attribuzione ODbL rimane visibile. Il basemap è un contesto cartografico distinto dalle misure GTFS: non deve modificare distanze o tempi dell'analisi.

## Iterazione 3: esplorazione

Uso: scegliere città/orario/linea, cercare una fermata, selezionare classi di velocità; esplorare, leggere il tratto e scaricare la selezione. Nessun nuovo calcolo della metrica nei filtri.

| Before                                                              | After                                                                                       | Why                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Slider zoom e camera con limiti differenti; angoli non normalizzati | Una sola camera con zoom limitato, angolo normalizzato, proiezione/inversa e fit verificati | Evitare salti, valori UI incoerenti e reti fuori vista |
| Dettaglio sopra la mappa e controlli sparsi                         | Barra compatta, bussola e pannello Vista; dettaglio più compatto su mobile                  | Lasciare contesto geografico leggibile                 |
| Mappa da esplorare soltanto a occhio                                | Ricerca fermata e filtro velocità, tabella e CSV della selezione                            | Trovare e verificare un tratto specifico               |
| Sfondo riproiettato anche per hover/cambio fascia                   | Un solo buffer cartografico invalidato da città/camera/viewport                             | Evitare lavoro che non cambia il risultato             |

Alternativa A: toolbar orizzontale e mappa ampia, controlli camera raggruppati e tabella sotto. Alternativa B: rail permanente sinistro e pannello dati destro. Scelta A: usa più larghezza per il contesto geografico e conserva lo stesso ordine dei controlli su mobile. La B sottrae troppo spazio quando la rete è densa e impone pannelli mobili aggiuntivi.

Moduli: `camera.mjs` contiene proiezione, inversa, fit, zoom, normalizzazione e scala grafica; niente DOM. `explorer.mjs` contiene ricerca fermate/filtri ed export CSV sicuro; niente acquisizione. Il template incorpora camera, esplorazione e `renderer.mjs` prima del controller `viewer.js`. Il renderer conserva un buffer dello sfondo e uno dei tratti; la cache dati rimane di due città. La consegna predefinita separa gli asset gzip per città, verificati per hash e dimensione; `--standalone` mantiene il formato offline unico.

Rischi da verificare prima: inversa/proiezione su camera ruotata e inclinata, zoom ancorato, orizzonte non proiettabile, fit su geometrie strette, resize, nomi fermata duplicati, filtro vuoto, formule/virgolette nel CSV, cambio città durante decompressione e stato del dettaglio dopo filtri. La prova touch fisica resta un confine distinto dalla verifica Browser.

## Iterazione 4: selettori e viste condivise

| Before                                                              | After                                                                                         | Why                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Frecce native piccole e vicine al testo; opzioni lunghe su telefono | Selettori nativi con chevron SVG uniforme e spazio riservato; etichette senza parole ripetute | Hit area e tastiera restano native, freccia e testo non si coprono |
| Vista recuperabile soltanto ripetendo i controlli                   | Link con filtri, camera e fermata/tratto, validato prima del ripristino                       | Riaprire un risultato verificabile senza richieste alla fonte      |
| Estremi del tratto riconoscibili solo nei nomi                      | Punti A/B sulla mappa alle coordinate ufficiali e nel dettaglio                               | Collegare il percorso selezionato ai nomi delle fermate            |

`view-state.mjs` limita i parametri, le identità e i valori della camera.
Il controller verifica linea/fermata/tratto contro la città caricata prima del
ripristino. Nessun dato grezzo, HTML o indirizzo remoto arriva dai parametri URL.
La clipboard è facoltativa: se non disponibile compare un campo selezionabile.
L'HTML di anteprima si apre con una versione esplicita della query per non
riusare una vecchia copia del documento; gli asset mantengono hash completi.

Palermo e Padova usano lo stesso percorso di acquisizione/analisi, senza API in
tempo reale. Limiti particolari del feed e date diverse restano visibili nelle
fonti, senza correzioni silenziose ai dati originali.

Il fit centra gli estremi nello spazio proiettato, includendo la quota dei
rilievi, prima di scegliere la scala. Il difetto di margini sbilanciati è
riprodotto da un test RED prima della correzione. La selezione di un tratto
ricalcola la scala sul tratto; le altre tracce si attenuano senza invalidare i
buffer. Le reti nuove partono da una vista completa, mentre Centro resta un
comando distinto da Inquadra.

## Iterazione 5: dettagli e disclosure

| Before                                              | After                                                                          | Why                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Icona Centro 3,5 px a sinistra a 573 px             | Pulsante mobile 40×40 e icona centrata; gruppo icona/testo centrato su desktop | Allineamento ottico e hit area coerenti con gli altri controlli           |
| Frecce native nei tre pannelli, apertura istantanea | Righe con +/− SVG e altezza animata 180/140 ms con easing breve                | Rendere apertura e chiusura leggibili senza rallentare le azioni ripetute |
| Testi metodologici lunghi                           | Quattro paragrafi brevi con metrica, rilievi, copertura e limiti               | Ridurre lettura conservando i vincoli del dato                            |
| Icone testuali CSV e paginazione                    | SVG dello stesso peso e gruppi centrati                                        | Evitare differenze di baseline e glifi dipendenti dal font                |

`disclosure.mjs` migliora i `<details>` esistenti senza dipendenze. Una WeakMap
impedisce doppie inizializzazioni senza trattenere pannelli rimossi. L’animazione
si interrompe dalla sua altezza corrente; il completamento rimuove gli stili
fissi. La tastiera e `prefers-reduced-motion` usano il cambio immediato. Il corpo
in chiusura è inert e il focus rimane sul riepilogo.

Cambio città, resize e sostituzione del dettaglio completano le animazioni attive
prima di aggiornare il contenuto. Nessun observer permanente per ogni pannello,
loop inattivo, servizio remoto o richiesta aggiuntiva. L’animazione dell’altezza
è limitata ai pannelli informativi e non ricostruisce la mappa.

## Iterazione 6: menu aperti e copertura multimodale

| Before                                                     | After                                                                                   | Why                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Una sola rete per città, bus e tram senza scelta esplicita | Città raggruppata e scelta compatta del mezzo; elenco delle reti integrate nel menu     | Rendere visibile la copertura parziale senza suggerire che gli altri mezzi non esistano |
| Popup nativi non personalizzabili                          | Menu ricercabili, check, nomi lunghi a capo, altezza e posizione limitate alla viewport | Evitare opzioni tagliate e facilitare liste con molte linee                             |
| +/− in un cerchio a destra                                 | Icona nuda a sinistra, peso coerente e animazione breve già accessibile                 | Seguire il feedback senza aggiungere decorazioni o tempi di attesa                      |
| Date di servizio e acquisizione                            | Anche data del file quando fornita dal titolare                                         | Rendere visibile un archivio vecchio con calendario futuro                              |

Gli ID dei dataset restano distinti dagli ID delle città e dal modo di vista
2D/3D. Non si sommano tempi o velocità di mezzi diversi. I nuovi mezzi riusano gli
archivi e la cartografia verificati, mentre il client continua a decodificare
solo la rete richiesta e mantiene due reti in cache.

Il test Browser ha riprodotto due popup contemporanei aprendo Linea da tastiera
dopo una ricerca fermate. L’apertura del selettore ora chiude la ricerca prima di
spostare il focus. I menu scorrono internamente e non usano scrollIntoView per
spostare accidentalmente la pagina. Nessuna dipendenza o loop grafico aggiunto.

## Iterazione 7: gerarchia, mappa ed esportazione

| Before                                                           | After                                                                                                        | Why                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Campi mobile 12 px, valori secondari del dettaglio 9 px          | Campi 16 px, valori 11 px e pulsanti 2D/3D 44×44                                                             | Migliorare lettura e precisione del tocco                                       |
| Dettaglio che può coprire comandi o punti del tratto dopo resize | Inquadratura nell’area libera calcolata dagli ingombri reali; test geometrico scritto prima della correzione | Tenere visibili A/B, rilievi e comandi senza correggere a mano le singole città |
| Nomi di strada che occupano prima lo spazio delle città          | Priorità a città/quartieri, collisioni conservate e ordine preparato una volta                               | Rendere leggibile la geografia mantenendo lo stesso dato                        |
| Righe precedenti ancora cliccabili durante un cambio lento       | Inert e aria-busy, dettaglio chiuso e download superati annullati                                            | Evitare selezioni e letture appartenenti alla città precedente                  |
| Esportazione dei soli dati CSV                                   | Anche PNG della vista, con scala, nord, legenda e fonti                                                      | Condividere una figura leggibile e attribuita senza ritagliare uno screenshot   |

La resa resta sobria: tipografia di sistema, contrasto controllato, bordi
morbidi e ombre leggere. Nessun font remoto, blur, animazione decorativa o
nuova dipendenza. Il Canvas continua a disegnare solo su interazione/resize.
L’errore di esportazione è visibile; preparazione e successo sono annunciati
senza spostare i contenuti. La chiusura del dettaglio usa un SVG coerente.

## Iterazione 8: ordinamento senza altri pannelli

| Before | After | Why |
| --- | --- | --- |
| Tabella sempre dal tratto più lento | Intestazioni km/h e Corse attivabili in entrambi i versi | Esaminare anche tratti veloci o con più corse, senza nuova toolbar |
| Indicazione di ordine fissa | Una sola colonna con aria-sort attivo, freccia coerente, nome accessibile dell’azione successiva | Tastiera e lettore schermo ricevono lo stesso stato della UI |
| Righe senza riscontro al passaggio del mouse | Hover tenue, distinto dalla selezione | Rendere evidente che l’intera riga porta al tratto sulla mappa |
| Mappa Lucca limitata al centro | Estratto che copre l’intero perimetro studiato | Dare contesto anche ai tratti periferici selezionati |

Nessuna animazione aggiunta all’ordinamento frequente: cambio immediato, focus sull’intestazione e prima pagina ripristinata. La selezione rimane attiva se ancora presente. Valori, geometrie e metodo non cambiano. Hit area delle intestazioni almeno 44×44 px nei viewport verificati.

## Iterazione 9: dettaglio utilizzabile e contrasto contestuale

| Before | After | Why |
| --- | --- | --- |
| Badge linea statico, alto circa 22 px | Pulsante con filtro, almeno 44×44 px, stato e nome accessibili | Esplorare una linea dal tratto senza risalire alla toolbar |
| Altri tratti al 38% anche quando la selezione è fuori vista | Contesto al 20% con selezione visibile, al 100% fuori vista | Leggere il tratto scelto nelle reti dense e recuperare contesto dopo uno spostamento |
| Proiezioni accettate fino a 250 m dalle fermate | Massimo 100 m, esclusioni e metodo visibili nelle fonti | Evitare falsi tratti lentissimi dovuti all’allineamento GTFS |

Filtro e contrasto cambiano subito, senza animazioni su azioni ripetute. La ricerca del tratto selezionato viene riutilizzata nel renderer; non è aggiunta una seconda scansione. Nessuna dipendenza o richiesta remota durante l’uso. Nomi lunghi e chiusura verificati separati a 320/390/573/1280 px.


## Iterazione 10: precisione dei controlli

| Before | After | Why |
| --- | --- | --- |
| Per togliere una linea serviva riaprire il menu o azzerare tutti i filtri | X da 44 px accanto al selettore, focus restituito alla linea | Conservare velocità, fascia e ordine con una sola azione |
| La freccia poteva restringersi con un nome lungo | Chevron a larghezza fissa, X in uno spazio separato | Rendere riconoscibili apertura e rimozione anche a 320 px |
| Massimo zoom frazionario arrotondato dallo step, “+” ancora attivo | Limiti condivisi con la camera e slider continuo; pulsanti disabilitati agli estremi | Evitare comandi senza effetto e stati incoerenti dopo un resize |
| Un aggiornamento della camera poteva riattivare controlli durante l’attesa | Zoom, inclinazione e rilievi rispettano lo stato di caricamento | Evitare modifiche della rete precedente mentre arriva quella nuova |

Nessuna animazione aggiunta a filtri o zoom frequenti. Altezza della toolbar
invariata quando compare la X, contrasto e hit area coerenti con i controlli
esistenti. Verifica Browser a 320, 390, 573 e 1280 px; telefono fisico non testato.


## Iterazione 11: leggere un tratto senza aprire il dettaglio

| Before | After | Why |
| --- | --- | --- |
| Tooltip scuro con una riga di testo | Scheda chiara con linea, velocità allineata e due fermate | Rendere leggibile il tratto senza aggiungere azioni o testo superfluo |
| Posizione calcolata con larghezza fissa di 235 px | Misura reale della scheda e margine di 8 px su tutti i bordi | Una linea lunga usciva di 25 px dalla mappa |
| Tooltip ancora visibile dopo lo zoom | Chiusura su cambi di vista o contesto | Evitare informazioni agganciate a un punto ormai spostato |
| Nuove reti interamente inquadrate anche su mobile | Apertura sul centro; Inquadra per tutta la rete | Evitare una rete minuscola al primo accesso, mantenendo la vista completa |

Nessuna animazione su hover o tastiera. Dimensioni misurate solo al cambio del
tratto, poi solo transform; nessun loop inattivo o nuova richiesta remota.
Nomi lunghi limitati a due righe nella scheda transitoria, completi in tabella
e nel dettaglio. La navigazione resta un mezzo distinto nel selettore di Venezia.


## Iterazione 12: dare spazio alla mappa

| Prima | Dopo | Perché |
| --- | --- | --- |
| Data nell'intestazione e testo tecnico nel masthead | Marchio e titolo; data nelle fonti e negli export | Eliminare duplicazioni conservando la provenienza |
| Titolo mobile vincolato a 240 px | Larghezza disponibile del contenitore | Evitare righe aggiuntive senza utilità |
| Contatore che ripete il nome della linea | Solo numero di tratti | Il filtro e il titolo della mappa identificano già la linea |
| Condivisione 32 px, mezzo 38 px e chiusura 40 px | Target di almeno 44 px | Migliorare la selezione mobile senza sovrapporre controlli |
| Vecchio documento ancora sulla porta stabile | Promozione atomica della preview verificata | Evitare valutazioni di una versione superata e conservare gli artifact |

Nessuna animazione aggiunta alle operazioni frequenti. I cambiamenti non
alterano camera, misure, ordinamento, navigazione da tastiera o accesso alle
fonti. I dati nuovi seguono gli stessi budget e controlli delle reti esistenti.


## Iterazione 13: ricerca e gerarchia cartografica

| Before | After | Why |
| --- | --- | --- |
| «Roma bus» restituisce zero risultati perché le parole non sono contigue | Tutte le parole cercate possono comparire nel nome o nel sottotitolo, in qualsiasi ordine | Trovare una città usando nome e mezzo senza cambiare i valori del selettore |
| Strade quasi bianche e contorni marcati sotto le curve | Strade leggermente più tenui, stesse geometrie e stesse etichette | Rendere la rete dei mezzi il livello visivo principale |
| Velocità in tabella prive di richiamo alla mappa | Piccolo indicatore decorativo con la stessa funzione colore del renderer | Collegare tabella e mappa conservando il numero, anche senza percezione dei colori |

Nessuna nuova animazione, opzione o testo permanente. Tastiera e ricerca
restano immediate; nessuna modifica a camera, rilievi, calcoli o ordinamenti.

## Iterazione 14: leggere i treni senza confondere due misure

| Prima | Dopo | Perché |
| --- | --- | --- |
| Solo velocità programmate per area | Navigazione Mappa / Treni; rilevazioni salvate in pagina distinta | Distinguere orario e ritardo osservato |
| Nessuna lettura nazionale della corsa | Grafico, arrivo, picco, aumento e tabella delle fermate | Individuare dove cambia il ritardo, senza attribuire cause |
| Previsioni mescolabili ai passaggi | Vuoti espliciti, linea interrotta, copertura e data della corsa | Non inventare arrivi o serie complete |
| Catalogo solo città | “Città o tratta” e corridoio ferroviario con perimetro dichiarato | Non chiamare città un collegamento |
| Possibile fusione di corse sulla stessa geometria | Filtro manuale per numero e chiave distinta per corsa | Conservare identità e numero di campioni |

Grafico senza animazione all'aggiornamento, valori precisi nella tabella e
nel CSV. Menu riusato, controlli da almeno 44 px, nessun polling. Su mobile
la tabella scorre nel proprio contenitore e conserva visibile la fermata.

La tratta dichiara viewWidthMetres=160000: il contesto geografico determina
la scala iniziale e il resize, mentre il default urbano resta 6500 metri.
L'assenza del fondo OSM non diventa una mappa presunta: stazioni GTFS
etichettate, avviso laterale e attribuzione del fondo nascosta.
