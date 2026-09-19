# Atlante della politica: architettura e verifica

## Perimetro

Il restyling sostituisce la UI della route `/politici`, condivisa con il sottodominio tramite l’infrastruttura esistente. Non modifica snapshot, contratti dati, ETL, API, fotografie, configurazione dei provider, routing globale, schema del database o lockfile. Non servono migrazioni. L’integrazione con il Parlamento europeo non viene simulata: la vista Repubblica offre un collegamento esplicito al repertorio ufficiale, finché un nuovo dataset verificato non sarà disponibile.

## Componenti

- `atlas-model.ts`: stato serializzabile, ricerca normalizzata, filtri, selezioni e URL. Conserva dominio, percorso e parametri estranei, compresi i link legacy `deputy`.
- `graph-geometry.ts`: geometria pura dell’emiciclo, assegnazione deterministica dei posti, quote esatte per fila e navigazione spaziale da tastiera. Un posto per identità; un posto vuoto soltanto quando dichiarato dalla fonte.
- `atlas-hemicycle.tsx`: rendering SVG, legenda interattiva, selezione, anteprima, zoom e scorrimento del diagramma ingrandito. L’elenco è l’alternativa accessibile ai piccoli bersagli visivi.
- `repubblica-graph.tsx`: coordinamento delle quattro viste, cronologia del browser e directory paginata. Nessun database o libreria grafica aggiuntivi.
- `atlas-controls.tsx`: ricerca con suggerimenti e pannello di dettaglio. Desktop: colonna laterale; mobile: `dialog` nativo, ripristino del focus, gestione Tab/Esc e scroll della scheda.
- `repubblica-panel.tsx` / `atlas-facts.tsx`: istituzioni, gruppi, persone, rapporti istituzionali, curriculum, votazioni, formazione, programmi, notizie e co-citazioni. Riutilizzano i modelli ufficiali esistenti.
- `atlas-data.ts` / `use-atlas-data.ts`: validazione delle risposte HTTP, cancellazione, timeout, retry limitato alle risposte di riscaldamento della cache, cache di sessione limitata a 30 notiziari. Gli errori non diventano successi vuoti.
- `politici.module.css`: stile locale, tema condiviso, larghezze da 320px, controlli touch, focus, colori forzati e movimento ridotto.

## Scelte editoriali

Gli emicicli sono stilizzati: non assegnano posti reali e non ordinano arbitrariamente le persone su una scala ideologica. I gruppi sono in ordine alfabetico. I colori aiutano l’esplorazione, ma le etichette e i conteggi rimangono sempre disponibili.

La data globale è presentata come **rilevazione più recente**, non come garanzia che tutte le fonti siano sincronizzate. «Fonti e limiti» conserva provenienza, licenze, date e lacune dei singoli snapshot.

La partecipazione al voto distingue voti, missioni e assenze; le missioni non sono spacciate per presenza fisica. I dati della Camera non vengono attribuiti al Senato. La formazione dichiarata resta distinta da competenza o merito. I temi del catalogo dei programmi sono indicazioni per la ricerca, non punteggi di coerenza individuale. Le co-citazioni nelle notizie non vengono presentate come rapporti personali.

I rapporti tra istituzioni sono letti da `map.edges`, senza introdurre nuove deduzioni sul potere politico. I collegamenti fra gruppi omologhi e gli incarichi di Governo restano navigabili.

## Motion e accessibilità

Animazioni brevi di opacità e trasformazione, senza una nuova dipendenza. Interazioni hover limitate ai dispositivi che supportano davvero il puntatore. `prefers-reduced-motion` disattiva transizioni e animazioni; la navigazione da tastiera non aspetta effetti decorativi. I seggi usano un solo punto di ingresso nella sequenza Tab e frecce spaziali; nomi e incarichi sono etichettati. Il pannello mobile usa la modalità nativa del browser e ripristina il focus all’uscita.

I piccoli seggi non sono un sostituto dei controlli touch: ricerca, gruppi ed elenco offrono accessi più grandi alle stesse schede. Verificare comunque VoiceOver/Safari e dispositivi reali prima di dichiarare conformità completa; questo intervento non costituisce una certificazione WCAG.

## Test

`tests/politici-atlas-model.test.mjs` verifica geometria, conteggi, filtri, ricerca e round-trip dei link. `tests/politici-atlas-data.test.mjs` verifica parser, HTTP, cancellazione e retry. `tests/politici-atlas-integration.test.mjs` riconcilia il nuovo frontend con i dati reali del repository. `tests/politici-ui.test.mjs` conserva i contratti del contenitore immersivo e aggiorna quelli della nuova UI.

La suite reale del browser riutilizza `scripts/browser/harness.mjs`, quindi non introduce un secondo sistema di avvio di Chromium:

```sh
npm run typecheck
npm run lint
npm run test:node
npm run build
npm run start
# In un altro terminale, dalla radice del repository:
node --experimental-strip-types scripts/browser/politici-atlas.mjs
```

`DVNS_POLITICI_URL` può indicare una preview invece della route locale. `DVNS_POLITICI_ALIAS_URL` aggiunge una seconda URL, per verificare anche il sottodominio. I risultati e le immagini sono salvati in `artifacts/browser/politici-atlas` o nella directory già configurata con `DVNS_ARTIFACTS_DIR`.

Le prove principali del browser usano le API reali e il dataset locale della stessa build. Solo lo scenario finale intercetta esplicitamente gli errori e le risposte vuote per controllare il recupero. Non ci sono fixture importate dall’applicazione.

## Riferimenti di progetto

- Repository e contratti: https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi
- Indicazioni di design/motion consultate: https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng
- React, stato esterno: https://react.dev/reference/react/useSyncExternalStore
- Dialog nativi: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog
- Eurodeputati, fonte esterna dichiarata: https://www.europarl.europa.eu/meps/it/home

## Prima del merge

Il pacchetto originario è stato verificato con test Node e un ambiente browser isolato, non con una build Next completa. Eseguire i comandi sopra nel repository completo, verificare le due URL in preview e leggere `TEST_REPORT.md` del pacchetto per distinguere le prove eseguite da quelle ancora da eseguire. Non saltare CI o controlli di branch protection.
