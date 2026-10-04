# Collegamenti pubblici GovCore (facoltativi)

Il comando `tools/govcore` legge IPA e codice fiscale istituzionale dalla proiezione SIOPE già validata in DVNS. Restituisce un overlay separato di riferimenti logici e risultati del resolver. Non modifica snapshot, importi, periodi, copertura o provenienza; non attiva chiamate dalle pagine, dalle API o da MCP. Il merge adotta questo strumento opzionale, non aggiunge un consumer UI.

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund --prefix tools/govcore
GOVCORE_URL=http://127.0.0.1:8041 npm run link --prefix tools/govcore -- --ipa c_c002 --concurrency 2
npm test --prefix tools/govcore
```

L'URL è esplicito e parametrico: loopback per il servizio locale, HTTPS senza credenziali per un eventuale servizio remoto configurato dall'operatore. Non esiste un URL predefinito, provisioning o migrazione. I test e il benchmark usano il guard offline e risposte HTTP sintetiche su loopback; il comando operativo può leggere l'endpoint esplicitamente configurato.

Il pacchetto MIT è incluso nella tarball locale, con JavaScript compilato, tipi e licenza. `tools/govcore/vendor/provenance.json` registra commit GovCore `0fb9ed30a3e4d1a0a6d57e0cfbe95f90dd7d91e2`, hash del pacchetto e dei sorgenti. Installazione e CI non dipendono da un registro npm privato; manifest e lock principali di DVNS rimangono invariati. Il typecheck dell’applicazione esclude questo pacchetto opzionale, che viene verificato separatamente dalla CI con `tsc -p tools/govcore/tsconfig.json`; un normale `npm ci` alla radice non richiede di installarlo. Il consumer DVNS resta sotto la licenza del prodotto; nessun dato o codice curato del prodotto è copiato nel core.

Il comando accetta al massimo 50 selezioni IPA, senza ricerca per nome. I soli parametri remoti sono IPA e, quando disponibile, codice fiscale istituzionale. Non invia sede, località, CUP/CIG, contabilità, note, file, utente o token DVNS. Duplicati dell'intero insieme di selettori si riusano soltanto nella stessa invocazione; ogni invocazione successiva ricontrolla le prove. Un codice aggiuntivo non viene eliminato per ottenere un risultato positivo.

`resolved`, `ambiguous`, `not_found` e `conflict` restano distinti. Trasporto o contratto non validi producono un errore fisso e nessun ID; non vengono stampati payload d'errore remoti. Non esistono retry automatici o cache fra invocazioni. L'ID pubblico non certifica competenza, destinatario, autorità di segnalazione o disponibilità di dati finanziari. Exit code: 0 per risultati del resolver validi (anche irrisolti), 1 se almeno una riga ha un errore di trasporto/contratto/input, 2 per argomenti/configurazione non validi.

Per Cassano, la proiezione DVNS pubblica IPA `c_c002` e CF `88000230784`; entrambi devono concordare nella risposta corrente. Lauropoli e Sibari restano località: il comando rifiuta `--name`, non inventa Comuni, non inferisce il proprietario dalla sede e non sceglie il primo candidato. Un'etichetta locale in un record non modifica i selettori. Se il core non risponde o la prova scade, l'overlay ha ID nullo e la contabilità locale resta disponibile invariata.

La CI verifica lo strumento opzionale nel job Node, inclusi SDK installato dalla tarball, CLI reale e HTTP sintetico. Le fixture comprendono codice proprietario errato, CF incoerente, evidenze osservate/scadute, revoca visibile alla successiva invocazione, outage e località non ricercabili. Queste prove non certificano una risposta ufficiale sintetica, il deployment GovCore o una copertura nazionale.
