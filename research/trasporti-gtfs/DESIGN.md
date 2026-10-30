# Struttura della prima iterazione

## Due alternative

| Struttura                                     | Vantaggi                                                                                  | Vincoli                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Integrazione immediata in Next/corpus         | Dataset interrogabile, navigazione condivisa                                              | Richiede ledger, policy, registri, budget bundle, gate e review delle licenze; anticipa scelte metodologiche ancora da provare |
| Pipeline e visualizzatore offline in research | Risultato reale ispezionabile, nessuna nuova route/funzione/polling, confronti ripetibili | Non è una feature pubblicata nel sito; l'integrazione nel corpus resta una fase distinta                                       |

Scelta: seconda alternativa per il branch esplorativo richiesto. Nessun artifact parallelo viene introdotto in src/data o nelle pagine Next. Per una futura pubblicazione: registrare il feed come derived-only nel corpus, chiudere il ledger e derivare da quei byte, non mantenere due acquisizioni.

## Contratto visibile

Una città e una fascia oraria per volta. Rete tramviaria del feed, non tutti i trasporti cittadini. Il rilievo rappresenta minuti programmati per chilometro; la quota non è altitudine. Una tabella equivalente consente selezione e lettura senza la mappa. Fonti, data del servizio, esclusioni e hash sono verificabili.

## Moduli e uso

`python3 analyze.py --cache DIR --date 2026-10-30 --output DIR`

- feeds.json: holder, URL canonico, licenza e condizioni per città.
- analyze.py: ZIP -> calendario attivo -> corse tram -> fermate adiacenti -> geometrie -> tempi mediani -> JSON/HTML locali.
- viewer.html: modello statico, dati incorporati in modo sicuro, proiezione 3D SVG e tabella; niente dipendenze o richieste remote.
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
