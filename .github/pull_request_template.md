## Cosa cambia

Descrivi il risultato osservabile e il perimetro della PR.

Maintainer responsabile della review e dell'integrazione, solo per cambiamenti
sostanziali: `da assegnare`.

## Evidenza

- [ ] Il diff è limitato al problema dichiarato.
- [ ] Ho aggiunto o aggiornato test che falliscono senza la modifica.
- [ ] `npm test`, test ETL Python, typecheck, lint, design check e build passano.
- [ ] Ho verificato `git diff --check`.

### Dati pubblici

Compila questa sezione se la PR aggiunge o modifica dati.

- [ ] URL ufficiale, titolare, licenza, periodo e data di osservazione sono espliciti.
- [ ] Schema, hash, provenienza e riconciliazioni falliscono in modo chiuso.
- [ ] Importi, frequenze, saldi, pagamenti e finanziamenti non vengono confusi.
- [ ] Il testo evita inferenze su spreco, frode, merito, qualità o responsabilità non dimostrate.

### UI e accessibilità

Compila questa sezione se la PR modifica una superficie utente.

- [ ] Ho verificato tastiera, focus, stati vuoto/errore/caricamento e console browser.
- [ ] Ho verificato 390, 768 e 1280 px senza overflow o contenuti irraggiungibili.
- [ ] Tabelle e grafici hanno un equivalente accessibile.

### API e MCP

Compila questa sezione se la PR modifica API o MCP.

- [ ] Input sconosciuti, duplicati, malformati e non limitati vengono rifiutati.
- [ ] La superficie MCP resta pubblica, stateless, limitata e read-only.
- [ ] Ho verificato il route HTTP reale, non soltanto import in-process.

## Limiti e prove non eseguite

Elenca con precisione check esterni, dispositivi, workflow o fonti non verificati.
