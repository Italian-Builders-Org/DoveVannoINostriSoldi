# Segnala un problema

Il controllo globale è un'icona 44px in basso a destra (nome accessibile
«Segnala un problema»). Lo stesso ingresso, con etichetta visibile, è nel
footer e in `/supporto`. Apre un dialog che raccoglie
una segnalazione strutturata e la trasforma in una issue pubblica del
repository. Questa nota descrive il contratto, i limiti e le scelte di
sicurezza, così che codice, `/supporto`, `/privacy` e `SECURITY.md` restino
coerenti. Nasce dalla issue #197.

## Componenti

| Parte | File | Ruolo |
|---|---|---|
| Trigger | `src/components/report-problem/report-problem-button.tsx` | Bottone client minimale; carica il dialog con `next/dynamic` solo alla prima attivazione. |
| Dialog | `src/components/report-problem/report-problem-dialog.tsx` | `<dialog>` nativo (`showModal`, focus trap, `Esc`), validazione con lo stesso schema del server, stati vuoto/invio/errore/successo. |
| Contratto | `src/lib/report/contract.ts` | Schema `zod` fail-closed, normalizzazione del testo, rendering della issue, URL del composer GitHub. Importato anche dal browser: nessun segreto. |
| Endpoint | `src/app/api/segnalazioni/route.ts` | `POST` same-origin; guardie HTTP condivise (`src/lib/http/public-post-guard.ts`), rate limit, idempotenza, chiamata a GitHub. |
| Client GitHub | `src/lib/report/github.ts` | Token di installazione GitHub App via JWT RS256 (`node:crypto`), creazione e ricerca issue, timeout espliciti. |
| Limitatore | `src/lib/report/rate-limit.ts` | Finestra scorrevole in memoria per indirizzo (hash) e per istanza. |

## Cosa viene inviato

Il client invia solo questi campi; qualsiasi chiave in più (`labels`,
`assignees`, `repository`, `title`, …) fa rifiutare l'intera richiesta.

| Campo | Vincolo |
|---|---|
| `clientKey` | UUID generato dal browser all'apertura del dialog; chiave di idempotenza. |
| `category` | `bug`, `dato`, `accessibilita`, `feature`, `altro`. |
| `observed`, `expected` | Obbligatori, max 2 000 caratteri ciascuno dopo normalizzazione. |
| `steps` | Max 2 000 caratteri. Obbligatorio per `bug`, `dato`, `accessibilita` e `altro`. Facoltativo per `feature`. |
| `sourceUrl` | Facoltativo; obbligatorio per `dato`. Solo `https`, senza credenziali. |
| `page.path` | Solo percorso relativo (`/…`) valido sul dominio canonico; il server compone l'URL. |
| `page.title` | Max 200 caratteri. |
| `context.reportedAt`, `context.openedAt` | ISO 8601; l'invio deve avvenire almeno 3 s dopo l'apertura e non oltre 24 h. |
| `context.viewport`, `context.userAgent` | Dichiarati nel form. Nessun IP, nome o email. |
| `website` | Honeypot: deve restare vuoto. |

Il corpo JSON non può superare 12 288 byte; `Content-Type`, `Origin` e `Host`
devono essere coerenti con il sito, come per `/api/assistant`.

## Issue generata

Titolo e struttura sono decisi dal server:

```text
[Segnalazione] <categoria>: <percorso pagina>
```

Il corpo inizia con un marker HTML nascosto `<!-- dvns-report-key: <uuid> -->`
e contiene le sezioni «Tipo di problema», «Pagina», «Risultato osservato»,
«Risultato atteso», «Passaggi per riprodurre», «Fonte ufficiale, se
pertinente», «Contesto tecnico» e la nota che il contenuto non è verificato.
Per la categoria `dato` viene aggiunto il richiamo che un valore diverso non
dimostra spreco, frode o responsabilità.

Ogni testo dell'utente è racchiuso in un blocco ` ```text ` con fence più lunga
di qualsiasi sequenza di backtick contenuta: dentro una fence GitHub non
interpreta HTML, `@mention`, `#riferimenti` o link, quindi il form non può
notificare persone né iniettare markup. Il titolo della pagina, usato in linea,
viene ripulito dai caratteri Markdown e le `@` sono sostituite con `＠`.

La label applicata è `segnalazione`. Va creata una sola volta nel repository.

## Sicurezza e anti-abuso

- **Credenziale.** Solo lato server: GitHub App installata su questo repository
  con il solo permesso *Issues: Read and write*. Il token di installazione è
  richiesto con `permissions: { issues: "write" }` e `repositories:
  [DoveVannoINostriSoldi]`, cache in memoria fino a 60 s prima della scadenza.
  Variabili: `REPORT_GITHUB_APP_ID`, `REPORT_GITHUB_INSTALLATION_ID`,
  `REPORT_GITHUB_APP_PRIVATE_KEY` (PEM, con newline letterali o `\n`).
- **Fail-closed.** Se una variabile manca o non è valida, l'endpoint risponde
  `503 unavailable` con `fallbackUrl` verso il composer GitHub precompilato. È
  una degradazione documentata, non un'implementazione equivalente.
- **Anti-bot.** Honeypot `website`, controllo temporale apertura→invio, rate
  limit per indirizzo (3 ogni 10 minuti) e per istanza (30 ogni 10 minuti).
  L'indirizzo viene ridotto a hash SHA-256 e tenuto solo in memoria. Nessun
  challenge esterno nel primo rilascio: la scelta evita script di terze parti
  e modifiche alla CSP, ma è più debole di un captcha e può essere rivista.
- **Rate limit non durevole.** Il sito non ha uno store condiviso: il limite
  vale per istanza serverless calda. Il limite globale effettivo è quindi
  quello di GitHub più `30 × istanze`. Se l'abuso diventa reale, il passo
  successivo previsto è uno store esterno (per esempio Redis via REST).
- **Idempotenza.** Il server tiene in memoria le ultime chiavi servite e, prima
  di creare, cerca il marker fra le issue con label `segnalazione` create nelle
  ultime 24 h tramite la lista issue (consistente, a differenza della search).
  Retry, doppio click o timeout con la stessa `clientKey` restituiscono la
  issue esistente con `duplicate: true`.
- **Log.** Il contenuto della segnalazione non viene mai loggato; in caso di
  errore GitHub si registra solo la classe dell'errore e lo stato HTTP.
- **Risposte.** Gli errori del provider sono tradotti in messaggi generici; il
  browser verifica che gli URL restituiti puntino a `https://github.com/`.
- **Fuori scope.** Vulnerabilità (rimandate al report privato dal dialog e da
  `/supporto`), allegati, nome/email, modifica di issue esistenti.

## Verifica

```bash
node --experimental-strip-types --test tests/report-contract.test.mjs
node --experimental-strip-types --test tests/report-github.test.mjs
node --experimental-strip-types --test tests/report-route.test.mjs
npm run build && npm start &   # oppure scripts/ci/run-production-gates.sh
npm run test:browser:report
```

La suite Node usa una chiave RSA generata al volo e un `fetch` finto: nessuna
issue reale viene creata. La suite browser intercetta `POST /api/segnalazioni`
per simulare successo ed errore del provider e, nell'ultimo scenario, colpisce
l'endpoint reale senza credenziali verificando il fallback. È inclusa in
`scripts/ci/run-production-gates.sh`.

Verifica manuale prevista: 390, 768 e 1280 px, tastiera (`Tab`, `Enter`,
`Esc`), ritorno del focus al pulsante, console pulita, nessun overflow.

## Attivazione in produzione

1. Creare una GitHub App nell'organizzazione con permesso *Issues: Read and
   write*, nessun webhook, installata solo su `DoveVannoINostriSoldi`.
2. Generare una chiave privata e annotare App ID e Installation ID.
3. Impostare le tre variabili su Vercel (Production e, se utile, Preview).
4. Creare la label `segnalazione` nel repository.
5. Inviare una segnalazione di prova da produzione e verificarne titolo,
   struttura e label; chiuderla come test.
