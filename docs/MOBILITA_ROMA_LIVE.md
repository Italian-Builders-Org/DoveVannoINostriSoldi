# Bus Roma in tempo reale

Seconda vista della [mappa della mobilità](../src/app/mappe/mobilita/page.tsx):
`/mappe/mobilita?vista=bus-live`. La prima vista (velocità programmate di tutte
le città) resta invariata nell'iframe del prototipo GTFS.

## Cosa mostra

- Posizione degli autobus ATAC e Roma TPL dal feed GTFS-Realtime
  «VehiclePositions» di Roma Servizi per la Mobilità. Tram e metro non sono nel
  feed: la UI lo dice invece di mostrare zero mezzi.
- Ricerca per linea o numero di vettura, linee salvate (solo nel browser),
  autobus vicini (la posizione non lascia il browser).
- Linea selezionata: percorsi per direzione, fermate, mezzi raggruppati per
  direzione. Mezzo seguito: capolinea, prossima fermata, fermate successive,
  età della posizione, affollamento dichiarato, link condivisibile
  (`&linea=…&vettura=…`).
- Le posizioni hanno 30-60 s di ritardo all'origine. Oltre 2 minuti il mezzo è
  attenuato, oltre 5 è tratteggiato. Un feed fermo da più di 5 minuti viene
  segnalato. Nessuna posizione è estrapolata: l'animazione interpola soltanto
  tra la posizione disegnata e quella nuova.
- Alcune linee possono mancare dal feed anche in orario di servizio: il pannello
  lo dichiara come assenza dal feed, non come linea ferma.
- Arrivi previsti (feed «TripUpdates»): orario previsto a ogni fermata
  successiva del mezzo seguito, ritardo rispetto all'orario, tabellone per
  fermata (ricerca per nome o codice, fermate entro 500 m). Sono stime
  dell'operatore; tram e metro non hanno arrivi nel feed. Le fermate saltate e
  le corse cancellate non diventano arrivi.
- Colore per ritardo: verde in orario (±2 min), arancione 2-5 min, rosso 5-10
  min, bordeaux oltre 10 min, blu in anticipo, grigio non indicato.
- «Puntualità ora»: percentuale e numero di autobus per fascia, dalla stima
  dell'operatore alla prossima fermata di ogni mezzo (un conteggio per veicolo,
  corse cancellate e corse senza mezzo escluse; ritardo mancante = «non
  indicato», mai «in orario»). Il ritardo pubblicato coincide con «previsto
  meno programmato» sul GTFS statico (verificato su 300 corse il 16/11/2026);
  la quota «in anticipo» è alta (~37%) e riguarda mezzi lungo il percorso, non
  in attesa al capolinea: è il dato dell'operatore, non una nostra stima.
- Segnaposto dei mezzi: cerchio nel colore di stato con il pittogramma bus del
  set di icone del sito, tacca di direzione e numero di linea, sempre allineati
  allo schermo; a zoom bassi o dove si sovrappongono restano punti. Vista 2D
  (piatta, nord in alto) o 3D (inclinata, ruotabile, edifici in rilievo).
- Servizio in questo momento: autobus nel feed contro corse programmate in
  corso dall'orario ufficiale (solo linee autobus), con le linee che hanno corse
  programmate ma nessun mezzo nel feed. Fuori dal calendario pubblicato la
  sezione non compare: «nessun orario» non diventa «zero corse».

## Percorsi del dato

| Pezzo | File |
| --- | --- |
| Parser protobuf (numerazione gtfs-realtime.proto 2.0) e fetch | [roma-gtfs-realtime.ts](../src/lib/mobilita/roma-gtfs-realtime.ts) |
| Lettore protobuf condiviso (int32 negativi a 10 byte) | [protobuf-wire.ts](../src/lib/mobilita/protobuf-wire.ts) |
| Arrivi previsti (TripUpdates) | [roma-trip-updates.ts](../src/lib/mobilita/roma-trip-updates.ts) |
| Proxy pubblici | [api/mobilita/roma/vehicles](../src/app/api/mobilita/roma/vehicles/route.ts), [api/mobilita/roma/arrivals](../src/app/api/mobilita/roma/arrivals/route.ts), [api/mobilita/roma/punctuality](../src/app/api/mobilita/roma/punctuality/route.ts) |
| Modello puro (abbinamento corsa→percorso, direzione, fermate, ricerca) | [roma-live-model.ts](../src/lib/mobilita/roma-live-model.ts) |
| Rete statica compatta e manifest | `public/mappe/mobilita/roma/network-<sha12>.json`, [roma-network-asset.ts](../src/lib/mobilita/roma-network-asset.ts) |
| Corse programmate in corso | `public/mappe/mobilita/roma/coverage-<sha12>.json` (indice data → profilo) e `coverage/<sha12>.json` (per linea, una cifra base-62 ogni 10 minuti da 0 a 30 h del giorno di servizio) |
| UI | [mobilita-views.tsx](../src/app/mappe/mobilita/mobilita-views.tsx), [_live/](../src/app/mappe/mobilita/_live/) |

Il browser verifica dimensione e SHA-256 della rete prima di usarla. Le corse
live sono abbinate al percorso per linea, direzione e fermata corrente: gli
171k `trip_id` non vengono spediti.

## Costi runtime

- Una sola URL pubblica, senza parametri letti: `/api/mobilita/roma/vehicles`.
  `Cache-Control: public, max-age=5, s-maxage=15, stale-while-revalidate=30`;
  gli errori sono `no-store`. A cache CDN calda il feed ufficiale viene letto al
  massimo ~4 volte al minuto per regione, indipendentemente dai visitatori.
  Nella stessa istanza le richieste concorrenti condividono una sola lettura
  per 10 s; un errore non viene mai riusato come successo. Se l’upstream va in
  timeout o fallisce entro 5 minuti dall’ultimo successo sulla stessa istanza,
  la route risponde 200 con lo snapshot in memoria e `stale: true`; oltre 5
  minuti resta il 504.
- Feed ufficiale VehiclePositions:
  `https://romamobilita.it/wp-content/uploads/shared/rome_rtgtfs_vehicle_positions_feed.pb`
  (URL canonica senza redirect 301 dal path `sites/default/files/…`). TripUpdates:
  `https://romamobilita.it/wp-content/uploads/shared/rome_rtgtfs_trip_updates_feed.pb`.
- Feed ~115 KB protobuf, risposta ~240 KB JSON (~45 KB compressa), parsing
  di pochi ms. Timeout upstream 15 s, `maxDuration` della funzione 30 s, limite 5 MB.
- Arrivi: `/api/mobilita/roma/arrivals`, una sola URL senza parametri (niente
  URL per fermata o corsa), `s-maxage=30`. Il feed upstream pesa ~0,9 MB e si
  analizza in ~100 ms; la risposta compatta (fermate future entro 2 ore,
  orari come scarti in secondi) è ~450 KB JSON, ~130 KB compressa. Il client la
  chiede ogni 30 s solo mentre segue un mezzo, apre una fermata o usa i colori
  per ritardo.
- Puntualità: `/api/mobilita/roma/punctuality`, stessa lettura upstream e
  stessa finestra CDN degli arrivi (`s-maxage=30`), risposta di poche centinaia
  di byte con i soli conteggi per fascia: la vista live la chiede ogni 30 s
  mentre è visibile.
- Copertura: indice ~6 KB più due profili (oggi e ieri, ~13 KB compressi
  ciascuno), statici e verificati per hash. Nessun calcolo lato server.
- Il client interroga ogni 15 s solo con la scheda visibile, con backoff
  esponenziale fino a 2 minuti sugli errori. La vista live (MapLibre, ~290 KB
  gzip) si scarica solo quando viene aperta; la pagina resta statica.
- Cartografia: tile vettoriali OpenStreetMap di OpenFreeMap, senza chiave,
  richieste direttamente dal browser. La CSP report-only consente
  `connect-src https://tiles.openfreemap.org` e `worker-src 'self' blob:`.

## Aggiornare la rete statica

Il GTFS statico cambia quasi ogni giorno; linee o fermate nuove compaiono nel
live con «percorso non disponibile» finché la rete non viene rigenerata. Lo
stesso comando rigenera la copertura, che vale fino all'ultima data del
calendario pubblicato (oggi 23 dicembre 2026): oltre quella data la sezione
«Servizio in questo momento» sparisce finché non si rigenera.

```bash
curl -sSL -o /tmp/rome_static_gtfs.zip https://romamobilita.it/sites/default/files/rome_static_gtfs.zip
python3 scripts/research/build_roma_live_network.py --gtfs /tmp/rome_static_gtfs.zip \
  --acquired-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --last-modified "<Last-Modified HTTP>"
python3 scripts/research/build_roma_live_network.py --check
```

## Verifiche

- `tests/roma-gtfs-realtime.test.mjs`: numerazione dei campi (il timestamp è il
  campo 5, non lo stato del campo 4), campi mancanti distinti da zero,
  coordinate fuori area, protobuf troncato, feed fermo, limiti upstream.
- `tests/roma-live-model.test.mjs`: abbinamento al percorso, direzione senza
  bearing, fermate successive, ricerca, freschezza, nomi leggibili.
- `tests/roma-trip-updates.test.mjs`: ritardi negativi, fermate saltate, corse
  cancellate, orizzonte, protobuf troncato, feed fermo.
- `tests/roma-network-asset.test.mjs`: manifest, rete, indice e profili di
  copertura coincidono con i rispettivi hash e con lo stesso GTFS.
- `scripts/browser/mappe-mobilita.mjs`: vista live a 390 e 1280 px con feed,
  arrivi e tile simulati (offline): ricerca linea e fermata, tabellone, segui
  mezzo con orari previsti, Esc che torna alla fermata, colori per ritardo,
  copertura, URL condivisibile, indietro alla vista velocità, feed e arrivi non
  disponibili.
