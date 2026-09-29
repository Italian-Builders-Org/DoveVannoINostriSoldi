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
| `/enti/[codice]` e API ente | Dinamica dove usa IPA live | Profilo completo, inclusi patrimonio e scuole; identità ufficiali riconciliate |
| `/dati/[dataset]`, API dati e MCP | Politica del selector/trasporto esistente | Scansione limitata e cursori del rilascio; riuso bounded dei chunk già validati |
| Altre pagine ad alta cardinalità | Politica specifica della route | Crawler dichiarati coperti dal proxy; includere le nuove route nel matcher e nell'inventario |

Le route interne `/snapshot-pages/...` servono esclusivamente i rewrite del proxy.
Le viste predefinite usano la stessa cache; i filtri
redirigono all'URL pubblico. Anche gli alias attraversano il limite crawler.
Non pubblicare link o sitemap verso questi alias. I parametri ignorati dalle pagine, come quelli
di campagna, non creano nuove varianti del contenuto. Parametri semantici ripetuti
non entrano nella cache della vista predefinita.

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
serializzati. I chunk integrati hanno una LRU da 32 elementi e 16 MiB serializzati:
questi pesi non equivalgono al consumo effettivo dell'heap.

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

## Crawler e WAF

Il proxy ammette i crawler dichiarati sotto il limite esistente di 30 richieste
al minuto per IP, condiviso tra le route costose, e 600 richieste al minuto per
istanza. Il limite delle API resta separato. Le radici dei sottodomini vengono
risolte prima del controllo; gli asset sono fuori dal matcher.

Il fallback in memoria non è un limite distribuito. In Vercel verificare anche
le regole WAF prima delle funzioni. Il 30 settembre 2026 il limite già presente
per impronta JA4 è stato esteso ad Amazonbot, Bytespider e Applebot-Extended,
oltre a ClaudeBot, GPTBot, CCBot e Meta-ExternalAgent. Soglia: 30 richieste ogni
60 secondi, risposta 429. È limitazione dello scraping dichiarato, non un divieto.
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
