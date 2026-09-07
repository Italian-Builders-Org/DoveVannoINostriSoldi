# Assistente deterministico

## Perimetro della prima tranche

`/assistente` e `/api/assistant` espongono una piccola interfaccia testuale, read-only e
deterministica. Il parser riconosce soltanto intenti allowlisted in italiano e il server richiama
direttamente `queryPublicDataset`: non effettua HTTP ricorsivo verso il sito e non accetta URL,
SQL, nomi di funzione, provider o dataset scelti dal testo.

Gli intenti disponibili sono:

- pagamenti SIOPE nazionali dei Comuni per anno;
- confronto dei pagamenti SIOPE tra due anni, in Italia o in una sola Regione;
- pagamenti SIOPE regionali dei Comuni per anno, soltanto per le Regioni esplicite nel catalogo;
- pagamenti dello Stato nazionali nel rilascio OpenBDAP disponibile per anno;
- imposta netta dichiarata MEF per Regione nell’anno d’imposta 2024.

Ogni risposta contiene dataset, periodo, osservazione numerica, fonte, data di osservazione,
fatti numerici già calcolati dall’adapter e caveat. La risposta non restituisce il prompt né il
payload completo dell’adapter.

## Confronto tra due anni — issue #17

Esempi: «Come sono cambiati i pagamenti dei Comuni tra il 2024 e il 2025?»
e «Confronta i pagamenti dei Comuni in Calabria dal 2024 al 2025».
Il parser riconosce l’intera domanda di confronto: due anni distinti e un solo
territorio. Ordina gli anni in senso cronologico e indica la direzione della
differenza. Domande con più anni, temi specifici, mesi, territori multipli o
confronti Stato/IRPEF ricevono aiuto; non viene più usato silenziosamente soltanto
il primo anno. Anche le richieste con un solo anno che chiedono un confronto
ricevono aiuto.

La risposta `kind: comparison` conserva due `answers`, ognuna con periodo,
valore, copertura, fonte e osservazione propri. `change` contiene differenza in
euro e percentuale rispetto all’anno iniziale soltanto se entrambi i rilasci
arrivano a dicembre e sono osservati dopo la fine dell’anno. Negli altri casi è
`null` e il motivo è visibile prima dei valori. Un dicembre ancora in corso non
è un anno completo. Base zero: differenza disponibile, percentuale `null`.
Gli importi vengono confrontati in centesimi interi sicuri; nessuna annualizzazione
né correzione per l’inflazione.

È una differenza fra gli aggregati pubblicati di ciascun anno, non un confronto
su una coorte costante: possono cambiare enti con movimenti e abbinamenti IPA.
Nessun indicatore di qualità, efficienza o causalità. Se manca un anno, una query
fallisce o il territorio/anno restituito non coincide, l’intera risposta è
`unavailable`, senza risultati parziali spacciati per confronto.

## Sicurezza e limiti

- JSON soltanto, `Content-Type: application/json`, origine same-host e Host coerente;
- body massimo 16 KiB e prompt massimo 500 caratteri;
- una query per dato singolo, esattamente due per il confronto SIOPE; un unico timeout
  complessivo e `AbortSignal` condiviso, cancellato anche se una delle due query fallisce;
- nessuna persistenza, cronologia, analytics applicativa o logging del testo;
- richieste su frode, corruzione, evasione o responsabilità individuale vengono rifiutate con una
  spiegazione non accusatoria;
- richieste ambigue, classifiche, singoli Comuni e provider AI producono esempi, non stime.

Il route handler applica i limiti di durata e body, un rate limit in memoria di 30 richieste
al minuto per indirizzo e massimo 4 richieste concorrenti. Questi controlli sono locali
all’istanza: non sono un rate limit distribuito e non sostituiscono una regola edge/WAF
per rate limiting e abuse prevention.

## Dettatura locale — issue #17

La voce è progressive enhancement della stessa domanda testuale. “Detta la domanda” apre
un dialog nativo nominato, senza avviare il microfono. Il browser deve esporre
`SpeechRecognition.available({ langs: ["it-IT"], processLocally: true })` e la proprietà
`processLocally`: in assenza del supporto locale, resta la scrittura manuale. Nessun fallback
a riconoscimento remoto o API prefissate legacy. Il supporto è ancora sperimentale e dipende
da browser, lingua, dispositivo e Permissions Policy; non viene promesso per tutti i browser.

Il download del pacchetto italiano richiede un pulsante separato: è gestito dal browser,
contatta il suo servizio e può proseguire se il dialog viene chiuso. L’installazione non
attiva il microfono. Solo “Inizia dettatura” chiama `start()`, dopo aver imposto
`processLocally = true`, `lang = it-IT`, `continuous = false` e `interimResults = false`.
La sessione termina entro 30 secondi; “Termina dettatura” concede al browser al massimo
3 secondi per l’ultimo risultato. Escape, chiusura, pagina nascosta e unmount interrompono
la sessione e scartano la bozza. Callback tardive non possono ripristinarla.

La trascrizione finale è modificabile. Oltre 500 caratteri, la UI segnala che non ha acquisito
la parte finale e impedisce la conferma finché il testo non rientra nel limite. “Usa questo
testo” sostituisce la domanda, senza inviarla; solo “Cerca nei dati” chiama la route esistente,
con i medesimi rate limit, validazione, fonti e calcoli. Nessuna cattura di audio tramite
MediaRecorder, upload, storage, telemetria o log di audio/trascrizioni. La privacy pubblica
descrive questa sequenza. La chiusura restituisce il focus al pulsante di apertura.

Riferimenti API: [elaborazione locale](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally),
[disponibilità](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static),
[pacchetti del browser](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/install_static).

Verifica: `node --experimental-strip-types --test tests/assistant-voice.test.mjs` e
`npm run test:browser:voice` con `DVNS_BASE_URL` su un server locale. I casi browser con
riconoscimento simulato verificano transizioni, conferma, rete, responsive e tastiera;
non misurano accuratezza della trascrizione o funzionamento di un microfono fisico.

## Evoluzione futura

ASR remoto, provider LLM, memoria conversazionale e analisi aggregate delle domande richiederebbero una
nuova valutazione di consenso, minimizzazione, retention, opt-out, audit e parità delle risposte.
Non fanno parte di questa tranche; la issue #17 resta aperta per le fasi ulteriori già discusse.
