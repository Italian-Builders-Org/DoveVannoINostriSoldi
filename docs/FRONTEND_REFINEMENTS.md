# Rifiniture frontend — 11 novembre 2026

Base: `7346b4513b00a72e37134d03a2ec414f7db96284`, produzione verificata READY.
Branch: `nuovo-stile-rifiniture`. Le PR aperte riguardano altri interventi;
nessuna sovrapposizione sui componenti previsti. Backend, dataset, API,
autenticazione, dipendenze e configurazione di produzione restano invariati.

## Comportamenti e verifiche previste

- Home compatta, cinque analisi senza indice intermedio; anteprime da snapshot
  esistenti con fonte, periodo, unità e copertura; niente dati inventati.
- Distinguere dato osservato, esito dei controlli e previsione nella sezione controlli.
- Directory completa filtrabile: accenti, query vuota, nessun risultato, reset,
  tastiera e gruppi espandibili su mobile; link nella stessa scheda.
- Contesto comune delle pagine e copia della vista con filtri; nessun parametro
  di autenticazione nel link condiviso; fallback manuale se la clipboard è negata.
- Filtri degli atlanti con selezioni leggibili, ripristino e cronologia; ritorno
  alla vista selezionata dopo navigazione al dettaglio.
- Definizioni vicino alle visualizzazioni di spesa, mantenendo i perimetri distinti.
- Verifica desktop/mobile, temi chiaro/scuro, focus, Escape, overflow, console,
  stati vuoti e navigazione home → dashboard → footer → home.
- Test pertinenti, TypeScript, lint dei file toccati, build, controllo diff e SHA.
  Browser tramite ambiente di anteprima gestito; nessun server alternativo.
- Un solo push delle modifiche validate e preview del sito completo su Vercel.
  Nessun merge o rilascio in produzione.

## Esito

Codice verificato: `8ef8a42abd0b2ad2b6a3a8f1f86ca3887c1c87eb`.
Anteprima Vercel READY: `dpl_8ukVz4N4gy7RAXLqFnp5Ld1tbapG`, ambiente Preview
(`target: null`), stesso commit e branch.

https://dove-vanno-i-nostri-soldi-jxpusvr1y-future-proof-society.vercel.app

- PASS: 119 test mirati/correlati (78 frontend + 41 formattazione, palette,
  composizione della spesa, bilanci e selezione istituzionale).
- PASS: `npm run lint`, `npm run design:check`, `git diff --check`, report,
  brand, contesto/documentazione agenti e SHA pin delle azioni.
- PASS: `NODE_OPTIONS=--max-old-space-size=6144 npm run build`: compilazione,
  TypeScript, 253 pagine statiche e controlli dei runtime trace. I precedenti
  tentativi standalone di typecheck erano terminati per memoria; il typecheck
  della build completa è poi passato, senza modificare la configurazione.
- PASS: build Vercel su Node 22, TypeScript incluso e 278 trace controllate.
- Suite Node completa: primo passaggio 2.498 PASS e 69 FAIL su 2.567 test;
  tutti i fallimenti dipendevano dall'assenza di `/tmp`. Rieseguiti i 29 file
  coinvolti con `TMPDIR` scrivibile: 218 PASS, 0 FAIL. Nessun gate disattivato
  e nessun file applicativo cambiato per compensare l'ambiente.
- HTML generato verificato su supporto, metodo, privacy, termini, sostenitori,
  Parlamento e università: header/footer comuni, un solo collegamento GitHub
  nell'header, nessuna sidebar vecchia o apertura interna in nuova scheda.
- Inventario design: 132 template, 124 pubblici, 6 rewrite interne e 2 viste
  che richiedono fixture autenticate/condivise. L'inventario NON è un test E2E.
- E2E VISIVO NON VERIFICATO: il relay locale non è disponibile; la preview
  Vercel nel browser richiede autenticazione. Non è stato modificato l'accesso
  al progetto e non sono stati creati link di bypass. Non si dichiara “zero bug”.
- ETL completo, test live e `test:production`: NOT RUN. Nessun merge/deploy
  di produzione. `origin/main` riverificato alla consegna, ancora alla base.

Comandi ripetibili dei test mirati (con una directory TMPDIR scrivibile):

```sh
node --experimental-strip-types --import ./scripts/ci/node-test-setup.mjs --test --test-concurrency=2 tests/frontend-exploration.test.mjs tests/site-navigation.test.mjs tests/company-atlas.test.mjs tests/education-atlas.test.mjs tests/home-anomalies.test.mjs tests/ui-craft-regressions.test.mjs tests/region-crests.test.mjs tests/politici-ui.test.mjs tests/accessibility-palette.test.mjs
node --experimental-strip-types --import ./scripts/ci/node-test-setup.mjs --test --test-concurrency=2 tests/home-italy-funnel.test.mjs tests/parliament-contract.test.mjs tests/politici-atlas-model.test.mjs tests/institutional-ui-palette.test.mjs tests/copy-quality.test.mjs
node --experimental-strip-types scripts/browser/site-design.mjs --inventory
```

La preview contiene il codice del commit sopra; questa revisione del resoconto
non modifica l'applicazione e non richiede una seconda build.

## Note di revisione

### Ultima modifica richiesta: social e GitHub

Base `937f765feab2f857e1fc1c8e10e905231d8482c6`. Obiettivo: ogni icona social/GitHub
apre una nuova scheda senza sostituire la pagina corrente, con `noopener noreferrer`.
Il difetto dell'header è riprodotto nell'HTML della build: `target` è assente.
Il footer contiene già `_blank`; viene uniformata la protezione del collegamento.
Regressione E2E prevista: clic reali su tutte e sette le icone in home e supporto,
390/1280 px, nuova pagina creata, pagina originale conservata, `window.opener` nullo;
un link interno continua invece nella stessa scheda. La suite navigazione include
questo controllo, con report e screenshot. Il browser cloud riceve 403 dal dominio
pubblico e il relay locale è ancora indisponibile: esecuzione demandata alla CI
della PR, senza modificare protezioni o avviare un server locale alternativo.

L'utente ha chiesto di pushare l'aggiornamento dopo questa correzione. La PR prepara
il rilascio; gli esiti E2E devono essere osservati prima di dichiararlo completato.

I link alle mappe usano `/comuni` e `/politici`, anche dalla home e dalla
directory: una preview non deve portare alla produzione. I domini canonici,
le API e i link alle fonti rimangono invariati. Il link alla Presidenza usa
l'identificatore istituzionale già supportato e apre il relativo pannello.

Le anteprime di imprese, scuola e Camera sono renderizzate sul server usando
gli adapter esistenti. Dataset grezzi e contratti non entrano nei nuovi
componenti client. I mancanti non diventano zero; i totali scolastici mantengono
la copertura del dataset; i pagamenti della Camera sono espressi in milioni.

Il reset degli atlanti conserva indicatore e periodo e rimuove solo i filtri
territoriali/categoriali. La cronologia conserva ogni selezione; i controlli
mostrano lo stato di aggiornamento durante la navigazione.

