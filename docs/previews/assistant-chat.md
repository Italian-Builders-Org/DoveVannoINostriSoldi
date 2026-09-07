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
