# Bilancio dello Stato 2025

Rapporto per la sezione esistente `/report`. Unica PR, merge subordinato
all'approvazione dell'utente. L'analisi avviene internamente con Codex, senza
API AI a pagamento o funzioni pubbliche per avviare audit.

## Materiali

- Contenuto comune a pagina e PDF: `src/content/reports/state-budget-2025.json`.
- PDF: `public/report/bilancio-stato-2025.pdf`.
- `evidence.zip`: selezione dei contributi, input, estratti, ricevute e calcoli.
- `evidence-manifest.json`: hash e dimensione di ogni file archiviato.
- `pdf-receipt.json`: hash del contenuto editoriale e del PDF derivato.

Il pacchetto è una prova congelata del rapporto, non una nuova famiglia del
corpus interrogabile. Le date, i perimetri e le licenze delle acquisizioni
sono conservati nei `sources.json` dei contributi. I dati grezzi rimangono
fuori dai bundle applicativi e dai Client Component. Il sito legge soltanto
il testo editoriale e serve il PDF statico.

## Riproduzione

L'archivio contiene i contributi originali nei percorsi `outputs/audit/`, il
secondo passaggio sugli esiti in `outputs/audit-second-pass/outcomes/` e gli
estratti PDF in `outputs/audit-extracts/`. Il testo pubblico consolidato
prevale sulle classificazioni provvisorie del primo passaggio. Queste ultime
sono conservate come traccia della revisione, non come conclusioni aggiuntive.

Sono inclusi CSV, ricevute, calcoli, script, estrazioni testuali, quattro PDF
originali ed estratti delle pagine decisive di cinque documenti. I PDF
voluminosi, gli allegati compressi e le tabelle nominative ODS non sono inclusi:
`omittedSources` ne registra hash e dimensione, mentre le ricevute dei domini
conservano gli URL. Gli estratti sono derivati: il loro manifesto indica hash
dell'originale e pagine fisiche. Le copie integrali acquisite rimangono negli
archivi di lavoro locali. La selezione riduce il pacchetto pubblico a circa
22,6 MB; nessuno di questi file viene servito o letto dal runtime del sito.

I sei test di pubblicazione sotto indicati sono interamente offline. Per
rieseguire **tutti** gli script di ricerca, estrarre il pacchetto in un checkout
separato della revisione `b4da7e4226dd30c116fb0d87280d1fe2d9e8760d`,
riacquisire gli originali omessi usando gli URL e verificare gli hash prima
dell'uso. Seguire poi i `report.md` di ciascun dominio, adattando i percorsi
locali indicati. Un originale modificato o indisponibile impedisce quella
specifica riproduzione; non sostituirlo silenziosamente con una nuova versione.
Il contributo personale usa inoltre i CSV PG compressi del dominio contabilità.

Verifica offline del pacchetto e dei risultati pubblicati:

```sh
python3 -m unittest discover -s tests/etl -p 'test_state_budget_report.py'
```

Rigenerazione del PDF con il runtime Node e Chromium già usati dal progetto:

```sh
node scripts/reports/render-state-budget.mjs
```

Il generatore legge lo stesso JSON della pagina, impedisce richieste di rete
e aggiorna la ricevuta. Il PDF va riletto anche visivamente: l'hash non
certifica impaginazione o significato.

## Criteri editoriali

- Una spiegazione contabile non certifica l'economicità della spesa.
- Una pista priva di documenti resta aperta; non diventa una smentita.
- `Possibile spreco` richiede indizi economici concreti, non una sentenza.
- `Spreco quantificato` richiede una base controllabile per il costo evitabile.
- Non sommare differenze, contratti, stanziamenti e pagamenti in un presunto
  totale recuperabile. Non trasformare le risultanze di altri organismi in
  scoperte autonome dell'AI.

## Checklist

- [x] Letti integralmente i cinque rapporti, le checklist e la struttura delle prove.
- [x] Copie di revisione separate dai worktree degli autori.
- [x] Rieseguiti 39 test dei contributi iniziali.
- [x] Verificati direttamente il record entrate 3458/1 e le tre note MIM.
- [x] Secondo passaggio richiesto su acquisti, opere, risultati e consulenze.
- [x] Integrati e revisionati tutti i risultati del secondo passaggio: 11 casi, 33 fonti.
- [x] Rieseguiti i 49 test aggiornati dei cinque contributi.
- [x] Congelato pacchetto e superati sei controlli indipendenti offline; omessi gli originali indicati nel manifesto.
- [x] Pagina e PDF coerenti, testo e attribuzioni rilette.
- [x] Browser desktop, tablet e mobile; tastiera, fonti, overflow e screenshot.
- [x] Gate applicativi completi e build.
- [x] Materiali pronti per l’unica PR di revisione.
- [ ] Merge approvato dall'utente.

## Verifica della consegna

Verifiche locali su macOS, Node 22.23.2, Python 3.12 e base applicativa
`b4da7e4226dd30c116fb0d87280d1fe2d9e8760d`.

| Controllo | Esito |
| --- | --- |
| Ricerca e secondo passaggio | 49 test superati |
| Prove del rapporto | 6 test indipendenti offline superati |
| `ci:static`, `ci:action-pins` | Superati; 84 riferimenti alle action verificati |
| `npm test` | 1.589 test superati |
| ETL completo | 806 test, 6 skip; i soli 3 errori erano socket vietati dal sandbox. Modulo ripetuto con loopback disponibile: 7/7 superati |
| `test:snapshots` | 60 controlli superati; contenuto del worktree invariato |
| Build | Superata; rapporto statico, 171 tracce controllate, documenti e ricerca esclusi dal runtime |
| `test:production` | Tutti i gate superati, inclusi browser chiaro/scuro, HTTP, carico locale MCP e budget Lighthouse |
| `git diff --check` | Superato |

Il primo controllo di produzione ha rilevato aspettative obsolete sul nome
«Report mensili», aggiornate a «Report» nei test di navigazione, studi e
footer. La suite completa è stata poi ripetuta e superata. Le prime prove
snapshot erano disturbate da scritture contemporanee nei log non tracciati:
la ripetizione con log esterni e checkout stabile ha superato anche il controllo
di integrità. Nessun controllo è stato disattivato.

Con Browser sulla build: 320, 390, 768 e 1280 pixel senza overflow orizzontale;
chiaro/scuro; undici pannelli fonti aperti con Invio e chiusi con Spazio;
indice, ricerca, archivio, report mensile preesistente, fonte RGS, ritorno e
pagina inesistente. Download PDF osservato; risposta HTTP 200 con tipo PDF e
byte identici al file revisionato. Screenshot desktop, tablet e mobile conservati
negli artefatti locali della consegna.

La somma osservata degli spostamenti senza input recente è 0,012 durante la
sequenza che comprende i cambi di viewport; le osservazioni mobile/tablet
precedenti erano zero. Non è una misura sul traffico reale. Non è stato usato
un iPhone fisico. Il collegamento alle prove su GitHub `main` diventa disponibile
dopo il merge approvato; in revisione le prove sono nei file della PR.

La verifica locale non sostituisce i controlli CI sull’integrazione con `main`.
Il commit successivo presente su `main` al controllo finale riguarda i dati
sanitari e non modifica i file di questa consegna. Nessun merge eseguito.
