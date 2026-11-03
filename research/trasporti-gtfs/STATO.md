# Stato del prototipo mobilità

Aggiornato il 3 novembre 2026. Branch: `codex/gtfs-grandi-citta`.
Codice funzionale verificato: `9081fd07`; incorporato `main` `c3fa7372` senza
conflitti. Il confronto con main aggiunge soltanto `research/trasporti-gtfs/`.
Il branch conserva tutte le iterazioni; non è un rilascio del sito pubblico.
Vercel Preview → Branch Tracking è stato verificato disabilitato il 3 novembre;
nessuna configurazione o build è stata avviata manualmente.

## Che cosa funziona

| Area | Implementato |
| --- | --- |
| Dati | Acquisizione manuale dei GTFS ufficiali, calendari Europe/Rome, mezzi e perimetri espliciti, ricevute con URL, date, byte e SHA-256 |
| Analisi | Tempi programmati fra fermate adiacenti, geometrie GTFS, direzioni e varianti separate, mediane per quattro fasce, conteggio delle esclusioni |
| Mappa | Strade, acqua, verde e nomi OSM dove acquisiti; 2D/3D, zoom, pan, rotazione, bussola, inclinazione, scala del rilievo, centro, inquadra ed espansione |
| Ricerca | Città/tratta e mezzo, menu ricercabili, linea, fermata per nome/ID, filtri di velocità; ricerca per più parole senza accenti |
| Lettura | Selezione dalla mappa o tabella, dettaglio, ordinamento, paginazione, fonti e metodo in accordion |
| Esportazione | CSV dei tratti selezionati, PNG della mappa, link con filtri/camera/selezione; date e provenance negli export |
| Treni rilevati | Pagina separata con due corse, grafico, tabella, ritardo all'arrivo, picco, maggiore aumento, recuperi, fonte e CSV |
| UI | Layout responsive, menu da tastiera, focus, controlli touch, gestione dello scroll mobile, disclosure animate e movimento ridotto |
| Consegna | Asset gzip per la sola rete scelta, controllo hash/byte, cache di due reti; anche HTML autonomi senza connessioni |
| Costi | Nessun tile/font remoto, polling, API AI, acquisizione durante una visita o nuova funzione Vercel |

La quota 3D mostra minuti programmati per chilometro, non altitudine o ritardo
reale. Il grafico ferroviario usa invece passaggi rilevati: le due misure non
sono mescolate. Dati mancanti, zero e anticipi rimangono distinti.

## Copertura attuale

34 fonti registrate, 32 reti utilizzabili, 44.798 tratti: 20 città e una tratta.
“Utilizzabile” non significa rete cittadina completa. Date dal 30 ottobre al
2 novembre 2026, esplicite per fonte: non sono gli orari aggiornati in diretta.

| Città | Mezzi con tratti validati |
| --- | --- |
| Bologna | Bus |
| Cagliari | Bus, tram |
| Catania | Bus |
| Ferrara | Bus |
| Firenze | Tram, treni |
| Livorno | Treni |
| Lucca | Treni |
| Milano | Bus, tram, metro |
| Nuoro | Bus, treni |
| Olbia | Bus |
| Padova | Tram |
| Palermo | Tram, copertura parziale |
| Pisa | Treni |
| Prato | Treni |
| Roma | Bus, tram, metro; tram limitato ai dati utilizzabili della linea 8 |
| Rovereto | Bus |
| Sassari | Bus, treni; tram escluso per geometrie mancanti |
| Torino | Bus, tram, metro |
| Trento | Bus; ferrovia non confrontabile |
| Venezia | Bus, navigazione nell'area dichiarata |

La tratta aggiuntiva **Verona–Bolzano** contiene sei tratti GTFS dei FR 8509 e
8519. Gli altri 21 su 27 non superano il controllo geometrico entro 100 metri.
Il fondo OSM nuovo non è disponibile dopo 504, 502 e timeout dei provider:
sono mostrati i tracciati e i nomi GTFS delle stazioni, con avviso esplicito.
Bari resta non disponibile per il calendario acquisito; i 48 treni attivi di
Trento non hanno geometrie utilizzabili. Nessuna retta inventata per riempire i vuoti.

### Passaggi ferroviari rilevati

- FR 8509 Sibari–Bolzano, 2 novembre: 14/14 passaggi; arrivo +22 minuti,
  picco +38 a Napoli Afragola, aumento maggiore Paola–Scalea +21.
- FR 8519 Bolzano–Sibari, stesso giorno: 8/13 passaggi al salvataggio;
  gli ultimi cinque sono previsioni e non vengono trattati come osservazioni.

Le variazioni fra arrivi possono includere la sosta precedente. Questi dati
non spiegano le cause né dimostrano frequenza o ricorrenza dei ritardi.

## Verifiche e confini

- **PASS**, ripetuti il 3 novembre dopo l'allineamento: 48 test Python e 28 Node.
- **PASS**, evidenze Browser del 2 novembre: 136 combinazioni fonte/fascia,
  valori e date confrontati, otto viste ferroviarie a 320/390/573/1280 px,
  menu/tastiera, dati mancanti, errori nei link, CSV, camera/resize e HTML autonomi.
- **PASS**: i 32 oggetti dati precedenti sono identici; hash/byte degli asset verificati.
- **NOT RUN**: dispositivo fisico, screen reader reale e clipboard virtuale completa.
  La copia segnala successo, ma il Browser non espone lettura/incolla della clipboard.
- Nessun gate Next/ETL/CI o build di produzione: questo aggiornamento riguarda
  soltanto il prototipo. L'integrazione nel prodotto richiederà i suoi gate.

I file raw, i bundle generati e gli screenshot sono fuori Git. Il repository
contiene codice, registro delle fonti, ricevute/conteggi e documentazione.
Un nuovo download da un URL aggiornabile non ricrea necessariamente lo stesso
snapshot: per una riproduzione numerica identica servono i byte conservati.

## Da completare

1. **Copertura ferroviaria nazionale**: altri AV, Intercity e regionali, con
   calendari e geometrie utilizzabili. Non abbiamo una mappa di tutti i treni italiani.
2. **Storico dei passaggi effettivi**: fonte e condizioni di riuso, date complete
   degli eventi, cancellazioni, deviazioni e attraversamenti della mezzanotte.
   Solo dopo uno storico si possono confrontare tratte, ricorrenze e fasce.
3. **Cause dei rallentamenti**: servono dati ulteriori e verifiche indipendenti;
   le differenze di ritardo da sole non distinguono traffico, guasti, soste o infrastruttura.
4. **Geometrie e fondo mancanti**: completare la tratta ferroviaria e OSM;
   risolvere i candidati senza shape, senza allentare i controlli di qualità.
5. **Altre città e mezzi**: nuove fonti ufficiali, metro e ferrovia nelle città
   esistenti, verifica dei candidati ancora non convertiti o non utilizzabili.
6. **Licenze e aggiornamenti**: chiarire le fonti con condizioni incomplete e il
   riuso ViaggiaTreno prima di un servizio pubblico/storico. Nessun refresh automatico attivo.
7. **QA accessibile su dispositivi reali**: touch, pinch/rotazione, VoiceOver,
   browser differenti e degradazione su dispositivi meno potenti.
8. **Integrazione nel sito**: decidere URL e collocazione, corpus/provenance,
   aggiornamenti e distribuzione degli snapshot, budget e cache, controlli del
   prodotto e revisione finale. Al momento non esiste una pagina pubblicata su DVNS.

Fonti e comandi: [README](README.md). Scelte: [DESIGN](DESIGN.md).
Prove: [VERIFY](VERIFY.md). Ricevute e risultati: [observed-results.json](observed-results.json).
