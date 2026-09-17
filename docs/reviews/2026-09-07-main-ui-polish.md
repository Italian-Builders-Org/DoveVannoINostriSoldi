# Revisione UI, issue #331

Base: `9a616572997f8cfa1794a883153cfa3dbbe30939` (`origin/main`).
Branch: `codex/main-ui-polish`. Anteprima della build verificata: http://localhost:3416/ (sviluppo: porta 3415).

## Risultato

Dati, periodo e filtri precedono le spiegazioni estese. Fonti, copertura, definizioni e metadati restano disponibili nei dettagli espandibili. La revisione percorre 192 pagine e varianti, comprese tutte le 91 schede del catalogo; l'elenco è in `2026-09-08-page-review.json`. Il controllo del contenuto nel Browser è distinto dalle misure automatiche e dagli screenshot dei layout rappresentativi.

- Geist con titoli più leggeri, gerarchia compatta e mappe petrolio. La home conserva la composizione della spesa e allinea i pannelli in due righe.
- Istruzione: filtri visibili, tabella degli indirizzi a larghezza piena, trend e pannelli senza tagli; “Non disponibile” sostituisce le sigle ambigue.
- Ricerca compatta sotto 1100 px; navigazione originale a fisarmonica adattata agli schermi bassi; footer compatto e mappa del sito espandibile.
- Banda di pubblicazione con frase e collegamento. Pausa, tastiera, hover, tab nascosta e movimento ridotto restano supportati; i controlli testuali appaiono al focus.
- Schede dati: etichette testuali da 16 px e peso 500. Identificativi di riga, codici IPA/fiscali e campi tecnici sono nei dettagli, con intestazioni leggibili nella vista principale. CIG, CUP, livelli contabili, valori e unità restano disponibili. Nessun campo sorgente è eliminato.
- Lo stesso trattamento dei codici tecnici si applica a Enti, Partecipazioni, catalogo Fonti, confronto SSN e aggiudicazioni. Le anteprime editoriali privilegiano colonne informative.
- Correzioni di leggibilità per istituzioni, territorio, debito, povertà, coesione, spese, imprese, progetti, report e studi.

## Limiti del dato preservati

Gli snapshot non sono cambiati. La presentazione conserva valori esatti, periodi, denominatori e la distinzione fra zero, celle vuote, dati mancanti e oscurati. Gli importi SIOPE grezzi in centesimi sono etichettati come tali.

Due riepiloghi generici sono stati disattivati: quello che mescolava livelli AT e CE nelle consulenze PNRR e quello che sommava massimali e spese in Auto e welfare. Le tabelle originali rimangono consultabili. I nomi assenti non vengono presentati come destinatari nominativi; le ricorrenze per denominazione non attestano l'identità del soggetto. Non si tratta di un nuovo audit dell'intero corpus delle fonti.

## Verifiche locali

- Controlli statici: lint, tipi, report, design e marchio superati; lint dei test browser e controllo design ripetuti dopo gli ultimi aggiornamenti. SHA delle GitHub Actions verificati: 20 file, 69 riferimenti.
- Node: 1.264 test, 1.263 superati nella suite completa. L'unico errore era l'attesa del vecchio testo “Codice fonte”; corretta l'attesa sul nuovo dettaglio, 8 test mirati superati; altri 11 test mirati superati dopo le correzioni di spaziatura. Nessun caso saltato nella suite finale eseguita con loopback disponibile.
- Test della proiezione: tutti i campi di tutte le schede compaiono esattamente una volta fra colonne e dettagli; campi sconosciuti, CIG, CUP, livelli contabili e importi restano nella vista principale.
- Snapshot: 38 verifiche superate. ETL: 623 casi, 613 superati, 7 saltati e 3 errori di socket nel sandbox; ripetuti tutti i 7 casi dell'offline guard con loopback disponibile, superati. Nessuna modifica successiva a ETL o snapshot.
- Build di produzione superata. Le prime esecuzioni si erano fermate per disco pieno; eliminate soltanto cache ricreabili di questa revisione dopo aver fermato il relativo server.
- Controlli browser su 194 percorsi a 390 e 1440 px, più home, assistente, tastiera e annunci a 11 larghezze: 414 casi superati. Dopo le ultime correzioni, ripetuti 18 controlli sulle 9 pagine e varianti interessate. La query del fatturato ISTAT è stata corretta in `metric=turnover` e verificata nel secondo gruppo.
- Coesione: verificata apertura e chiusura da tastiera di entrambe le tabelle (17 e 5 righe). Ultimo allineamento dei due pannelli verificato sulla build definitiva con altri 2 controlli responsive e ispezione nel Browser.
- Entrate: corretto il margine delle ancore di paginazione per includere annuncio e barra fissa anche su mobile. Gli 8 test UI delle entrate passano; prove browser a 320, 390, 768 e 1280 px superate con filtri, avanti/indietro, titolo visibile e totale nazionale invariato.
- Suite della build: assistente, allegati reali, dettatura, navigazione, paper, MCP HTTP/carico e tutti i 170 scenari funzionali delle pagine superati.
- Grafici: tastiera e puntatore, valori selezionati e variazioni confrontati con le tabelle; tutte le prove superate. Pagine editoriali: 21 percorsi a 390 e 1280 px superati. Report, edizioni mensili e studi: navigazione, metadati, denominatori e checksum del PDF superati. CSP Report-Only: 5 percorsi superati.
- Lighthouse su `/territori/irpef`, mediana di 3 esecuzioni: Performance 94, Accessibility 100, Best Practices 100, SEO 100; CLS 0, LCP 3.096 ms, FCP 1.206 ms, TBT 8,5 ms. Tutte le soglie bloccanti rispettate.

I controlli di produzione sono stati completati in più blocchi sulla stessa build. L'esecuzione di `test:production` ha superato i 170 scenari delle pagine, poi si è fermata su una lettura troppo anticipata della selezione di un grafico; corretta l'attesa, sono stati ripetuti quel gruppo e i successivi. Il percorso verso gli studi ora apre esplicitamente la mappa del sito prima di seguire il collegamento. I selettori sono aggiornati ai dettagli espandibili, conservando le verifiche di dati, unità, filtri e accessibilità. Non si attesta una singola esecuzione ininterrotta di `test:production`.

Log locali conservati in `artifacts/review/final/`. Screenshot e prove di layout in `artifacts/browser/ui-clarity/`; report Lighthouse in `.lighthouseci/`.

Build locale: `Mrpv9mWTtBL7jfQENfiew`. Impronta dei 124 file prodotto modificati: `629cf2420823ff2466076cb3adc219bc0ea30c38717c3ab05baa9e1351396cd9`. Il manifesto dei file è in `artifacts/browser/ui-clarity/final-build.json`.

## Consegna

Lavoro locale da rivedere prima del merge. Nessuna attestazione di CI remota, merge, pubblicazione o deploy. Il checkout principale separato non è la directory di modifica.
