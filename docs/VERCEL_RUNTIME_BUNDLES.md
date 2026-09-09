# Pacchetti runtime e tempi di deployment

I lettori ANAC usavano `readFileSync(fd)` dopo aver verificato un file descriptor
aperto. Turbopack interpretava il descrittore numerico come un percorso dinamico
e includeva l'intero progetto nei manifest di sei route. Il lettore operatori
risolveva inoltre la radice del repository prima di aggiungere la directory
fissa degli artifact, generando un secondo avviso di inclusione eccessiva.

I lettori ora riempiono un buffer limitato alla dimensione verificata usando
`readSync` sullo stesso descrittore. Le letture parziali proseguono fino al
completamento; una fine del file prematura blocca la lettura. Restano le
impronte del file prima e dopo, i limiti di dimensione, gli hash, i source lock,
la validazione dei percorsi e la chiusura del descrittore. Il percorso degli
operatori viene composto direttamente da `process.cwd()` e dalla directory fissa.

## Confronto locale

Misura dell'8 settembre 2026, main `bbe8dcb5`, Node 22.23.2 e Next 16.3.3.
Prima e dopo la modifica sono stati usati lo stesso checkout e corpus versionato.
I valori contano i percorsi normalizzati unici in ciascun `.nft.json`, inclusi
codice e dati runtime, in MB decimali.

| Route | Prima | Dopo | Riduzione |
| --- | ---: | ---: | ---: |
| `/enti/[codice]` | 689,0 MB | 318,8 MB | 54% |
| `/api/enti/[codice]` | 680,1 MB | 309,9 MB | 54% |
| `/enti/[codice]/appalti` | 658,3 MB | 60,6 MB | 91% |
| `/enti/[codice]/appalti/confronti` | 651,6 MB | 57,9 MB | 91% |
| `/appalti/operatori` | 651,1 MB | 219,1 MB | 66% |
| `/appalti/operatori/[ref]` | 651,2 MB | 219,1 MB | 66% |

La build completa contiene 150 manifest App Router. Dopo la modifica nessuno
include test, documentazione o ricerca. L'indice operatori resta nelle proprie
route ed è escluso dalle route enti. Sono presenti tutti gli shard ANAC e i file
di provenienza richiesti.

Queste sono dimensioni locali dei manifest, non dei pacchetti caricati su Vercel.
Le route possono condividere file e Vercel può raggruppare funzioni: non sommare
le righe come risparmio di spazio o trasferimento. La ricompilazione locale con
cache non costituisce un benchmark controllato del compilatore. Il lavoro
separato sugli indici di consultazione riguarda la latenza delle richieste.

## Controllo della build

`npm run build` esegue `scripts/ci/check-runtime-traces.mjs` dopo Next, sia in
locale sia su Vercel. Il controllo rifiuta l'inclusione accidentale di test,
documentazione e ricerca, i file mancanti e gli archivi ANAC di altri domini.
Richiede inoltre shard enti/CPV, schede o blocchi di consultazione degli operatori
e source lock consumati da ciascuna route, derivando l'inventario dai manifest
versionati. L'elenco operatori non deve includere gli shard delle schede.

Per ispezionare una build esistente:

```bash
node scripts/ci/check-runtime-traces.mjs
node --test tests/runtime-traces.test.mjs
```

Se una route inizia a leggere un nuovo artifact runtime, aggiorna il suo
inventario preciso e verifica la route distribuita. Non disattivare il controllo
o rimuovere verifiche d'integrità per nascondere un avviso del compilatore.

## Misura su Vercel

Il deployment Production di `bbe8dcb5` ha richiesto 9m34s, inclusi 7m53s nella
fase `Deploying outputs`. È la fase da confrontare dopo la riduzione dei
pacchetti. Comprende attività interne di Vercel: i log non separano il
trasferimento dall'elaborazione della piattaforma. Un manifest più piccolo non
dimostra da solo un risparmio preciso di tempo o costo.

Confronta deployment con la stessa macchina di build, annotando ripristino cache,
compilazione, pubblicazione output, durata totale e dimensioni delle risorse.
Le risorse della build e CPU/memoria runtime sono impostazioni distinte. Questa
modifica non richiede una macchina più grande o meno controlli di correttezza.

## Separazione delle route, 9 settembre 2026

Confronto con `62ed2e33`, sullo stesso checkout e corpus versionato, Node
22.23.2, Next 16.3.3 e macOS arm64. I valori sono in **MiB** (2^20 byte) e
contano i percorsi normalizzati unici nei manifest dopo ciascuna build.

| Route | Prima | Dopo |
| --- | ---: | ---: |
| `/appalti/operatori` | 239,0 MiB | 47,1 MiB |
| `/appalti/operatori/[ref]` | 239,0 MiB | 239,0 MiB |
| `/spese/sanita/storico` | 241,1 MiB | 2,8 MiB |
| `/api/spese/sanita/storico` | 240,4 MiB | 2,1 MiB |
| `/stato/legislature` | 240,7 MiB | 2,3 MiB |
| `/api/spese/stato/legislature` | 240,4 MiB | 2,0 MiB |

Stato fonti e le due viste storiche hanno moduli cache separati. I moduli storici
non importano più l'intero registro dello stato fonti e gli snapshot estranei.
Il coordinamento comune resta in `live-view-cache.ts`: chiavi esplicite, TTL,
riunione delle richieste concorrenti, cancellazione e cache degli errori
conservano il comportamento precedente. Importa direttamente ogni dominio,
senza introdurre un modulo che riesporti tutte le cache e ricolleghi le dipendenze.

Cinque processi Node nuovi per modulo, alternati sulla stessa macchina, hanno
misurato il solo import con `performance.now()` e la memoria residente con
`process.memoryUsage()`:

| Import | Tempo mediano | Memoria residente mediana |
| --- | ---: | ---: |
| Modulo cache condiviso precedente | 2485,61 ms | 348,7 MiB |
| Cache storico SSN | 204,51 ms | 107,6 MiB |
| Cache legislature | 211,60 ms | 103,4 MiB |

Sono misure dell'inizializzazione dei moduli, non della latenza completa delle
richieste o dell'avvio a freddo su Vercel. Le sei operazioni del benchmark operatori
conservano digest e conteggi dei byte letti identici. Entrambe le build producono
151 manifest e superano il controllo dell'inventario runtime. Le build locali
con cache durano 69,59 e 68,43 secondi: questa singola coppia non dimostra una
compilazione più veloce. La baseline Vercel `e6800070` dura 6m38s, inclusi
304,654 secondi nella pubblicazione degli output.

La prima [preview di `1427ec44`](https://vercel.com/doms-projects-579ef5cf/dove-vanno-i-nostri-soldi/J3UpB9aTFvfgC9Yb25pw3bX2FFq8)
si completa in 5m48s, esclusa la coda per lo slot di build. La pubblicazione
richiede 236,636 secondi (20:23:40.054–20:27:36.690 CEST), contro 304,654 della
baseline Production. Entrambe usano 4 core, 8 GB e cache di build ripristinate.
La [preview di `7c79ca2b`](https://vercel.com/doms-projects-579ef5cf/dove-vanno-i-nostri-soldi/G268r2G9f6TYpjPif4Mwzwv3kRuK)
si completa in 5m23s. Sono confronti osservativi: ambienti e storia delle cache
differiscono.

## Cache CI

Il job produzione ripristina soltanto `.next/cache/turbopack`, con chiave legata
a sistema operativo, architettura, versione Node, lockfile, configurazione Next
e commit. Può riusare il lavoro del compilatore di un commit precedente
compatibile. Ogni esecuzione ricostruisce il proprio codice ed esegue tutti i
gate di produzione; le risposte delle chiamate runtime non sono ripristinate.

I job static, Node ed ETL saltano il download di Chromium; produzione lo mantiene.
Nella baseline, pip impiega un secondo per una dipendenza: una cache aggiuntiva
richiederebbe più lavoro di ripristino e manutenzione di quanto giustificato.
L'upload Lighthouse include esplicitamente JSON e HTML nella directory nascosta
`.lighthouseci`. Scenari browser, scadenze e soglie Lighthouse restano invariati.

La [prima CI di `7c79ca2b`](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/actions/runs/34389607713)
passa tutti i controlli e salva correttamente la cache dopo il previsto primo
cache miss. Il job produzione dura 15m31s contro 14m50s della baseline: build
121 contro 127 secondi, gate produzione 738 contro 713 secondi. Questa prima
esecuzione non dimostra un risparmio complessivo CI. Il riuso va misurato su
un'esecuzione successiva; i risultati aggiornati sono nella PR #390.

Le modifiche limitate a `.github/workflows/ci.yml` e `scripts/ci/action-pins.json`
possono saltare installazione e compilazione Vercel: i comandi di build provengono
da `vercel.json` e `package.json`. Il confronto parte sempre dall'ultimo
deployment riuscito. Cronologia mancante, primo deployment, redeploy manuale,
modifiche applicative non ancora distribuite o modifiche allo script di skip
richiedono la build. Gli altri workflow non sono esclusi implicitamente.


## Stato fonti: avvio a cache vuota, 9 settembre 2026

Dopo #390, la prima richiesta Production a `/api/fonti/stato` ha ricevuto
`FUNCTION_INVOCATION_TIMEOUT` con un limite host di 10 secondi. Il controllo
condiviso si è completato dopo la risposta di timeout; due richieste successive
sono riuscite. I log non contengono un profilo CPU della funzione: da soli non
separano l'inizializzazione della piattaforma dal caricamento applicativo.

La riproduzione locale sul build di `eb7515e7` usa cache vuota, undici richieste
upstream simulate che rispettano l'annullamento e un limite client di 10 secondi.
Il solo server Next riceve 15 ms di esecuzione ogni 100 ms tramite SIGSTOP/SIGCONT.
In queste condizioni, la richiesta originale supera 10 secondi. Il profilo
mostra lettura, compilazione e validazione degli snapshot prima dei probe.
Spostare il solo import dietro la cache non risolve il blocco sincrono.

Il riepilogo di 30 fonti gestite occupa 7.639 byte. È derivato dagli stessi
adapter validati e riconciliato integralmente prima di ogni build. A runtime
si ricalcola la freschezza e si interrogano le fonti live con un budget comune.
La coda condivisa delle letture è separata dal lettore del corpus: importare
il limite di concorrenza non include più tutti i dati integrati nel pacchetto.
I refresh automatici delle fonti interessate aggiornano anche il riepilogo.

| Misura locale | Prima | Dopo |
| --- | ---: | ---: |
| Manifest `/api/fonti/stato` | 240,37 MiB | 2,56 MiB |
| Richiesta a cache vuota con CPU limitata | timeout oltre 10 s | HTTP 200 in 4,15 s |
| Fonti nel risultato | 34 | 34 |
| Fonti simulate non raggiungibili | 4 | 4 |

Il manifest `/fonti/stato` misura 2,86 MiB dopo la modifica. Il controllo del
build rifiuta l'inclusione dei ledger e del corpus integrato in entrambe le route.
Una verifica intermedia prima della separazione della coda risponde in 4,16 s,
ma include ancora 210,68 MiB: latenza di esecuzione e dimensione del pacchetto
sono costi distinti.

Le misure sono locali, su Node 22.23.2, Next 16.3.3 e macOS arm64. La CPU
limitata è una prova del budget in condizioni avverse, non un'emulazione delle
risorse Vercel né una stima del risparmio economico. L'esito delle fonti esterne
resta distinto dalla disponibilità HTTP dell'applicazione.
