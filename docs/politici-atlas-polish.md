# Atlante: immagini, anteprime e diagnostici browser

Continuazione incrementale della PR #557, preparata sulla revisione
`d2a57ec666eb693c41b0150feb18df335e40fb0b`. Leggere anche
`politici-atlas.md` e `politici-atlas-continuazione.md`.

## Confini conservati

Il design principale e gli emicicli non cambiano. Atti/voti e resizer continuano
ad usare l’implementazione riconciliata con main. Nessuna modifica a contratti,
snapshot, API o dipendenze; nessuna migrazione. I simboli restano nel catalogo
con fonti e attribuzioni; non inferiscono l’iscrizione delle persone ai partiti.

## Immagini

`AtlasImage` è il componente condiviso per ritratti e simboli. Ogni sorgente
ha uno stato isolato: un caricamento tardivo non deve aggiornare l’immagine
della persona appena selezionata. Le iniziali rimangono visibili durante
il caricamento, per sorgenti assenti e in caso di errore. Il riferimento DOM
riconosce le immagini già caricate dalla cache. Le route esistenti e Next Image
restano responsabili di trasporto e ottimizzazione; nessun secondo proxy.

La transizione di opacità si disattiva con `prefers-reduced-motion`. Il testo
adiacente espone l’identità; immagine e iniziali sono decorative per gli
screen reader per evitare ripetizioni.

## Anteprime

`placePreview` calcola le coordinate da rettangoli misurati. Il componente
misura il contenuto con `ResizeObserver`, usa `visualViewport` quando presente
e tiene la scheda entro i bordi. Nessun valore fisso per l’altezza effettiva.

Il tooltip non contiene controlli interattivi: il seggio conserva clic,
Invio e Spazio. Esc chiude l’anteprima; scroll o resize eliminano coordinate
ormai superate. Da tastiera la comparsa è immediata. Su touch si apre la
scheda, senza rendere una funzione disponibile soltanto in hover.

## Partecipazione

Si mantengono i dati individuali, le percentuali, missioni, assenze, periodo
e fonte. L’elenco è alfabetico e non riproduce posizioni ordinali. Il nome
esportato `AttendanceRanking` resta per compatibilità con gli import esistenti;
i contratti e i dati non sono migrati né cancellati. Gli assert strutturali
verificano i dati conservati e l’assenza di posizioni ordinali renderizzate.

## Diagnostici

`data-atlas-ready` distingue il markup server da una vista interattiva; non
è un rimedio alle divergenze fra HTML server e client. Il browser driver aspetta
quel segnale, mantiene gli errori di idratazione bloccanti e salva HTML iniziale,
DOM finale e console separatamente. I controlli dentro dialog/details chiusi
non devono essere scelti solo perché hanno un rettangolo di layout. Il puntatore
sui seggi viene posizionato nella matrice SVG effettiva e passa un hit test.

In locale il secondo ingresso viene verificato in Chromium tramite un override
DNS limitato all’host dell’atlante, sulla stessa porta del server locale. In
preview sono richieste `DVNS_POLITICI_URL` e `DVNS_POLITICI_ALIAS_URL`, distinte
e allineate alla revisione dei dati locali. Nessun percorso alias è saltato
silenziosamente.

## Stato delle prove alla consegna

Eseguiti: 16 test Node dei nuovi helper; 18 scenari Chromium isolati su helper
DOM/geometria/CSS; 12 test dell’applicatore del pacchetto; transpilation
sintattica di sette moduli TypeScript. Queste prove non sono un typecheck o
una build Next. Gli eventi React/Next delle immagini e l’effetto di misurazione
dell’anteprima devono essere validati nell’applicazione completa.

La CI della base `d2a57ec`, run `35400533407`, ha static e build riusciti,
ma suite Node e production gates falliti. I diagnostici dell’atlante contengono
nove scenari falliti, otto dei quali registrano React #418; non identificano
l’elemento HTML responsabile. Questo errore non è dichiarato risolto.
La suite browser modificata e il test strutturale aggiornato sono da eseguire
nel checkout completo. Non mergiare sulla sola base delle prove isolate.

Riferimenti:
- PR: https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/pull/557
- CI della base: https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/actions/runs/35400533407
- React #418: https://react.dev/errors/418
