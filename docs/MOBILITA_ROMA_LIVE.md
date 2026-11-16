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

## Percorsi del dato

| Pezzo | File |
| --- | --- |
| Parser protobuf (numerazione gtfs-realtime.proto 2.0) e fetch | [roma-gtfs-realtime.ts](../src/lib/mobilita/roma-gtfs-realtime.ts) |
| Proxy pubblico | [api/mobilita/roma/vehicles](../src/app/api/mobilita/roma/vehicles/route.ts) |
| Modello puro (abbinamento corsa→percorso, direzione, fermate, ricerca) | [roma-live-model.ts](../src/lib/mobilita/roma-live-model.ts) |
| Rete statica compatta e manifest | `public/mappe/mobilita/roma/network-<sha12>.json`, [roma-network-asset.ts](../src/lib/mobilita/roma-network-asset.ts) |
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
  per 10 s; un errore non viene mai riusato come successo.
- Feed ~115 KB protobuf, risposta ~240 KB JSON (~45 KB compressa), parsing
  di pochi ms. Timeout 10 s, limite 5 MB.
- Il client interroga ogni 15 s solo con la scheda visibile, con backoff
  esponenziale fino a 2 minuti sugli errori. La vista live (MapLibre, ~250 KB
  gzip) si scarica solo quando viene aperta; la pagina resta statica.
- Cartografia: tile vettoriali OpenStreetMap di OpenFreeMap, senza chiave,
  richieste direttamente dal browser. La CSP report-only consente
  `connect-src https://tiles.openfreemap.org` e `worker-src 'self' blob:`.

## Aggiornare la rete statica

Il GTFS statico cambia quasi ogni giorno; linee o fermate nuove compaiono nel
live con «percorso non disponibile» finché la rete non viene rigenerata.

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
- `tests/roma-network-asset.test.mjs`: manifest e rete pubblicata coincidono.
- `scripts/browser/mappe-mobilita.mjs`: vista live a 390 e 1280 px con feed e
  tile simulati (offline), ricerca, segui mezzo, URL condivisibile, Esc,
  indietro alla vista velocità, feed non disponibile.
