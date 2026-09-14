# Build, test e consumo del servizio

Misurare separatamente build, esecuzione delle funzioni, trasferimento e
osservabilità. Il numero di PR non è una voce di costo: lo sono le build e le
richieste effettivamente eseguite. Nell'interfaccia Usage, l'aggregazione del
grafico non modifica necessariamente l'intervallo di fatturazione.

## Snapshot server

I grandi JSON di PNRR asili e NASpI vengono letti una volta per processo come
`unknown` e passano agli stessi validatori e riconciliazioni del dato. In questo
modo TypeScript non inferisce il tipo di ogni riga del corpus. Limiti di
dimensione, letture complete e controllo della stabilità del file precedono il
parsing; non viene introdotto un percorso per saltare la validazione.

Ogni nuova lettura da filesystem deve avere i relativi percorsi in
`outputFileTracingIncludes` e nel controllo `check-runtime-traces.mjs`.
Un test locale del selettore non dimostra che il file sia incluso nel deploy.

La pagina `/opere` usa cardinalità e data dello snapshot locale validato, con
la data di rilevazione visibile. Il recupero live dei metadati è un fallback
quando lo snapshot non è disponibile. La ricerca per CUP mantiene il lookup
live con il suo limite di attesa.

## Deploy evitabili

`scripts/ci/vercel-ignore-build.mjs` confronta l'ultimo commit distribuito con
quello candidato. Modifiche esclusivamente a documentazione non operativa,
test, suite browser o benchmark locali non richiedono un'altra build Vercel.
File sconosciuti, snapshot, configurazioni di deploy e cronologia incompleta
richiedono comunque la build. La CI continua a verificare le modifiche.

Preparare e verificare localmente una revisione completa prima di pubblicarla
riduce i deploy intermedi. Un branch locale di integrazione aiuta a verificare
insieme una coda di PR dipendenti. Le regole effettive di `main` ammettono però
solo squash e rebase: una PR aggregata non conserverebbe gli SHA originali e non
farebbe risultare automaticamente unite le PR incluse. Mantenere quindi i merge
distinti e pubblicare ogni branch solo dopo la verifica sulla base aggiornata.

## Crawl ad alta cardinalità

Configurazione verificata nel dashboard Vercel il 14 settembre 2026:

| Regola | Ambito | Richieste per IP / 60 secondi |
| --- | --- | --- |
| `training-bot-operator-cap` | `/appalti/operatori`, ClaudeBot/GPTBot/CCBot/Meta-ExternalAgent | 30 |
| `search-bot-operator-cap` | catalogo e schede operatori, Claude-SearchBot | 30 |
| `operator-crawl-cap` | catalogo, filtri e schede `/appalti/operatori` con qualsiasi User-Agent | 120 |
| `enti-crawl-cap` | `/enti` e sottopagine, qualsiasi User-Agent | 30 |

La regola per Claude-SearchBot è stata aggiunta dopo aver osservato circa 20.000
richieste del crawler di ricerca contro 6.200 di ClaudeBot sugli operatori nelle
ultime 12 ore in produzione. I conteggi arrotondati non sono stime di risparmio.

Le regole restituiscono 429 senza ban persistenti, prima dell'esecuzione della
pagina. Sono attive anche `mcp-post-cap` e `costly-api-cap`. Claude-User e
Claude-SearchBot non corrispondono al filtro dei crawler di training: il primo
resta sui limiti generali, il secondo ha una quota dedicata per l’indicizzazione.
Il limite per IP impedisce che cambiare User-Agent
azzerri la quota, ma non costituisce un tetto globale per bot distribuiti.
Vercel conta separatamente le regioni. Sul piano Pro il filtro può usare lo
User-Agent, mentre usarlo come chiave di conteggio richiede Enterprise: non
serve cambiare piano per le regole sopra.

Il proxy conserva un limite locale di emergenza: crawler di training sugli
enti e API hanno contatori separati, rispettivamente 30 e 120 richieste/minuto
per IP e 600/minuto per istanza. Gli agenti user/search non corrispondono al
filtro locale dei crawler; il firewall applica comunque il limite generale.
Le risposte 429 sono `private, no-store` con `Retry-After: 60`.
Non sostituisce il firewall distribuito. Non applicare un 403 fisso a ClaudeBot:
lo scraping entro i limiti è ammesso. `robots.txt` resta un'indicazione ai client
collaborativi; le schede enti sono ancora escluse dalla scansione annunciata.

Il catalogo operatori e le viste nazionali usano indici/aggregati locali già
validati. Lo storico conserva al massimo otto riepiloghi, entro 16 MiB, e legge
solo i blocchi necessari alla pagina (massimo 25 aggiudicazioni). Questa è cache
dei dati, non cache HTTP dell'intera pagina: i dettagli con filtri sono ancora
renderizzati su richiesta. Non impostare indiscriminatamente `s-maxage` sulle
pagine App Router: HTML, RSC, parametri e stati di errore devono mantenere le
proprie varianti. Le API pubbliche cacheabili hanno policy esplicite; chat,
chiavi, quota, localizzazione ed errori non devono finire in cache condivisa.

Prima di aggiungere cache di pagina o viste materializzate, misurare la quota
di richieste ripetute allo stesso URL rispetto alla scansione di URL distinti:
una cache non evita il primo rendering di centinaia di migliaia di schede.
Per i menu, il prefetch parte su mouse/focus; mostrare molti link non deve
avviare il caricamento di tutte le destinazioni.

Non attivare un blocco generale dei client non-browser: API e MCP sono accessi
previsti dal prodotto. Le regole si gestiscono nel firewall senza un deploy;
ricontrollare il dashboard prima di modificarle, perché non sono versionate qui.

## Verifica dei risparmi

Confrontare revisioni sullo stesso runtime e con carico macchina comparabile.
Conservare digest e risultati, non solo tempi. Il controllo completo del corpus
rimane necessario: convalida ogni riga, oscuramento, URL e digest. È possibile
riusare una verifica già riuscita dello stesso URL o lo schema immutabile della
stessa tabella senza omettere la verifica dei valori di ogni riga.

Riferimenti: [build Vercel](https://vercel.com/docs/builds/managing-builds),
[Observability Plus](https://vercel.com/docs/observability/observability-plus),
[rate limiting Vercel](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting),
[crawler Anthropic](https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler).
