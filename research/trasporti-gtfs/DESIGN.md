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
