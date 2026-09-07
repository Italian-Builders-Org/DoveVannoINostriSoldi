# Assistente: compositore e AI personale

La pagina pubblica `/assistente` usa il compositore chiaro approvato. La precedente
`/assistente/anteprima` reindirizza permanentemente alla pagina pubblica.

Il controllo browser ripetibile è `npm run test:browser:assistant`: screenshot iniziale,
conversazione e impostazioni a 320, 390, 768 e 1280 px in `artifacts/browser/`.
La dettatura inline mantiene il motore locale: `npm run test:browser:voice`.
Architettura, trattamento delle chiavi e limiti sono descritti in `docs/ASSISTENTE.md`.

## Prova reale nel browser

Il 7 settembre 2026 il browser integrato ha usato OpenRouter con
`openai/gpt-5.6-luna` e una chiave personale fornita per questa verifica.
Sono state verificate una domanda nazionale SIOPE 2025, una domanda successiva
sulla Calabria, la modifica in Lombardia, la rigenerazione e il confronto
Calabria 2024–2025. La risposta nazionale riportava 114.197.852.372,52 euro;
il confronto regionale riportava 4.257.404.807,12 e 4.651.243.753,62 euro,
con periodo e limiti espliciti.

Il browser ha ricevuto `text/event-stream` con più blocchi di risposta.
Copia, annullamento della modifica, interruzione, nuova chat, suggerimenti e
apertura delle impostazioni senza chiave sono stati provati nell'interfaccia.
Al termine la chiave è stata scollegata e il campo password verificato vuoto.
Nessuna chiave è inclusa in questo documento o nei test.

Le chiamate reali a OpenAI e Anthropic non sono state eseguite: i loro
protocolli, strumenti e stream sono coperti da risposte simulate nei test.
I test browser automatici usano una chiave fittizia e risposte simulate;
non rappresentano ulteriori chiamate pagate. Il costo effettivamente addebitato
al conto OpenRouter non è stato misurato.

## Allegati: prove reali e responsive

Il 7 settembre 2026 sono stati generati PDF, DOCX, XLSX, TXT e PNG sintetici
(Comune di Esempio, nessun dato personale) e caricati nel browser con il selettore file.
Dopo un errore di autenticazione con una prima chiave, una seconda chiave autorizzata
ha completato due domande reali a Luna:

- PDF + Word + Excel: biblioteca 120.000/90.000 euro, parco 80.000/40.000;
  residui 30.000 e 40.000; pagamenti 75%, 50% e 65% complessivo ponderato.
  La risposta ha rilevato che il Word contiene solo la biblioteca e ha citato i file.
- PNG + TXT: lettura nell’immagine dei 90.000 euro pagati e dello stanziamento
  di 120.000 euro presente anche nella nota. Provenienza sintetica dichiarata.

Sono prove locali con un provider reale, non prove del deployment. Non è stato
misurato il costo esatto né registrata la telemetria dei token di ragionamento.
La chiave è stata scollegata al termine. I test automatici successivi non la usano.

`npm run test:browser:attachments` verifica estrazione effettiva dei sei formati
PDF/DOCX/XLSX/PNG/TXT/MD, anteprima, conservazione nei messaggi, modifica e
rigenerazione, limiti ed errori a 320, 390, 768 e 1280 px. Le risposte AI di questa
suite sono simulate. La finestra 768x700 copre anche il difetto del footer che si
sovrapponeva ai suggerimenti quando crescevano prompt e allegati.
Screenshot: `artifacts/browser/assistant-attachments-<larghezza>-*.png`.
