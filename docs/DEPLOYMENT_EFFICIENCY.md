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

`robots.txt` distingue ClaudeBot, usato per il crawling di addestramento, dai
client di ricerca e dalle richieste avviate dagli utenti. Le schede operatori
sono escluse dal crawl di ClaudeBot; il catalogo rimane accessibile.

Il progetto Vercel applica inoltre la regola `claudebot-operator-crawl`:

- Request Path **Starts with** `/appalti/operatori/`;
- **AND** User Agent **Contains** `ClaudeBot`;
- azione **Deny**, senza blocco persistente dell'indirizzo IP.

La regola opera prima dell'esecuzione della pagina. Non attivare un blocco
generale dei client non-browser: API e MCP sono accessi previsti dal prodotto.
Per annullare questa singola protezione, disattivare la regola e pubblicare la
modifica nel firewall, poi aggiornare la direttiva corrispondente in robots.

## Verifica dei risparmi

Confrontare revisioni sullo stesso runtime e con carico macchina comparabile.
Conservare digest e risultati, non solo tempi. Il controllo completo del corpus
rimane necessario: convalida ogni riga, oscuramento, URL e digest. È possibile
riusare una verifica già riuscita dello stesso URL o lo schema immutabile della
stessa tabella senza omettere la verifica dei valori di ogni riga.

Riferimenti: [build Vercel](https://vercel.com/docs/builds/managing-builds),
[Observability Plus](https://vercel.com/docs/observability/observability-plus),
[crawler Anthropic](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler).
