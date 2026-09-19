# Atlante: riconciliazione e interazioni

La continuazione della PR #557 mantiene il design dell’atlante. Il CSS originario
`politici.module.css` resta byte-identico alla prima versione della PR; le nuove
interazioni hanno un modulo CSS separato, senza reintrodurre il vecchio layout.

## Integrazione di main

Base riconciliata: `6fa13ad5fb0cae8fb805b9f4d9b78232d242a233`, che include
`4f48fe9c586e2484b0ff1b76b6c89d388ab1e511`. La riconciliazione usa il tree di
main e conserva tutti i file estranei al frontend: homepage, snapshot, contratti,
API degli atti e dei profili, test ETL e lettori. L’atlante non riscrive i dati.
Il commit di riconciliazione ha come genitori la precedente head della PR e main;
non richiede force-push né un commit su main. Lo ZIP originario non cambia.

Il resizer riusa `politici-rail-width.ts` e la chiave di preferenza preesistente:
trascinamento con pointer capture, frecce, Home/End, Esc per annullare, doppio clic
per ripristinare 365 px. La preferenza è opzionale; senza storage funziona in
memoria. Il mobile conserva la scheda modale, senza divisore trascinabile.

## Atti e voti

La scheda Camera offre una sezione dedicata che legge l’API degli atti esistente
solo all’apertura. Prima firma e cofirma restano separate, con ricerca per titolo
o numero, filtro sull’iter, caricamento progressivo di otto record, fonte, periodo,
data di rilevazione, limiti e votazioni finali. Cancellazione, timeout ed errore
sono distinti dal risultato vuoto. I codici di voto non rilevato e segreto non
vengono trasformati in astensione. L’approvazione alla Camera non è presentata
come approvazione definitiva della legge. Nessun percentile o voto di qualità.

## Immagini e simboli

I ritratti riusano `/politici/foto/{id}`, incluso il proxy e le attribuzioni già
esistenti. Le iniziali restano visibili durante il caricamento e in caso di
errore, senza cambiare dimensioni. Sono presenti anche nei suggerimenti di ricerca
e nell’anteprima del seggio. Nessuna fotografia viene dedotta o generata.

`politici-symbols.ts` è un catalogo esplicito di otto simboli, con URL della fonte,
credito e versione. Gli asset sono stati ispezionati nelle rispettive pagine:
sei fonti ufficiali, Azione da Commons e PD da Wikipedia con attribuzione.
Non si inventano simboli per Misto, Autonomie o famiglie composite senza univocità.
Il logo identifica la famiglia associata al gruppo, non l’iscrizione individuale.

Le immagini non sono incorporate o ridistribuite nella licenza AGPL del codice.
Il proxy `/politici/simboli/{id}` accetta solo identificativi catalogati, rifiuta
redirect/SVG/HTML, limita tempo e byte durante lo streaming, non inoltra cookie e
riferimenti della navigazione. Se una fonte cambia URL o risponde con errore,
appaiono le iniziali. La disponibilità dal server di deployment deve essere
verificata nella preview: l’ispezione via web non sostituisce tale controllo.

## Interazioni e verifiche

L’anteprima dei seggi segue puntatore e focus, resta entro la finestra, è
raggiungibile col puntatore e si chiude con Esc. Non introduce un percorso solo
hover su touch. Le animazioni sono brevi; tastiera e movimento ridotto non
attivano l’animazione d’ingresso. Le container query adattano la mappa alla
larghezza effettiva dopo il ridimensionamento del pannello.

Verifiche locali della continuazione: 37 test Node mirati (modello, risorse,
atti, simboli e resizer), 6 controlli strutturali dell’atlante, transpilation
sintattica di 17 moduli, `node --check` della suite browser e `bash -n` del runner.
Non equivalgono a typecheck, lint, build Next o verifica browser dell’app completa.
Il checkout locale è parziale; rete e navigazione Chromium sono limitate.

La suite di integrazione aggiunge il controllo di tutti i payload degli atti
Camera sullo snapshot reale. `scripts/browser/politici-atlas.mjs` confronta
seggi, profili e atti con i lettori del repository e verifica ricerca, navigazione,
modale mobile, resizer, persistenza, anteprima, errori e filtri. È collegata al
runner di produzione esistente, senza rimuovere altri gate. Le sole risposte
simulate sono nello scenario dichiarato di errore/empty state.

Prima del merge: CI completa verde, controllo degli screenshot reali, entrambe
le URL in preview (`DVNS_POLITICI_URL` e `DVNS_POLITICI_ALIAS_URL`), disponibilità
dei simboli e dei ritratti, Safari, dispositivo mobile reale e tecnologie assistive.
Le verifiche non eseguite non vanno riportate come superate.
