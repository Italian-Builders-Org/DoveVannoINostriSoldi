# Verifica del nuovo stile

Il branch `nuovo-stile` applica il menu a scomparsa e il footer dal layout
radice. Non esiste una seconda versione di questi componenti per le pagine
Supporto, Metodo o Invalidità INPS. La larghezza dei contenitori `.shell` è
condivisa con l'header su tutte le pagine standard.

Comuni, Politici, la mappa Mobilità e Boards conservano la loro interfaccia
immersiva. I collegamenti al resto del sito restano sulla versione corrente
dopo l'idratazione. Dai sottodomini Comuni/Politici portano al sito principale;
lo stesso fallback resta disponibile senza JavaScript. I link canonici,
le fonti ufficiali e gli endpoint MCP non sono URL di navigazione da riscrivere.

## Anteprima parziale e sito completo

La demo `dvns-nuovo-stile-novembre-2026.d-g-1996.chatgpt.site` contiene una
renderizzazione statica di home, panoramica e pagamenti comunali: 37 documenti,
incluse le combinazioni degli anni. Il suo JavaScript inoltra le altre
destinazioni a `dovevannoinostrisoldi.com`. Questo spiega il ritorno al design
di produzione. La demo non è una preview Next completa e non dimostra il
funzionamento delle altre pagine, dei filtri o delle sessioni.

Per collaudare l'intero sito serve una preview Next del branch, nel progetto
Vercel esistente, secondo `DEPLOYMENT_APPROVAL.md`. Non è necessario modificare
API, dataset o backend e non va pubblicato `main` per eseguire il collaudo.

## Copertura ripetibile

```bash
npm run test:browser:site-design -- --inventory
DVNS_BASE_URL=https://URL-DELLA-PREVIEW npm run test:browser:site-design
DVNS_BASE_URL=https://URL-DELLA-PREVIEW npm run test:browser:navigation
```

L'inventario comprende 132 template: 124 pubblici, 6 riscritture interne e 2
template di board/condivisione che richiedono fixture valide. Le pagine concrete
iniziali sono 127, ricavate dal catalogo pubblico e dal filesystem. Durante il
passaggio browser si aggiungono i dettagli dinamici effettivamente collegati.
Il controllo fallisce se un template pubblico resta non visitato.

La suite verifica a 390, 1280 e 1920 px: permanenza nella preview e nella stessa
scheda, header e footer comuni, allineamento, overflow, menu e ritorno del focus,
contrasto dei titoli e dei testi principali nei due temi. Salva screenshot per
pagina/tema e prova i collegamenti di servizio cliccandoli dal footer.

Il report `artifacts/browser/site-design/coverage.json` registra SHA, working
tree, comando, destinazioni, esiti e lacune. I template dinamici hanno campioni,
non una verifica di ogni record o combinazione di filtri. I flussi autenticati
richiedono un controllo dedicato; non sono dichiarati verificati dal solo stato
ospite. Restano necessarie le suite funzionali pertinenti ai singoli strumenti.

## Esito della revisione del 11 novembre 2026

- TypeScript e 70 test mirati: PASS.
- Rendering server di Supporto, Metodo, Privacy, Termini, sostenitori,
  Invalidità INPS e Fonti: PASS; non è una verifica visiva nel browser.
- Inventario dei 132 template: PASS.
- Browser E2E e valutazione visiva dell'intero sito: NOT RUN. Il relay locale
  non è disponibile; il progetto DVNS non è accessibile nel team Vercel
  collegato. La preview completa non è stata pubblicata.
- Backend, autenticazione, API e dataset: invariati. ETL: NOT RUN.
