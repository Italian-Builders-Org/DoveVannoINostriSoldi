# Capacità, picchi e rilasci

La macchina di build compila il sito; CDN e funzioni servono i visitatori.
Aumentare la prima non risolve saturazione delle API o indisponibilità delle
fonti. Questa guida definisce decisioni e verifiche, non una capacità garantita.

## Configurazione di riferimento

Verificata il 5 settembre 2026: build Standard (4 vCPU, 8 GB), on-demand
concurrency disattivata, priorità produzione attiva; Fluid Compute attivo,
funzioni Standard (1 vCPU, 2 GB per istanza). Ricontrollare il dashboard prima
di un evento: sono impostazioni modificabili, non imposte da `vercel.json`.

La build Standard del merge #292 è terminata in 1m53s. È un riferimento sul
corpus di quella revisione, non una garanzia per corpus futuri. Con una sola
build alla volta, dieci build da due minuti terminano in circa venti minuti;
se ciascuna richiede dieci minuti, diventano cento. La priorità produzione
non interrompe una build già in corso e non elimina una coda di build produzione.

- Verificare la preview della revisione esatta e i gate richiesti prima del merge.
- Per una build che esaurisce memoria, verificare i log, poi provare una macchina
  più grande. Conservare tutti i controlli. Aumentare CPU non corregge errori di codice.
- Per un rilascio urgente bloccato dalla coda, valutare **Start Building Now**
  sul singolo deployment. Evitare di abilitare tutta la concorrenza a consumo
  per risolvere un'urgenza occasionale.
- Rivedere la configurazione se attese superiori a dieci minuti diventano
  frequenti. Questa è una soglia operativa iniziale, non un limite Vercel.

Per la spesa effettiva leggere `Build CPU Minutes` nel ciclo di fatturazione:
la macchina Standard e la concorrenza on-demand disattivata non bastano per
dedurre un costo nullo. Distinguere utilizzo lordo, credito incluso e licenze.
Le build dipendono da durata e core; le richieste di produzione continuano a
consumare anche senza nuovi push. Fonti: [gestione build](https://vercel.com/docs/builds/managing-builds),
[listino](https://vercel.com/docs/pricing#builds).

## Diagnosi dei deployment

1. Registra deployment ID, SHA, ambiente, orari e ultimo deployment `Ready`.
   Confronta i log della revisione fallita con quella funzionante prima di
   attribuire il problema a una PR. Controlla anche la
   [pagina di stato Vercel](https://www.vercel-status.com/).
2. Separa installazione, `next build`, packaging, `Deploying outputs` e
   pubblicazione. `Build Completed` e `CI / required` verde non provano che
   il deployment sia `Ready` o che il dominio punti alla nuova revisione.
3. Leggi log e metadati con il connettore autorizzato o la CLI autenticata:

   ```bash
   vercel inspect DEPLOYMENT_URL --scope TEAM --logs
   vercel inspect DEPLOYMENT_URL --scope TEAM --format=json
   vercel api /v13/deployments/DEPLOYMENT_ID --scope TEAM
   ```

   Nei metadati cerca `readyStateReason`, `errorCode` ed `errorStep`. Conserva
   solo i campi diagnostici necessari: non allegare dump di configurazione o
   credenziali alla PR. Se il connettore non accede al team, un suo 403 non
   dimostra che il deployment o la sessione browser siano guasti.
4. Per `ENOSPC` controlla disco disponibile e file voluminosi; per OOM memoria
   e fase del picco; per errori di contratto correggi codice o artifact. La
   pulizia post-build stampa spazio disponibile e totale prima/dopo: libera
   cache e directory Git nel container Vercel, preservando output e snapshot.
   I file `.git` dei worktree restano intatti. Locale e GitHub conservano la
   cache per le compilazioni successive.
   Se il report indica cache ripristinate fuori dal progetto, confronta una
   sola preview dello stesso codice senza «Use existing Build Cache», come
   descritto nella [guida Vercel](https://vercel.com/docs/deployments/troubleshoot-a-build).
   Non cancellare directory interne della piattaforma e non disabilitare la
   cache permanentemente sulla sola base di questa ipotesi.
5. Se il fallimento resta interno alla piattaforma dopo `Build Completed`,
   prepara per il supporto ID, orari, SHA, ultimo successo e log pertinenti.
   Non trasformare una diagnosi generica in una causa certa e non ripetere
   redeploy identici a pagamento senza una nuova ipotesi verificabile.
6. Valuta una macchina diversa solo dopo aver individuato la risorsa esaurita
   e confrontato i [limiti e costi correnti](https://vercel.com/docs/builds/managing-builds).
   Un messaggio che suggerisce Enhanced Builds non prova che serva un upgrade
   del piano. Concorda ogni aumento di costo; non indebolire tracing, test o
   disponibilità dei dati per far passare la build.
7. Chiudi l'incidente solo dopo `Ready` sullo SHA corretto e smoke test delle
   route interessate. Se è pronta solo la preview, dichiaralo: non equivale
   alla pubblicazione in produzione.

## Cache runtime degli appalti

Gli adapter conservano solo artifact validati. La cache usa identità del file,
dimensione e tempi di modifica, inclusa `ctime`, per invalidare i risultati
quando vengono sostituiti o modificati. Anche una lettura a cache calda controlla
il fingerprint; hash, schema e provenance vengono ricontrollati al caricamento.
Errori e risultati incompleti non vengono memorizzati come successi.

Le cache sono limitate per numero di elementi e peso serializzato: 32 MiB per
gli shard ente, 16 MiB per CPV e 16 MiB per shard storico operatori. Quest'ultima
conserva righe serializzate e valida il record selezionato; non espande tutti i
riepiloghi in oggetti. Il peso serializzato **non** equivale all'heap JavaScript:
misurare anche RSS/heap prima di aumentare i limiti. Gli oggetti restituiti dagli
adapter sono condivisi e vanno trattati come immutabili.

`node --experimental-strip-types scripts/bench/procurement.mjs` confronta batch
di enti e operatori diversi negli stessi shard, prima a freddo e poi a caldo.
Conservare digest, runtime e corpus identici nel confronto. Non rappresenta la
latenza HTTP o un crawler che cambia shard a ogni richiesta.

Il layout pubblico non legge header della richiesta per scegliere la modalità
immersiva. La mappa inizializza il proprio flag prima del primo paint e lo
aggiorna sulle navigazioni client; un selettore CSS copre JavaScript disabilitato.
Il gate `scripts/browser/runtime-cache.mjs` verifica header cache, filtri senza
prefetch automatico, tastiera, avanti/indietro, sottodominio e shell senza JS.

Le cache non sostituiscono il WAF: mantenere i limiti per IP e distinguere
crawler automatici da richieste avviate dagli utenti. Calibrare eventuali
limiti aggregati sul traffico residuo, senza permettere che un bot esaurisca la
capacità degli utenti legittimi. Il sampling dei trace non dimostra da solo
una riduzione della voce fatturata `Observability Events`.

## Dimensionare un evento

Definire visite, intervallo di arrivo, richieste per visita, quota che raggiunge
le funzioni, byte trasferiti e costo delle route. Utenti simultanei, richieste
al secondo e istanze non sono grandezze intercambiabili.

Esempio di pianificazione, **non previsione misurata**: 10.000 visite in dieci
minuti, 20 richieste per visita. Se il 20% raggiunge le funzioni, sono circa
67 richieste dinamiche/s; se tutte lo fanno, circa 333/s. Con durata media
rispettivamente 0,3 s e 5 s, il lavoro in corso stimato è circa 20 e 1.667
richieste (`richieste/s × durata`). Usare medie coerenti con lo stesso traffico;
non moltiplicare indiscriminatamente percentili di route diverse.

Ripetere il calcolo con arrivi concentrati: lo stesso lavoro in dieci secondi
richiede 60 volte il tasso di arrivo dell'esempio. Non è una capacità dimostrata.
Vercel documenta limiti di burst e tempi di scaling: l'autoscaling non è
istantaneo e può restituire `FUNCTION_THROTTLED`.
[Scaling e limiti](https://vercel.com/docs/functions/concurrency-scaling).

La CPU si stima con `invocazioni × secondi CPU / 3600`; la memoria fatturata
con `GB allocati × durata delle istanze in ore`. La memoria usata p95 non è
la memoria allocata. Fluid può condividere un'istanza fra richieste: contare
2 GB per richiesta simultanea sovrastima quella condivisione. Timeout, retry,
cache miss, cold start e fonti lente possono cambiare radicalmente il modello.
[Prezzi e metodo di calcolo](https://vercel.com/docs/functions/usage-and-pricing).

## Verifica prima di un evento

1. Annotare SHA di produzione, stato delle fonti, finestra dei log, cache hit,
   invocazioni, p95/p99, timeout, errori, memoria e CPU per route. Conservare un
   deployment funzionante per rollback; verificare che sia ancora disponibile.
2. Riprodurre i gate in [CONTRIBUTING](../CONTRIBUTING.md). Per timeout,
   cancellazione e isolamento il controllo mirato è:

   ```bash
   node --experimental-strip-types --test tests/mcp-route.test.mjs tests/search-rate-limit-fail-closed.test.mjs tests/live-page-request-budgets.test.mjs tests/live-api-request-budgets.test.mjs tests/assistant-route.test.mjs tests/search-request-budget.test.mjs tests/global-search-route.test.mjs
   ```

3. Usare un worktree con build e porta propri. `NEXT_PORT=3298 npm run
   test:production` avvia e termina il proprio server. Il test MCP incluso è
   un piccolo campione di regressione; non certifica la capacità del sito.
4. Per una prova hosted definire prima target, rate, durata, numero massimo di
   richieste, budget e condizioni di stop. Coprire pagine e query diverse,
   cache calda/fredda e crescita improvvisa, misurando gli arrivi programmati
   oltre al throughput completato. Un client che attende ogni risposta può
   nascondere la coda. Non usare fonti pubbliche come bersaglio di stress.
5. Simulare indisponibilità delle fonti nei test locali. Non alzare limiti,
   falsificare identità o disattivare protezioni per ottenere un risultato verde.
   Confrontare errori inattesi e rifiuti previsti separatamente.

## Durante un picco

Soglie iniziali per aprire un'indagine: p95 oltre tre secondi per cinque minuti,
oppure oltre l'1% di errori inattesi con almeno cento richieste nella finestra.
Sono criteri manuali, **non allarmi automaticamente installati**. Una perdita
completa di disponibilità richiede intervento immediato anche con poco traffico.
Separare le subscription MCP dai normali caricamenti di pagina; non nascondere
le righe prive di diagnostica dentro una classificazione presunta.

- `FUNCTION_THROTTLED`: verificare burst e scaling nelle Functions.
- `deadline_exceeded`: leggere route/metodo, durata, richieste attive e
  saturazione; distinguere scadenza applicativa da saturazione della piattaforma.
- Fonte esterna lenta o non disponibile: preservare l'errore e i limiti;
  continuare a rendere disponibili gli snapshot indipendenti dalla fonte.

### Allarme Source health

Il workflow controlla la risposta pubblica `/api/fonti/stato`, compresa
l’integrità dichiarata dello snapshot SSN. L’API ha un budget breve per le
fonti: un timeout di questa osservazione non dimostra un’interruzione della
fonte. Se una fonte attiva risulta `down`, il monitor la verifica nuovamente
con lo stesso adapter in Node, fuori dalla richiesta HTTP, entro 45 secondi.
Restano attivi i timeout e i retry previsti dalla policy di ciascuna fonte.

Il log conserva entrambe le osservazioni. Una conferma positiva produce un
warning e non cancella il timeout originario; una conferma negativa, un
adapter mancante o un contratto SSN non valido fanno fallire il job.
Il monitor non aggiorna la cache pubblica, non modifica gli snapshot e non
richiede credenziali di pubblicazione. Per un warning ricorrente verificare
la latenza delle fonti e il budget dell’API, senza interpretarlo come un
guasto generale del sito.
- Regressione dopo un rilascio: confrontare SHA e log e valutare il rollback
  del deployment. Non ritentare automaticamente un'operazione con effetti
  esterni senza verificarne l'esito.
- Un singolo IP può rappresentare molti utenti dietro una rete condivisa;
  controllare i 429 prima di attribuirli ad abuso. I limiti in memoria sono
  per istanza, non un tetto globale alla spesa del team.

## Budget e disponibilità

Controllare Spend Management prima dell'evento, compresi destinatari degli
avvisi e consumo degli altri progetti. Le notifiche non sono un tetto alla
fattura. La sospensione automatica può interrompere tutti i progetti del team
con `503 DEPLOYMENT_PAUSED`, e non è istantanea: può maturare ulteriore consumo.
Non attivarla come ottimizzazione ordinaria se la priorità è restare disponibili.
Un limite economico rigido e disponibilità senza limiti non possono essere
promessi insieme. Stabilire chi interviene e quale spesa straordinaria è
accettabile prima di un lancio. [Spend Management](https://vercel.com/docs/spend-management).
