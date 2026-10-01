# Costi delle richieste pubbliche

Fluid Active CPU misura il lavoro delle funzioni durante le richieste. La macchina
Elastic/Enhanced riguarda le build. Eliminare deployment precedenti non riduce
la CPU della produzione né libera il disco temporaneo di una nuova build.

## Percorsi e protezioni

| Percorso | Risposta | Lavoro e limiti |
| --- | --- | --- |
| `/enti/[codice]/appalti` | ISR 6 ore per riepilogo, operatori, procedure e aggiudicazioni senza filtri | Snapshot ANAC validati; filtri e concentrazione restano dinamici |
| `/appalti/operatori/[ref]` | ISR 6 ore per la prima pagina senza filtri | Letture degli intervalli del pack; altre pagine e filtri restano dinamici |
| `/comuni?ente=...` e radice del sottodominio Comuni | ISR 6 ore per un Comune pubblicato | Profilo finanziario; nessuna scansione di patrimonio o servizi scolastici non visualizzati |
| `/comuni?q=...` | Dinamica | Ricerca locale; nessun prefetch dei risultati o dei Comuni suggeriti |
| `/api/comuni/search` | Dinamica, `no-store` | Indice dei nomi normalizzato una volta per istanza dal solo snapshot; ordinamento per pertinenza prima del limite, senza cache delle query |
| `/enti/[codice]` e API ente | Dinamica dove usa IPA live | Profilo completo, inclusi patrimonio e scuole; identità ufficiali riconciliate |
| `/dati/[dataset]`, API dati e MCP | Politica del selector/trasporto esistente | Scansione limitata e cursori del rilascio; riuso bounded dei chunk già validati |
| Altre pagine ad alta cardinalità | Politica specifica della route | Crawler dichiarati coperti dal proxy; includere le nuove route nel matcher e nell'inventario |

Le route interne `/snapshot-pages/...` servono esclusivamente i rewrite del proxy.
Le viste predefinite usano la stessa cache; i filtri
redirigono all'URL pubblico. Anche gli alias attraversano il limite crawler.
Non pubblicare link o sitemap verso questi alias; `robots.txt` li esclude per i crawler cooperativi. I parametri ignorati dalle pagine, come quelli
di campagna, non creano nuove varianti del contenuto. Filtri effettivi ripetuti
non entrano nella cache della vista predefinita; i parametri inutilizzati non
moltiplicano le chiavi, anche se ripetuti. CPV e anno vuoti nei form equivalgono
all’assenza del filtro. Il parametro `operator` filtra
solo la vista `operator`; non divide la cache delle quattro viste predefinite.
`metric` ordina soltanto `operators` e seleziona il denominatore di `concentration`.
I link non propagano questi parametri nelle viste che non li usano. Filtri CPV,
anno, dettaglio operatore, pagine successive e 50 righe conservano la risposta
dinamica; non creare cache HTML per combinazioni arbitrarie di query.

Next gestisce HTML, RSC, `Vary` e `_rsc`: non impostare indiscriminatamente
`Cache-Control: public` sulle risposte dinamiche. Non leggere cookie, header,
chiavi personali o `searchParams` della richiesta nei wrapper ISR. Gli identificativi assenti conservano lo stato pubblico dello snapshot
(200 con dato assente per Comuni/enti, 404 per operatori). Questa assenza stabile
può essere memorizzata: non equivale a un errore del lettore. Una rigenerazione
con snapshot illeggibile o non validato deve fallire, conservando la precedente
risposta valida; non renderizzare un errore temporaneo come successo. Non usare
`connection()` condizionalmente in una route ISR: causa Static to Dynamic Error.
`generateStaticParams()` restituisce `[]`: il deploy non costruisce tutte le
schede. Il TTL limita le rigenerazioni, non impone una nuova acquisizione dati.
Gli snapshot e le loro prove cambiano con il deployment; verificare anche un
aggiornamento dello snapshot prima di cambiare questa politica.

## Cache dei dati

Il profilo finanziario è condiviso con quello completo, senza inventare stati
«dato assente» per sezioni non richieste. Gli indici SIOPE sono limitati agli anni
delle fonti validate. I confronti comunali hanno una LRU da 128 elementi e 4 MiB
serializzati. I chunk integrati conservano la LRU generale da 32 elementi e 16 MiB
serializzati. I soli tre dataset MEF di beni, contratti e adempimento usano una
LRU separata da 96 elementi e 64 MiB: le scansioni degli altri dataset non
espellono il working set del patrimonio. I due budget sommano al massimo
80 MiB serializzati; questi pesi non equivalgono all'heap effettivo.

Ogni lettura di un chunk verifica ancora file regolare, dimensione e SHA-256
contro la prova del rilascio. Soltanto decompressione, parsing e validazione di
byte identici vengono riutilizzati. Non memorizzare errori, valori parziali o
promesse rifiutate. Conservare i limiti di concorrenza e l'annullamento per consumer.
Non sostituire questa verifica con una cache senza versionamento dell'intero
profilo dell'ente o del corpus.

## Misura locale del 30 settembre 2026

Sei dossier: Mantova, Milano, Roma, Bologna, Napoli e Firenze. Stesso Node 25.8.2,
stessi snapshot, tre passaggi nello stesso processo. Dopo il caricamento iniziale,
il batch consumava 2,8–3,4 secondi CPU; con il profilo finanziario e gli indici
riutilizzati consuma 1,7–4,8 millisecondi CPU. Il nuovo passaggio freddo consuma
466 millisecondi CPU; RSS del processo circa 430 MB.

Il confronto campo per campo conserva i valori dei sei dossier. Digest della
proiezione finanziaria prima e dopo:
`6832ab36d6a1cd2e40d1c5e62e698cf70f6fa07931a0da9a930e4134b7d16161`.
Il profilo completo delle schede enti conserva patrimonio e servizi scolastici.
Questa misura isola il calcolo locale, non descrive latenza di rete o fattura.

## Profilo completo: misura e dimensionamento

Il benchmark `scripts/bench/municipal-profiles.mjs` include anche scuole e patrimonio
nelle sei schede sopra, senza rete. Confronto finale su Node 24.19.0, stessi
snapshot, tre passaggi per processo prima e dopo. La CPU del batch caldo passa
da 5.532–6.519 ms a 52–58 ms. Il digest dell'intero profilo resta
`573f48c19c0e9de1480d3460b57a1cfccd8a817fb1a62e32fbf656aeab602482`.
RSS osservata nei passaggi caldi: 437–453 MiB prima e 557–558 MiB dopo.
Il primo passaggio, che include il caricamento iniziale, passa da circa
7.257 ms a 3.722 ms CPU: il beneficio caldo non descrive il costo di un nuovo processo.

Le prove precedenti a 32 e 48 MiB continuavano a espellere chunk utili. Il budget
dedicato al patrimonio è 96 chunk e 64 MiB serializzati, senza aumentare la
memoria configurata delle funzioni. Il peso serializzato non è un limite
all'heap totale; la RSS locale non misura la memoria della produzione.

Con `--scan`, lo stesso benchmark attraversa 120 Comuni distribuiti nel corpus,
superando il numero di elementi della cache. Il batch caldo passa da
53.646–55.021 ms a 8.604–8.786 ms CPU. RSS osservata: 457–484 MiB prima e
516–524 MiB dopo. Digest invariato:
`02736d9468943eeef7c09030484129272729c34bd2353d148c306d6ff6bbb299`.
Il confronto mostra il costo in memoria del riuso; non giustifica un aumento
illimitato della cache. I tempi variano con macchina e carico: non sono una
previsione di latenza o risparmio in fattura.

Il collegamento MIM usa ora la ricerca binaria sul codice ISTAT, ordinamento
garantito dall'ETL e verificato sull'intero dataset nel test del lookup. Legge
al massimo quattro chunk per Comune invece di cercare il codice in tutte le
celle. Restano riconciliati codice catastale, anno, schema, copertura e metadati
pubblici. Le query generiche API/MCP conservano scansione, cursori e limiti.

Il test che attraversa tutti i dataset interrogabili mantiene il suo limite
originale di 32 MiB di crescita dell'heap dopo garbage collection. Aumentare
indiscriminatamente la cache generale lo violava; la separazione per dominio
conserva il controllo senza alzarne la soglia.

Riprodurre la misura con:
`node --experimental-strip-types --import ./scripts/ci/node-test-setup.mjs scripts/bench/municipal-profiles.mjs`.
Confrontare a macchina libera e con lo stesso runtime; il primo passaggio
include il caricamento iniziale. I controlli sui byte compressi e sul loro hash
restano attivi anche a cache calda. Una scansione oltre il budget continua a
espellere gli elementi meno recenti: questa ottimizzazione non ferma un crawler
che richiede sempre dati nuovi. Il risparmio in fattura richiede il confronto
su 24 ore dopo il rilascio, non l'estrapolazione di questi tempi locali.

## Crawler e WAF

Il proxy ammette i crawler dichiarati sotto il limite esistente di 30 richieste
al minuto per IP, condiviso tra le route costose, e 600 richieste al minuto per
istanza. Il limite delle API resta separato. Le radici dei sottodomini vengono
risolte prima del controllo; gli asset sono fuori dal matcher.

Il fallback in memoria non è un limite distribuito. In Vercel verificare anche
le regole WAF prima delle funzioni. Il 30 settembre 2026 il limite già presente
per impronta JA4 è stato esteso ad Amazonbot, Bytespider e Applebot-Extended,
oltre a ClaudeBot, GPTBot, CCBot e Meta-ExternalAgent. Soglia: 30 richieste ogni
60 secondi, risposta 429. Il 1 ottobre la soglia JA4 è stata ridotta a 10/minuto
per regione e la regola per IP allineata alle stesse sette famiglie.
È limitazione dello scraping dichiarato, non un divieto.
Claude-User, Claude-SearchBot e i browser non corrispondono a questa regola.

Un'impronta può essere condivisa o cambiare; il limite JA4 non è un tetto globale
alla spesa. Un User-Agent è falsificabile. Non bloccare un intero ASN o tutti i
browser per una classificazione sospetta. I limiti per IP sulle route enti e
operatori rimangono quelli già attivi. Estendere una soglia stretta a tutte le
pagine può penalizzare reti condivise: richiede una revisione del perimetro.
Non abilitare una challenge globale che interrompa API, MCP o agenti avviati
volontariamente dagli utenti. Se serve una challenge, provarla su una route
precisa e verificare browser, lettori assistivi, crawler di ricerca e trasporti.

## Scelte operative

- Riutilizzare aggregati ANAC e pack esistenti. Aggiungere nuovi duplicati solo
  dopo aver misurato un hot path ancora costoso; non perdere controlli, coorti
  o provenance per risparmiare parsing.
- Conservare Fluid Standard, regione e quote attuali finché un confronto su
  traffico e carico equivalenti non giustifica una variazione. Ridurre memoria
  o durata massima non elimina il lavoro necessario.
- Conservare le preview manuali e raggruppare modifiche compatibili in una PR.
  Il risparmio dipende dai deployment effettivamente avviati, non dal numero
  dei commit conservati su GitHub. Vedi [DEPLOYMENT_APPROVAL.md](DEPLOYMENT_APPROVAL.md).
- Il 30 settembre il progetto è stato fissato a Enhanced (8 core, 16 GB RAM,
  64 GB disco). Elastic stava assegnando Turbo da 30 core; Enhanced aveva già
  pubblicato correttamente lo stesso commit fallito su Standard. È un tetto
  alle risorse, non una percentuale di risparmio: confrontare anche la durata
  fatturata della prossima build. Nessun nuovo deployment diagnostico avviato.
- Il supporto ha confermato esaurimento del disco durante la pubblicazione su
  Standard. Non tornare a 32 GB né escludere snapshot necessari senza prova
  del packaging e del picco disco. Le dimensioni NFT non sono né il numero
  delle funzioni pubblicate né la loro dimensione fisica dopo raggruppamento.
- Conservare produzione, alias e rollback. Rivedere la retention delle preview
  separatamente: la cancellazione non risolve il costo CPU e non viene eseguita
  come parte di questa ottimizzazione. Non acquistare una VPS per correggere
  rendering ripetuti che resterebbero costosi anche altrove.

## Verifica prima di consegnare

1. Test Node mirati per routing, limiti, identità e corruzione dopo un cache hit.
2. `node --experimental-strip-types --import ./scripts/ci/node-test-setup.mjs scripts/bench/municipal-footprints.mjs`.
   Confrontare stesso Node, macchina e dati; conservare digest, CPU, RSS e fasi
   fredde/calde. Il benchmark non è una stima della fattura.
3. Gate full e controlli dei trace. Gli alias ISR devono includere gli snapshot
   necessari e non l'intero corpus integrato quando usano solo dati finanziari.
4. Il gate produzione `scripts/browser/runtime-cache.mjs` verifica HIT,
   uguaglianza delle risposte, RSC e bypass dei filtri. La cache su disco del
   server locale può ripartire come STALE senza TTL dopo un riavvio: il gate
   richiede che la rigenerazione ripristini HIT e TTL entro 5 secondi. Vercel
   usa la propria cache ISR durevole, distinta per deployment; verificarne i
   segnali CDN dopo il rilascio. Il gate salva prove in
   `artifacts/browser/runtime-cache/`. Verificare anche mobile, tablet, desktop,
   tastiera, prefetch, overflow ed errori di idratazione.
5. Dopo il deployment verificare READY, cache CDN reale, filtri e sottodomini.
   Confrontare almeno 24 ore complete per route: invocazioni, CPU per richiesta,
   HIT/MISS, 429, errori e p95. Monitorare anche letture/scritture ISR, trasferimento
   e memoria: spostare un costo non significa eliminarlo.

Fonti: [cache CDN Next.js](https://nextjs.org/docs/app/guides/cdn-caching),
[ISR Vercel e costi](https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing),
[macchine di build](https://vercel.com/docs/builds/managing-builds#build-machines).

## Verifica del consumo residuo, 1 ottobre 2026

Nel ciclo 23 settembre–23 ottobre, al momento della verifica, DVNS totalizza
232 ore e 45 minuti Active CPU, il 99,8% della squadra. Gli altri progetti
non spiegano il consumo residuo.

La finestra produzione 30 settembre 23:14–1 ottobre 11:14 (ora italiana)
mostra circa 112 mila invocazioni e 7 ore Active CPU per gli appalti degli enti;
16 mila e un’ora per gli operatori. Sono valori arrotondati della dashboard; la finestra attraversa più revisioni
e serve a identificare le route dominanti, non a confrontare due deployment.
Nel campione consecutivo esportato delle 11:19–11:20, 59 invocazioni della stessa
produzione risultano MISS: 6 dichiarano Meta-ExternalAgent, le altre User-Agent
browser. Queste stringhe non provano l’identità dei client. I filtri effettivi e
il dettaglio operatore spiegano molti percorsi dinamici; i link propagavano anche
`operator` in viste che non lo usano. Con la correzione, 16 URL del campione
possono riusare le quattro viste già previste, senza aggiungere chiavi ISR.
Il campione non è una stima della quota su un’intera giornata.

Riprodurre il costo del percorso HTTP completo, non solo quello del loader:
server `next start`, stesso Node e corpus, campione di URL reali sanitizzato,
CPU del processo prima/dopo e profilo `--cpu-prof`; includere un secondo campione
che attraversa tutti i 256 shard, superando gli slot della cache. Distinguere
caricamento iniziale, rendering dinamico e risposta ISR calda. Confrontare i dati
nel DOM: l’HTML statico e quello in streaming possono differire nei placeholder.
Non attribuire il risparmio locale alla fattura. Prima di cambiare ancora budget
cache o hardware, misurare CPU/1.000 richieste, MISS, URL distinte, memoria,
errori e scritture ISR dopo il deployment, su finestre della stessa revisione.
