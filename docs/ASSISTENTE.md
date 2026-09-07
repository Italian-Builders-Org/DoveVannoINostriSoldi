# Chat AI sui dati pubblici

`/assistente` è una chat con chiave personale OpenRouter, OpenAI o Anthropic.
Ogni domanda passa dall’AI; senza collegamento, l’invio apre le impostazioni e conserva
la bozza. La pagina non usa risposte deterministiche o un conto API DVNS.
`/assistente/anteprima` reindirizza permanentemente alla pagina pubblica.

## Interazione e contesto

Il compositore è centrale all’inizio e si sposta in basso al primo invio. Nella
conversazione scorre solo l’elenco dei messaggi. Le risposte arrivano in streaming reale,
sono allineate a sinistra e supportano paragrafi, titoli, grassetti, codice inline ed
elenchi e tabelle con scorrimento orizzontale. HTML, immagini e link prodotti dal modello non diventano contenuto attivo.
I link alle fonti vengono dal catalogo server.

Ogni domanda ha copia e modifica; ogni risposta completata ha copia e rigenerazione.
La copia della risposta comprende i link alle fonti. Modifica e rigenerazione sostituiscono
anche i messaggi successivi, per mantenere una sola cronologia coerente. La modifica
richiede un invio esplicito e può essere annullata. Rigenerare comporta nuove chiamate
a pagamento, come una nuova domanda.

Il client conserva i messaggi solo nella memoria della pagina: massimo 12 domande;
per il contesto invia fino a 6 messaggi precedenti, entro 16.000 caratteri complessivi.
Risposte interrotte o fallite non entrano nella cronologia inviata al modello.
“Nuova chat” svuota la conversazione e mantiene la chiave. Salvare un nuovo collegamento
o scollegarlo avvia una nuova conversazione. Nessun archivio server, analytics o logging
delle domande. La finestra di contesto evita chiamate aggiuntive di riassunto a pagamento.

Lo scorrimento segue la generazione finché l’utente resta vicino al fondo. Se legge
messaggi precedenti, la chat non lo trascina in basso; un pulsante permette di tornare
all’ultima risposta. Transizioni brevi, pulsanti con feedback e `prefers-reduced-motion`
seguono le indicazioni di Emil Design.

## Allegati e attività

Il pulsante `+`, il trascinamento sul compositore e l’incolla di immagini permettono
fino a 8 allegati, 10 MB ciascuno. Formati: PNG/JPEG/WebP, PDF testuali, DOCX,
XLS/XLSX/ODS, TXT/Markdown/CSV/TSV/JSON in UTF-8. I file originali vengono letti
sul dispositivo e non sono caricati in archivi remoti. Prima dell’invio si può aprire
l’anteprima del testo o dell’immagine effettivamente disponibile al modello.

Il testo totale degli allegati è limitato a 80.000 caratteri, senza tagli automatici.
PDF: massimo 30 pagine, nessun OCR; immagini e grafici interni non sono estratti.
DOCX: solo testo, senza immagini o impaginazione. Fogli: massimo 10 schede e 5.000
celle valorizzate, coordinate e valore originale/formattato; formule non ricalcolate
e macro non eseguite. Le immagini vengono decodificate, ridimensionate entro 1.536
pixel per lato e ricodificate JPEG senza metadati originali (entro 450.000 caratteri
base64); richiedono un modello con visione. Lettura/estrazione ha un budget di 15 secondi.
I parser di documenti sono caricati quando servono e l’estrazione usa worker dedicati.

Gli allegati seguono il messaggio nelle domande successive, modifica e rigenerazione.
La richiesta complessiva può contenere al massimo 8 file: se i nuovi allegati superano
il budget, il client elimina dal contesto le coppie più vecchie e mostra un avviso.
Nuova chat, scollegamento, uscita e ricaricamento eliminano gli allegati in memoria.
La route accetta esclusivamente testo e JPEG inline validati, mai URL o file ID.
I blocchi inviati ai provider restano contenuti dell’utente distinti dall’evidenza DVNS.

Le tile da 56 px hanno miniature o icone, colore e sigla del formato. Anello e
percentuale seguono la lettura effettiva, con transizioni di ingresso e completamento.
Il dettaglio attività compare per allegati o ricerche effettive: nomi dei file,
selezione fonti, query eseguite e preparazione della risposta. Si richiude al termine.
Non mostra ragionamenti privati né passaggi inventati. Su Luna via OpenRouter,
la pianificazione usa `reasoning.effort: none`; la risposta usa `medium` soltanto se
il piano indica un confronto complesso o calcoli a più passaggi, altrimenti `none`.
`exclude: true` evita l’esposizione del ragionamento. I test verificano entrambi i payload.

## Chiavi e provider

Il pannello richiede provider, ID del modello, chiave e conferma dell’invio e dei costi.
Non esegue chiamate di verifica. La chiave rimane in memoria React, mai in cookie,
URL, localStorage o sessionStorage. Cambiare provider svuota il campo. Scollegamento,
ricaricamento, uscita e `pagehide` la rimuovono; il campo password viene svuotato anche
se il pannello era aperto. OpenAI API è distinta dall’abbonamento ChatGPT.

`POST /api/assistant/chat` riceve la chiave solo nell’header Authorization e la inoltra
solo all’endpoint fisso del provider scelto. DVNS vede chiave, domanda e contesto durante
l’elaborazione: BYOK non elimina questo trattamento. L’applicazione non li archivia
né li scrive nei log. Policy dell’hosting e conservazione del provider restano distinte.

OpenAI usa Responses con `store: false`, che non equivale a Zero Data Retention.
Anthropic usa Messages. OpenRouter usa Chat Completions con `data_collection: deny`
e `allow_fallbacks: false`. Il modello predefinito OpenRouter è `openai/gpt-5.6-luna`;
il campo resta modificabile. Servono modelli che supportano chiamate agli strumenti.
Nessuna chiave da environment, endpoint arbitrario, redirect, retry automatico o
fallback su altri conti/provider.

## Dati e costi

La prima chiamata AI riceve il catalogo compatto completo: id, titolo, filtri ed esempio.
Non riceve tutti gli snapshot o i testi delle fonti. Il modello chiama lo strumento
`query_dvns`, con al massimo due ricerche, oppure restituisce un chiarimento.
Gli argomenti devono rispettare lo schema MCP condiviso e i filtri del dataset;
solo dopo la validazione il server richiama `queryPublicDataset`.

Il catalogo e gli adapter sono gli stessi usati dal sito/MCP. Nuovi dataset registrati
in quel percorso diventano disponibili alla chat senza un catalogo AI separato.
Licenza, validazione, source lock e provenienza restano al confine dei dati pubblici.
Non si importano snapshot raw nei Client Component e non si accettano URL, SQL,
funzioni o strumenti di scrittura scelti dall’utente o dal modello.

Una seconda chiamata spiega l’evidenza delle query riuscite e gli eventuali allegati, preservando periodo,
misura, unità, copertura, fonte e limiti. Per SIOPE la proiezione mantiene gli aggregati
contabili e dichiara l’esclusione di classifiche, distribuzioni e normalizzazione
geografica. Con filtro regionale, `totalPaid` resta nazionale e il valore regionale
è in `regions`: il contesto lo dichiara esplicitamente.

Limiti per domanda: massimo due chiamate AI, due query, 5 righe dove è supportato `limit`,
offset 100, nessun cursore, evidenza entro 24.000 caratteri e risposta entro 2.048 token /
8.000 caratteri. Se l’evidenza è troppo grande, la ricerca chiede di restringere il campo,
senza troncamenti silenziosi. Il catalogo compatto iniziale è di circa 9.600 caratteri,
contro circa 31.000 includendo descrizioni e caveat ripetuti (50 dataset al momento
_della verifica_). La riduzione del testo non è una misura del costo effettivo del provider.

## Streaming, sicurezza e limiti operativi

La route valida origine, Host, JSON, consenso, ruoli, modello, chiave e dimensione:
4.000.000 byte, 8.000 caratteri per l’ultima domanda, 50 secondi complessivi. Rate limit in
memoria: 20 richieste/minuto per IP, 10 per hash della chiave, 4 concorrenti per istanza.
Non sono limiti distribuiti; l’hosting/edge resta una protezione operativa separata.

`Accept: text/event-stream` abilita il protocollo DVNS (`activity`, `delta`, `done`, `error`).
Il server decodifica SSE dai tre provider, gestisce UTF-8 spezzato, heartbeat, terminazioni,
errori, budget e cancellazione. Nessun evento di ragionamento, header, testo di errore
upstream o credenziale viene riversato nel client. Risposte parziali non vengono marcate
come complete; il pulsante stop abortisce la richiesta e non annulla costi già maturati.
Il parser richiede una terminazione valida e applica un budget anche ai byte ricevuti.

Il system prompt privilegia i dati DVNS, distingue misure e periodi, vieta cifre inventate,
accuse e l’esecuzione di istruzioni dentro domanda, cronologia o fonti. Un controllo
blocca alcuni tentativi espliciti di cambiare istruzioni. Non è una garanzia contro
jailbreak o allucinazioni: i vincoli effettivi sono egress fisso, schema validato,
adapter read-only, output escapato e budget. Non ci sono segreti nel contesto del modello.

BYOK non costituisce un’esenzione generale dal GDPR o dall’AI Act; ruoli e obblighi
vanno valutati sul servizio concreto. Informativa e pannello dichiarano il transito dei dati.

## Dettatura locale

Il microfono verifica il supporto locale e avvia la dettatura con il permesso del browser.
Richiede `SpeechRecognition.available({ langs: ["it-IT"], processLocally: true })`
e `processLocally`; nessun fallback remoto. Se serve il pacchetto italiano, il download
richiede un pulsante separato e non avvia il microfono.

La sessione termina entro 30 secondi. Stop concede fino a 3 secondi per l’ultimo risultato.
Escape, annullamento, pagina nascosta e unmount interrompono la sessione. Annullare
ripristina la bozza precedente; un testo già confermato e modificato resta nel compositore.
I testi incollati oltre 8.000 caratteri diventano allegati TXT, entro il limite di 80.000 caratteri complessivi estratti. Una domanda vuota diventa «Analizza il testo allegato»; una bozza esistente resta intatta. Il file resta visibile e rimovibile prima dell’invio. Per testo digitato, dettato o modificato oltre 8.000 caratteri la UI impedisce l’invio e indica quanto accorciare.
Il testo incollato o dettato resta nel campo, senza tagli automatici. Nessun audio viene caricato su DVNS e la
dettatura non invia mai automaticamente la domanda.

## Verifica

`tests/assistant-byok*.test.mjs` e `tests/assistant-stream.test.mjs` verificano contratti,
egress, isolamento delle chiavi, query, provenienza, cancellazione e SSE con provider
simulati. `test:browser:assistant` verifica interazioni, rete simulata e screenshot a
320, 390, 768 e 1280 px. `test:browser:voice` verifica l’API vocale simulata, senza
registrare un microfono fisico. `test:browser:attachments` legge i file sintetici di `tests/fixtures/assistant/`, verifica anteprime, limiti, contesto e layout alle stesse larghezze. Tutte e tre le suite fanno parte dei gate di produzione.

Le prove reali OpenRouter si svolgono separatamente tramite il pannello della chat,
con chiave autorizzata dall’utente e mai inclusa negli artifact. I test simulati non
costituiscono una prova di accesso reale a OpenAI o Anthropic.

L’endpoint precedente `/api/assistant` rimane compatibile per i suoi client e test;
la chat pubblica non lo chiama. La issue #17 resta aperta per le fasi successive,
tra cui eventuali account, cronologie persistenti e analisi aggregate delle domande.

Fonti: [OpenAI dati](https://developers.openai.com/api/docs/guides/your-data),
[OpenAI strumenti](https://developers.openai.com/api/docs/guides/function-calling),
[OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses),
[Anthropic strumenti](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools),
[Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming),
[OpenRouter strumenti](https://openrouter.ai/docs/guides/features/tool-calling),
[OpenRouter streaming](https://openrouter.ai/docs/api_reference/streaming),
[OpenRouter routing](https://openrouter.ai/docs/guides/routing/provider-selection),
[OpenRouter privacy](https://openrouter.ai/docs/guides/privacy/data-collection),
[EDPB](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en),
[Commissione europea](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act).

### Scelta dell’analisi con Luna

Per OpenRouter e `openai/gpt-5.6-luna`, il pannello offre Automatica, Rapida
(`reasoning.effort: none`) e Approfondita (`medium`). Automatica segue il piano
verificato; la selezione delle fonti usa sempre `none`. Il corpo del ragionamento
non viene richiesto né mostrato. La label delle attività indica la modalità
richiesta, non una misura dei token effettivamente consumati dal provider.
Le opzioni seguono la [documentazione OpenRouter](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

La proiezione per la chat MEF comunale converte esattamente `amountCents` e
`knownAmountCents` in stringhe decimali `amountEuros` e `knownAmountEuros`.
Gli adapter pubblici/MCP restano invariati. La proiezione mantiene copertura,
frequenze, celle parziali, periodo e provenance, evitando che il modello legga
un importo in centesimi come euro. Il piano distingue inoltre i totali IRPEF
territoriali dalle tabelle di dettaglio prive di filtro per singola regione.
