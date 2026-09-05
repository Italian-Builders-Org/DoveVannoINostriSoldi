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

Il listino verificato il 5 settembre indica $0,014/min per Standard on demand
e $0,028/min per Enhanced, con arrotondamento della durata al minuto superiore.
Dieci build da cinque minuti costerebbero rispettivamente $0,70 e $1,40, a
parità di durata ipotizzata. Standard senza on-demand o Elastic non è fatturata
come build a consumo. Questi importi non includono il runtime né l'intera fattura.
Fonti: [gestione build](https://vercel.com/docs/builds/managing-builds),
[listino](https://vercel.com/docs/pricing#builds).

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
