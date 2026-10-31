# Verifica ripetibile

## Dati e contratti offline

1. Acquisire/verificare GTFS e OSM con i comandi del README. Le ricevute in
   `observed-results.json` identificano i byte usati; un download successivo
   dallo stesso URL non riproduce necessariamente questi numeri.
2. Generare schema 3 con `--date 2026-10-30 --city-date cagliari=2026-10-31`.
   Non scegliere automaticamente un giorno diverso quando il calendario manca.
3. Eseguire 25 test Python e 15 Node con i comandi del README. Le fixture sono
   sintetiche e non entrano nel visualizzatore. I nuovi casi di errore sono
   stati definiti e verificati in RED prima delle implementazioni.
4. Confrontare i segmenti delle città preesistenti con l'artifact v2: geometrie,
   identità e statistiche per fascia devono rimanere identiche. Controllare che
   la ricerca usi coordinate/identità di `stops.txt`, anche per nomi duplicati.
5. Verificare hash, byte, URL, perimetro, provider, acquisizione e data base OSM
   di ogni ricevuta. Nessuna risposta parziale deve diventare un basemap vuoto.
6. Verificare ogni `cities/*.json.gz`: hash e dimensione del manifest, contenuto
   decompresso identico alla città nell'analisi. Controllare anche il bundle
   JS generato con `node --check`. In modalità `--standalone`, CSP deve vietare
   connessioni e i dati devono essere incorporati nell'HTML.

## Browser

Servire l'output in loopback. Usare azioni reali senza modificare DOM o stato
interno per simulare risultati. I dataset del Canvas descrivono l'ultimo disegno,
non prestazioni certificate del dispositivo né costi hosted.

- Otto città × quattro fasce: sette città utilizzabili; Bari deve mostrare
  indisponibilità e zero righe, conservando la data scelta. Confrontare conteggi
  e prima velocità con `analysis.json`. Fonti e data devono seguire la città.
- Sette città × quattro classi di velocità: conteggi equivalenti al JSON,
  confini 10/15/25 coerenti, stato vuoto e CSV disabilitato quando non ci sono
  tratti. Il cambio linea/velocità deve azzerare la pagina della tabella.
- Tabella/dettaglio: selezionare con tastiera, verificare velocità, durata e
  campioni; cambiare fascia e conservare il tratto quando esiste. Provare
  paginazione, chiusura dettaglio e rimozione delle selezioni incompatibili.
- Cercare nome, accenti, codice e testo senza risultati. Frecce/Invio/Escape;
  omonimi distinti, selezione fermata e relativo filtro linea. Scaricare un CSV
  reale e confrontare tutte le righe con il JSON, inclusi hash e data.
- Camera: slider e zoom devono concordare ai limiti; angolo normalizzato,
  bussola verso nord, fit con inclinazione/rilievo estremi e nessun NaN.
  Verificare 2D/3D, tastiera, pan, reset e resize. La vista espansa deve limitare
  il focus alla mappa, disattivare il resto della pagina e chiudersi con Escape.
- Cambi città rapidi: prevale l'ultima scelta; nessun dato o fonte precedente.
  Fixture con asset assente e corrotto: mostrare errore e svuotare fonte,
  tabella/dettaglio. Ripristinare il file e verificare recupero da una nuova
  selezione senza ricaricare la pagina o svuotare manualmente la cache.
- Sette città a 320, 390 e 768 px: misurare la larghezza effettiva del documento,
  non soltanto l'override richiesto al Browser. Nessun overflow globale o
  sovrapposizione fra controlli visibili. Escludere dalla misura i discendenti
  di `<details>` chiusi. Provare il dettaglio aperto a 320/390 px e lasciare
  liberi zoom/bussola. Verificare il toggle di esplorazione mobile.
- Preservare attribuzioni GTT/OSM e limiti di copertura. Roma solo linea 8;
  Venezia automobilistico, non vaporetti; Cagliari 31/10, altri 30/10.
- Console normale senza warning/error. La consegna a directory richiede solo
  asset locali, con cache dati massima di due città; nessun servizio remoto.
  L'errore HTTP della fixture mancante è atteso e separato dalla console normale.

## Artifact e confini della prova

Consegna v3 nella cartella visualizzazioni della chat `gtfs-20261031-v3`:
output statico, HTML offline, analisi, screenshot, matrici JSON, CSV realmente
scaricato e ricevute di integrità/recupero. `data-contract-check.json` registra
il confronto con v2; `responsive-checks.json` registra le viewport effettive.
I tentativi iniziali con override non applicato sono conservati come
`viewport-unapplied.json` e non contano come prove responsive riuscite.

Il Browser in-app non supporta l'iniezione touch. Pinch, twist e scorrimento su
telefono fisico restano **NOT RUN**. La trasformazione matematica e il toggle
sono verificati separatamente; non sostituiscono una prova sul dispositivo.

Integrazione nel sito, corpus, gate Next/ETL, CI, deployment e risparmio in
fattura: **NOT RUN**. Prima della pubblicazione servono ledger, review licenze,
gate del prodotto e prova fisica mobile. Nessuna build Vercel per questa ricerca.
