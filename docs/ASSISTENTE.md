# Chat AI sui dati pubblici

`/assistente` offre dieci domande gratuite al giorno con Regolo `glm5.2`, senza account,
quando il servizio gratuito è configurato. Il primo invio richiede il consenso al
trattamento della domanda e del contesto. Esaurita la quota, si può continuare la
conversazione con una chiave personale Regolo, OpenRouter, OpenAI o Anthropic.
Se il servizio gratuito non è disponibile, l’invio apre il pannello della chiave e conserva la bozza.
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
richiede un invio esplicito e può essere annullata. Rigenerare consuma una nuova domanda gratuita o nuove chiamate sul conto personale.

Il client conserva i messaggi solo nella memoria della pagina: massimo 12 domande;
per il contesto invia fino a 6 messaggi precedenti, entro 16.000 caratteri complessivi.
Risposte interrotte o fallite non entrano nella cronologia inviata al modello.
“Nuova chat” svuota la conversazione e mantiene la chiave. Salvare un nuovo collegamento conserva la conversazione: il consenso autorizza l’invio del contesto al provider scelto. Scollegarlo avvia una nuova conversazione. Nessun archivio server, analytics o logging
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
Nel percorso personale non si usano chiavi da environment. Nessun endpoint arbitrario, redirect, retry automatico o
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

`monetary-evidence.ts` converte gli interi in centesimi degli adapter MEF, SSN e
COFOG in stringhe decimali esatte in euro, senza arrotondamento floating-point.
I campi diventano `amountEuros`, `knownAmountEuros` o `valuesEuros`; anche le unità
del payload e gli scarti monetari di riconciliazione sono riallineati. La quota di
PIL Eurostat è espressa come `shareOfGdpPercent`. I valori SSN marcati mancanti
diventano `null`, conservando il flag originale: non sono zeri osservati.
La proiezione non modifica gli snapshot né i contratti pubblici MCP. I test
riconciliano i valori con gli adapter reali, preservano fonti, flag e perimetri e
controllano il budget di un confronto SSN/COFOG. Questa preparazione riduce gli
errori di scala; non certifica la correttezza di ogni risposta generata.

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
Il server decodifica SSE dai quattro provider, gestisce UTF-8 spezzato, heartbeat, terminazioni,
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


## Regolo e quota gratuita

La modalità `free` accetta esclusivamente `regolo` / `glm5.2`, senza header Authorization
né opzioni di ragionamento dal client. La chiave condivisa viene letta esclusivamente
nel modulo `server-only` `free-quota.ts`. Il percorso personale non ripiega mai sulla
chiave condivisa. Regolo usa Chat Completions, uno strumento nominato per il piano e
SSE per la risposta; `reasoning_effort: none` evita di consumare il budget della chat
in ragionamento privato. GLM 5.2 non supporta immagini: il server le rifiuta prima della
prenotazione. I documenti con testo estratto sono supportati.

Una domanda accettata riserva un credito prima di contattare il modello; può generare
al massimo due chiamate, senza retry. Errori del provider, interruzioni e rigenerazioni
non restituiscono il credito: anche una risposta interrotta può aver consumato token.
Richieste malformate e immagini non supportate non consumano crediti.
Non è previsto un tetto economico globale. Restano i limiti tecnici di dimensione,
tempo, frequenza e concorrenza.

`POST /api/assistant/quota` crea un cookie giornaliero firmato, HttpOnly, Secure,
SameSite=Strict, con prefisso `__Host-` in hosting. Non contiene credenziali o messaggi.
I contatori sono aggiornati con una transazione PostgreSQL su Supabase, senza fallback in
memoria: dieci domande per browser **e** rete, una richiesta attiva per entrambi,
lock con scadenza di 90 secondi e massimo 60 operazioni quota/minuto per rete.
Un prefiltro in memoria, limitato a 5.000 identificativi HMAC, ferma inoltre oltre
60 consultazioni/prenotazioni al minuto sulla stessa istanza prima di Supabase.
Non sostituisce il controllo distribuito e non impedisce traffico da reti diverse.
Su Vercel si usa esclusivamente l’IP attestato da `x-vercel-forwarded-for`; fuori Vercel
è disponibile soltanto il percorso locale loopback per sviluppo. IPv6 è normalizzato
alla rete /64 e gli indirizzi IPv4-mapped condividono il contatore IPv4.

Supabase riceve identificativi HMAC diversi ogni giorno, non IP, cookie originali o
conversazioni. Il reset è a mezzanotte Europe/Rome, compresi i cambi di ora legale;
i contatori scadono due minuti dopo il reset e pg_cron li elimina ogni dieci minuti. Anteprime e produzione hanno namespace
diversi. Gli utenti dietro una stessa rete possono condividere il limite: senza auth
browser e IP non equivalgono a una persona. Cambiare solo browser, cancellare cookie,
ricaricare o aprire una nuova chat non azzera il contatore della rete.

Configurare esclusivamente sul server (mai con prefisso `NEXT_PUBLIC_`):

- `REGOLO_API_KEY`: chiave del conto condiviso.
- `ASSISTANT_QUOTA_SECRET`: segreto casuale di almeno 32 caratteri per le firme HMAC.
- `ASSISTANT_SUPABASE_URL`: URL HTTPS del progetto dedicato.
- `ASSISTANT_SUPABASE_SECRET_KEY`: chiave server `sb_secret_...`; mai publishable/anon.

Il database Supabase deve essere dedicato e condiviso dalle istanze del deployment.
Non riutilizzare database di altri progetti. Se configurazione, identità attestata o
Supabase non sono disponibili, il percorso gratuito si chiude prima di contattare Regolo;
le chiavi personali restano utilizzabili. Il sito e i test offline non richiedono segreti.
Le risposte pubbliche espongono solo disponibilità, domande residue e orario del reset.

Fonti: [Regolo Chat Completions](https://docs.regolo.ai/models/families/completions/),
[Regolo reasoning](https://docs.regolo.ai/models/features/reasoning/),
[Supabase database functions](https://supabase.com/docs/guides/database/functions),
[header Vercel](https://vercel.com/docs/headers/request-headers).


### Migrazioni Supabase e costi

Applicare nell'ordine le migrazioni in `supabase/migrations/`: schema/RPC e job di
pulizia pg_cron. Le tabelle stanno in `assistant_private`, fuori dalla Data API,
con RLS attiva e nessun grant anon/authenticated. Le due RPC pubbliche sono
`SECURITY INVOKER`, con `search_path` vuoto ed EXECUTE riservato a `service_role`.
Nessuna connessione database rimane aperta mentre il modello risponde.

Il database verifica anche il giorno Europe/Rome e limita a dieci gli invii senza
fidarsi del numero trasmesso dal client. Acquisisce sempre prima la riga rete e poi
quella browser; la pulizia segue l'indice `expires_at`. La cronologia e le chiavi API
personali restano nella memoria della pagina. Non vengono attivati Auth, Storage,
Realtime, Edge Functions, repliche, backup a pagamento o branch Supabase.

Il piano Free verificato il 12 settembre 2026 include 500 MB database e 5 GB egress,
con massimo due progetti attivi per account. Può sospendere il progetto dopo sette
giorni di inattività: il sito mostra gratuito non disponibile e consente BYOK.
Nessun keepalive artificiale e nessun upgrade automatico. La sospensione o un errore
del job possono ritardare la pulizia: controllare `cron.job_run_details` e gli advisor.
Non promettere capacità illimitata: misurare `pg_total_relation_size` e traffico nella
dashboard, conservando soltanto le righe giornaliere. [Listino](https://supabase.com/pricing).

Verifica PostgreSQL locale (server temporaneo dedicato, senza costi remoti):
`DVNS_POSTGRES_BIN=/percorso/bin node --experimental-strip-types --test tests/live/assistant-quota-postgres.test.mjs`.
Il test crea un database vuoto, applica la prima migrazione e verifica realmente
concorrenza, confini quota e permessi. La schedulazione pg_cron si verifica nel
progetto Supabase dopo la seconda migrazione, separatamente dal test locale.
