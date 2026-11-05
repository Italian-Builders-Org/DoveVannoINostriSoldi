# Stato del prototipo mobilità

Aggiornato il 4 novembre 2026. Explorer pubblico in
`public/mappe/mobilita/explorer/` ripubblicato con basemap OSM verificati per
tutte le reti (stessi segmenti GTFS; solo cartografia di fondo ripristinata).

## Che cosa funziona

| Area | Implementato |
| --- | --- |
| Dati | Acquisizione manuale dei GTFS ufficiali, calendari Europe/Rome, mezzi e perimetri espliciti, ricevute con URL, date, byte e SHA-256; reindirizzamenti ammessi solo verso host dichiarati nel registro |
| Geometrie | Shape GTFS; per i feed ferroviari senza shape (Trenord, EAV, Trento–Malè) percorso fra stazioni consecutive sui binari OSM, con soglie di aggancio (300 m) e deviazione (1,6× + 300 m). Mai rette inventate |
| Analisi | Tempi programmati fra fermate adiacenti, direzioni e varianti separate, mediane per quattro fasce, esclusioni contate per motivo |
| Mappa | Rilievi a gradiente continuo (il colore sale con la quota), tende e montanti, fermate scure; fondo neutro OSM; scale distinte per reti urbane e ferroviarie; altezza proporzionata all'estensione della vista; legenda anche dentro la mappa |
| Lettura | Pannello laterale: velocità media pesata sul tempo, linee/tratti/mediana, istogramma dei km per velocità, confronto fra fasce sugli stessi tratti, «Dove si va più piano» (un tratto per linea, ≥150 m, ≥2 corse) |
| Dettaglio tratto | Posizione rispetto alla rete, velocità nelle tre fasce, avviso quando il percorso è ricostruito su OSM |
| Ricerca | Città/tratta, mezzi a schede, fascia oraria a segmenti, linea, fermata per nome/ID, filtri di velocità; stato vuoto con azione per passare a una fascia che ha corse |
| Esportazione | CSV dei tratti, PNG con legenda della scala attiva, link alla vista |
| Treni rilevati | Corsa per corsa, grafico e tabella; **storico per treno** (stazione × giorno, media solo sui passaggi rilevati); serie nazionale ART (CC BY 4.0) come contesto |
| Consegna | Asset gzip per la sola rete scelta, controllo hash/byte, cache di due reti; HTML autonomi |
| Costi | Nessun tile/font remoto, polling, API o elaborazione durante una visita |

La quota della mappa mostra minuti programmati per chilometro, non ritardi.
Il ritardo osservato vive solo nella vista Treni: le due misure non sono mescolate.

## Copertura attuale

51 reti, tutte utilizzabili, **76.823 tratti** in 30 aree (prima: 32 reti, 44.798
tratti). 2.563 tratti hanno percorso ricostruito su binari OSM. Giorno di servizio
30 ottobre 2026 salvo dove indicato.

| Area | Mezzi e tratti |
| --- | --- |
| Bari | bus 2.662 (4 novembre: il feed non ha servizio dal 27 al 31 ottobre) |
| Bologna | bus 6.354 |
| Cagliari | bus 2.268, tram 28 (31 ottobre) |
| Catania | bus 2.713 |
| Ferrara | bus 2.210 |
| Firenze | tram 157, treni 408 |
| Genova | metro 12, funicolari/cremagliera/ascensori 46, bus 5.298 (15 luglio, validità dell'archivio regionale); treni 228 |
| Italia | treni 1.425: corse Trenitalia che passano per la Liguria, percorso completo |
| Livorno, Lucca, Pisa, Prato | treni 89, 130, 129, 76 |
| Lombardia | treni Trenord 1.789 (geometria OSM) |
| Messina | bus 5.572 |
| Milano | tram 1.024, metro 266, bus 5.174, treni Trenord 507 (OSM) |
| Napoli | metro 76, tram 120, funicolari 24, bus 5.184, treni EAV 251 (OSM) |
| Nuoro, Olbia, Sassari | bus 919, 853, 1.134; treni 2 e 4 |
| Padova | tram 73 (31 ottobre) |
| Palermo | tram 74 |
| Perugia | Minimetrò 12, bus 6.221 |
| Roma | tram 59, metro 172, bus 5.058 |
| Rovereto, Trento | bus 1.349, 1.687; Trento–Malè 16 (OSM) |
| Sardegna | treni ARST 60 |
| Toscana | treni regionali 2.522 |
| Torino | tram 591, metro 44, bus 6.429 |
| Venezia | bus 4.884, navigazione 434 (2 novembre) |
| Verona–Bolzano | FR 8509/8519, 6 tratti (2 novembre) |

### Storico dei passaggi ferroviari

- FR 8509 Sibari–Bolzano: 2 novembre (arrivo +22, picco +38 a Napoli Afragola)
  e 3 novembre (arrivo +5, picco +13 a Roma Tiburtina), 14/14 passaggi ciascuno.
- FR 8519 Bolzano–Sibari: 2 novembre 8/13 e 3 novembre 6/13 passaggi al
  salvataggio; le previsioni restano escluse.
- Le rilevazioni del 3 novembre sono **estratti** della scheda pubblica
  (titolo, stazioni e orari), dichiarati come tali nella vista: il browser
  integrato non consente di trasferire la pagina completa al disco locale.
- Contesto: ART, quota nazionale annua di treni regionali in ritardo
  (9,2% nel 2020, 11,2% nel 2023), CC BY 4.0.

Ricerca delle fonti storiche (3 novembre): nessun dataset aperto con licenza
a livello di linea o di treno. RFI pubblica PDF aggregati; OpenRitardi e
TrainStats derivano da ViaggiaTreno senza licenza e restano fuori. Lo storico
quindi cresce solo con rilevazioni salvate giorno per giorno.

## Verifiche e confini

- **PASS** 3 novembre: 60 test Python (analisi, router OSM, consegna, rail, sorgenti)
  e 36 Node (insights, explorer, camera, catalogo, view-state).
- **PASS** stress test nel browser integrato: tutte le reti caricate in sequenza,
  0 errori in console, 0,5–1,5 s per rete; layout 1440×900 e 375×812 senza
  overflow orizzontale.
- **NOT RUN**: dispositivo fisico, screen reader reale, gate Next/ETL del prodotto.

Cache, ricevute, estratti OSM e bundle generati restano fuori Git.

## Da completare

1. **Treni nazionali completi**: non esiste un GTFS Trenitalia nazionale ufficiale;
   oggi ci sono Liguria (con percorsi completi), Toscana, Lombardia, Campania EAV,
   Sardegna e Alto Adige. Mancano Piemonte (feed solo via API smartdatanet),
   Emilia-Romagna e Campania Trenitalia (NeTEx, non GTFS), Puglia (solo CSV).
2. **Storico**: continuare le rilevazioni giornaliere degli stessi treni;
   chiarire il riuso ViaggiaTreno prima di qualsiasi pubblicazione; chiedere a
   Regioni/AMP i dati di puntualità per linea (oggi solo PDF).
3. **Geometrie**: FR Verona–Bolzano fuori dall'estratto (21 coppie), stazioni EAV
   oltre 300 m dai binari OSM (51 coppie), Genova AMT comunale senza shape (usata la
   versione regionale), Lecce e Calabria senza shape.
4. **Licenze**: ANM, EAV, Busitalia Umbria, Roma, Venezia e Padova non dichiarano
   condizioni chiare; verificare prima della pubblicazione.
5. **QA reale** su telefoni e screen reader; **integrazione nel sito** (corpus,
   provenance, budget, gate del prodotto).

Fonti e comandi: [README](README.md). Scelte: [DESIGN](DESIGN.md).
Prove: [VERIFY](VERIFY.md). Ricevute e risultati: [observed-results.json](observed-results.json).
