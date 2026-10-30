# Verifica ripetibile

## Dati

1. Acquisire/verificare GTFS e OSM con i comandi del README.
2. Generare `analysis.json` e HTML per il servizio 2026-10-30. Gli hash devono
   coincidere con `observed-results.json`; un feed successivo non riproduce gli
   stessi numeri anche se ha il medesimo URL.
3. Eseguire i venti test offline e il controllo sintattico JS. Le fixture sono
   sintetiche, mai usate dal visualizzatore.
4. Confrontare i segmenti di Milano, Roma e Torino con l'artifact della prima
   iterazione: devono rimanere identici, inclusi geometrie e statistiche per fascia.
5. Verificare separatamente ricevute OSM: hash, byte, perimetro, provider,
   acquisizione e data base OSM. Nessuna risposta parziale deve essere accettata.

## Browser

Servire l'output in loopback. Interagire con il Browser senza modificare DOM o
stato interno per simulare i risultati. Le misure `data-*` del Canvas descrivono
solo l'ultimo disegno, non prestazioni certificate del dispositivo o costi hosted.

- Desktop: cinque città utilizzabili × quattro fasce. Mappa con strade e tratti,
  tabella paginata di 20 righe, fonte corrispondente alla città. Bari deve mostrare
  indisponibilità e zero righe per tutte le fasce, senza cambiare data.
- Tabella: selezionare una riga e confrontare km/h e corse con il dettaglio.
  Il cambio fascia conserva il tratto se disponibile; cambio città/linea elimina
  selezioni incompatibili. Provare pagine successive/precedenti e reset della
  pagina dopo un filtro; la tabella deve consentire tutti i tratti della selezione. La selezione dalla tabella porta alla mappa.
- 2D/3D: stato `aria-pressed` coerente, colori e statistiche invariati. Pan con
  trascinamento, zoom e rotazione da controlli/tastiera. Inquadra selezione e Centro
  svolgono azioni distinte; Ripristina riporta −20°, zoom 100 e vista 3D.
- Cambiare rapidamente città: l'ultima scelta deve prevalere anche durante la
  decompressione. Filtri e righe non devono provenire dalla città precedente.
- Ripetere a 320, 390 e 768 px: nessun overflow del documento, tabella scorrevole
  nel proprio contenitore, attribuzione visibile, dettagli chiudibili e controlli
  raggiungibili. Salvare screenshot desktop e mobile.
- Controllare copertura: Roma solo linea 8 nel feed acquisito; Bologna autobus
  nell'area di studio; Bari senza calendario del giorno. Licenze da verificare
  rimangono esplicite, attribuzione GTT e OSM preservata.
- Console warning/error e richieste di rete: nessun errore applicativo, nessun
  servizio remoto contattato dall'HTML durante esplorazione o cambio città.

Il Browser in-app non supporta `Input.dispatchTouchEvent`: pinch e scorrimento
su telefono fisico restano **NOT RUN**. Non presentarli come verificati da una
semplice emulazione di viewport. I listener gestiscono due pointer, ma questo
richiede una prova reale prima della pubblicazione.

Gli artifact della task sono locali: non certificano integrazione nel sito,
CI, deployment, realtime o risparmio in fattura. Nessuna build Vercel per questa
ricerca. Prima di integrare: gate del prodotto, ledger e review delle licenze.
