# Verifica ripetibile del prototipo

## Dati

1. Acquisire o verificare gli archivi con `acquire.py` (vedi README).
2. Generare `analysis.json` e `index.html` con `analyze.py`, data 2026-10-30.
3. Verificare con gli stessi byte i conteggi e gli hash nel README.
4. Eseguire gli undici test offline. Le fixture sono sintetiche, non usate dalla UI.

## Interfaccia

Servire `output` in loopback sulla porta 3274. Usare Browser, senza accedere a
variabili globali dell'app o modificare il DOM per simulare interazioni.

1. Desktop 1280 × 900: scegliere ciascuna delle tre città e tutte le quattro fasce.
   La mappa deve mostrare tratti, la tabella fino a 20 righe. Selezionare la prima
   riga e confrontare km/h nel dettaglio con il valore della riga; un cambio fascia
   conserva il tratto selezionato se ancora disponibile, non sceglie sempre il primo.
2. Passare a 2D e tornare a 3D: `aria-pressed` deve rispecchiare la vista.
3. Selezionare una linea; usare anche la tastiera per selettore e bottone della riga.
   Il titolo della mappa e il dettaglio devono riferirsi alla selezione corrente.
4. Muovere rotazione e zoom con le frecce. Ripristina deve riportarli a −20° e 100.
5. Ripetere le tre città a 320, 390 e 768 px. Larghezza documento uguale al viewport;
   tabella scorrevole nel proprio contenitore, controlli raggiungibili.
6. Aprire Copertura e dati esclusi: Roma deve riportare 1 linea attiva su 5, non
   fingere la copertura integrale della rete. La licenza non verificata deve restare
   esplicita; per Torino deve apparire l'attribuzione GTT.
7. Controllare console warning/error; salvare screenshot desktop e mobile e gli
   esiti strutturati con città, fascia, viewport, numero tratti e righe.

Le prove della task sono locali. Non certificano dati real-time, integrazione
nel sito, CI o deployment. Nessuna preview/build Vercel deve partire per questa prova.
