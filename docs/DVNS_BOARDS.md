# DVNS Boards - laboratorio cittadino sui dati pubblici

Studio di sistema (ottobre 2026). Anteprima locale su `/accedi` + `/dashboard`
(shell immersiva senza menu/header del sito, come politici/comuni). Questo
documento fissa decisioni, infrastruttura, contratto delle ricette, privacy e
fasi di implementazione.

## Decisioni di prodotto

- **Account reali** (magic link email, senza password), sync multi-device.
- **Solo serie pubbliche** già esposte da DVNS (catalogo MCP / snapshot /
  corpus). Niente upload CSV dell’utente mescolati ai dati ufficiali.
- **Feedback dati**: canale per chiedere nuove serie; una richiesta non
  autorizza valori inventati ([DATA_IMPORT_STANDARD.md](DATA_IMPORT_STANDARD.md)).
- Positioning: laboratorio su dati ufficiali verificati, **non** Power BI
  generico né ranking di spreco ([LEGAL_AND_ETHICS.md](LEGAL_AND_ETHICS.md)).

## Verifica infrastruttura (2026-10-12)

### Quota assistente (esistente, da non riusare per Auth)

| Elemento | Esito |
|---|---|
| Codice | `src/lib/assistant/free-quota.ts` chiama RPC PostgREST con `service_role`; niente `@supabase/supabase-js` |
| Migrazioni | `supabase/migrations/20260912124653_assistant_free_quota.sql` (+ retention cron) |
| Schema | `assistant_private.quota` - RLS, nessun grant ad `anon`/`authenticated`; Auth/Storage/Realtime **non** attivati per design ([ASSISTENTE.md](ASSISTENTE.md)) |
| Env Vercel (progetto `dove-vanno-i-nostri-soldi`) | Presenti in **production**: `ASSISTANT_SUPABASE_URL`, `ASSISTANT_SUPABASE_SECRET_KEY`, `ASSISTANT_QUOTA_SECRET`, `REGOLO_API_KEY` |
| Regola | Progetto dedicato alla sola quota; **non** abilitare Auth sullo stesso progetto né mischiare PII account con contatori HMAC |

### Resend (segreto già su Vercel, codice assente)

| Elemento | Esito |
|---|---|
| Env Vercel | Presenti in production: `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (anche `LEAD_INBOX_EMAIL`) |
| Uso nel repository | **Nessun** riferimento in TS/MD al 2026-10-12: i segreti non sono ancora collegati a un flusso Auth |
| Piano | Usare Resend come SMTP custom di **Supabase Auth** sul progetto Boards (nuovo), oppure invio magic link via route server con Resend; non toccare le env della quota |

### Progetto Supabase Boards (da provisioning)

Checklist operativa prima della prima PR Auth:

1. Creare un **secondo** progetto Supabase (nome suggerito: `dvns-boards`), distinto dal ref in `ASSISTANT_SUPABASE_URL`.
2. Attivare **Auth** → Email → magic link / OTP; disattivare signup senza email se non serve password.
3. Collegare SMTP Resend (host Resend, API key da `RESEND_*` o chiave dedicata Boards).
4. Verificare dominio mittente (`RESEND_FROM_EMAIL`) su Resend e redirect URL `https://www.dovevannoinostrisoldi.com/auth/callback` (+ preview Vercel se serve).
5. Non abilitare Storage/Realtime finché non servono; niente dati di fatto nelle tabelle utente.
6. Aggiungere su Vercel (production + preview) variabili **nuove**, mai riusare i nomi `ASSISTANT_*`:
   - `BOARDS_SUPABASE_URL`
   - `BOARDS_SUPABASE_ANON_KEY` (solo se cookie SSR richiede publishable lato server con RLS)
   - `BOARDS_SUPABASE_SECRET_KEY` (service role, solo server, per admin/export)
   - riuso di `RESEND_API_KEY` / `RESEND_FROM_EMAIL` (API key condivisa; From Boards
     diventa `DVNS Boards <boards@stesso-dominio>` oppure override `BOARDS_RESEND_FROM_EMAIL`)

## Modello dati applicativo

Postgres salva **ricette**, non fatti. Ogni apertura ricalcola i numeri dal
layer pubblico (MCP / adapter tipizzati).

### Tabelle previste (schema `boards_private` o `public` + RLS)

| Tabella | Ruolo |
|---|---|
| `profiles` | `user_id` → `auth.users`, timestamp consenso privacy, `display_name` opzionale |
| `boards` | owner, titolo, `document` JSONB (`BoardDocument`), timestamps |
| `data_requests` | feedback «manca questa serie»: testo, dataset correlato opzionale, stato triage |

RLS: owner-only su `boards` e `profiles`. Share unlisted = token o
`visibility = unlisted` in sola lettura, senza esporre email.

### Contratto `BoardDocument`

Implementazione fail-closed in
[`src/lib/data/boards-document.ts`](../src/lib/data/boards-document.ts).
Versione corrente: `schemaVersion: 1`.

Campi essenziali:

- `schemaVersion` (intero positivo)
- `title` (stringa non vuota)
- `layout` (`grid` v1)
- `tiles[]`: ogni tile ha `id`, `datasetId` (ID catalogo MCP attivo),
  `view` ∈ `kpi | table | line | bar`, `filters` (solo chiavi ammesse dal
  catalogo del dataset), `title` opzionale

Invarianti:

- filtri sconosciuti → rifiuto;
- dataset assente dal catalogo attivo → rifiuto;
- nessuna somma o join cross-fonte nella ricetta;
- caveat e provenance arrivano a runtime dalla query, non dalla ricetta.

### Tile catalog (catalogo MCP attivo)

Il composer espone **tutti** i dataset in `ACTIVE_DATASET_IDS` (oltre 100).
Dodici id restano “in evidenza” (`BOARD_TILE_FEATURED_IDS`) solo per l’ordine
in sidebar. Elementi non-dato ammessi: `note`, `link`, `image` (URL HTTPS).

Proiezioni grafiche dedicate: debito, SIOPE comuni, SSN storico. Gli altri
dataset usano una proiezione euristica fail-soft (serie/KPI se riconoscibili).

Ogni tile in UI deve mostrare fonte, periodo e caveat del dataset. Vietato
etichettare differenze come «spreco».

## Privacy e Auth (spec)

### Dati trattati

| Dato | Base | Retention |
|---|---|---|
| Email (Auth) | Contratto + consenso all’accesso alle board | Fino a cancellazione account |
| Board / tile ricette | Esecuzione servizio | Fino a delete board o account |
| `data_requests` | Consenso esplicito al feedback | Fino a chiusura triage o erase |
| IP / log hosting | Sicurezza (Vercel) | Policy host |
| Quota assistente HMAC | Separata, senza account | Giornaliera (vedi ASSISTENTE.md) |

### Flusso magic link (senza password)

1. Utente apre `/accedi` (login e registrazione sono lo stesso percorso).
2. Inserisce email + consenso.
3. Server (cloud): `admin/generate_link` (service role) + invio email **diretto via Resend**
   (`RESEND_API_KEY` + `RESEND_FROM_EMAIL`). Il mittente è sempre
   `DVNS Boards <boards@dominio>` (stesso dominio di `RESEND_FROM_EMAIL`, non
   `consulenza@`), oppure `BOARDS_RESEND_FROM_EMAIL` se impostato. **Non** usa i
   template Supabase Auth (restano inaffidabili se qualcuno mette `{{ .Token }}`
   al posto del link).
4. Click sul link → verify GoTrue → redirect `/accedi/callback` → cookie httpOnly → `/dashboard`.
5. Anteprima locale (senza Supabase): codice a sei cifre in pagina.
6. Logout invalida la sessione. Elimina account da `/dashboard/settings` (conferma `ELIMINA`) cancella utente Auth + ricette + share.

Env locali minime per cloud: `BOARDS_*` + `RESEND_API_KEY` + `RESEND_FROM_EMAIL`
(opzionale `BOARDS_RESEND_FROM_EMAIL`).

### Template email Supabase (incolla così)

Il subject di default **Your sign-in link** è il template **Magic Link**.
Se nel body c'è solo `{{ .Token }}`, Gmail mostra un codice (es. `81994728`) e
**non** un link: non è un bug dell'app, è il template.

Dashboard progetto Boards → **Authentication → Emails → Templates** → apri
**Magic Link** (e anche **Confirm sign up**).

**URL Configuration** (obbligatorio):

- Site URL (dev): `http://127.0.0.1:3055`
- Redirect URLs: `http://127.0.0.1:3055/**` e `http://127.0.0.1:3055/accedi/callback`

Poi: **cancella tutto il body**, incolla sotto, **Save**, richiedi una **nuova** email
(quelle vecchie restano col codice).

#### Magic Link — Subject

```text
Accedi a DVNS Boards
```

#### Magic Link — Body (link diretto alla nostra callback)

```html
<h2>DVNS Boards</h2>
<p>Ciao,</p>
<p>Hai chiesto di accedere a DVNS Boards. Clicca il link (nessuna password, nessun codice da copiare).</p>
<p>
  <a href="{{ .SiteURL }}/accedi/callback?token_hash={{ .TokenHash }}&type=email">Accedi a DVNS Boards</a>
</p>
<p>Se non hai richiesto tu l'accesso, ignora questa email.</p>
<p>Il link scade in poco tempo. Vale solo per {{ .Email }}.</p>
```

#### Confirm sign up — Subject

```text
Conferma email · DVNS Boards
```

#### Confirm sign up — Body

```html
<h2>DVNS Boards</h2>
<p>Ciao,</p>
<p>Conferma l'email per creare il tuo accesso a DVNS Boards (nessuna password).</p>
<p>
  <a href="{{ .SiteURL }}/accedi/callback?token_hash={{ .TokenHash }}&type=signup">Conferma e accedi</a>
</p>
<p>Se non hai richiesto tu la registrazione, ignora questa email.</p>
<p>Il link vale solo per {{ .Email }}.</p>
```

Vietato: body con solo `Il tuo codice … {{ .Token }}` senza un `<a href=…>`.
Alternativa ufficiale Supabase: `{{ .ConfirmationURL }}` al posto del link sopra.

### Diritti

- Export: JSON delle proprie board (`BoardDocument[]`).
- Cancellazione: endpoint autenticato + conferma; niente soft-delete infinito senza base legale.
- Aggiornare [`src/app/privacy/page.tsx`](../src/app/privacy/page.tsx) prima del go-live Auth.
- Assistente: resta senza account obbligatorio; BYOK e quota HMAC **non** migrano nelle board.

## Feedback dati mancanti

Distinto da [`/api/segnalazioni`](../src/app/api/segnalazioni/route.ts) (bug → GitHub Issues).

Stati: `received` → `triaged` → `wont` | `roadmap` | `shipped` (con link issue).
Triage maintainer; nessuna promessa automatica di import.

## Stato v1 (ottobre 2026)

Target: giornalisti, enti di ricerca, centri studi. Anteprima locale resta
`local_preview` (OTP in pagina + `localStorage`). Cloud si attiva quando
`BOARDS_AUTH_SECRET` + `BOARDS_SUPABASE_*` sono valorizzati.

| Capacità | Stato |
|---|---|
| Home multi-board + categorie | Fatto (`/dashboard`) |
| Composer free-canvas + catalogo MCP | Fatto (`/dashboard/b/[id]`) |
| Auth OTP locale | Fatto |
| Auth OTP Supabase (+ profilo) | Fatto (env `BOARDS_*` + Resend) |
| Sync board Postgres (`boards_private`) | Fatto |
| Share unlisted sola lettura | Fatto (`/condividi/[token]`) |
| Export JSON ricetta + CSV tile | Fatto in UI |
| Provenance `readAt` su tile | Fatto nel payload serie |
| Filtri umani (anno/regione/etichette) | Fatto (base) |
| Data-requests | Feedback via Resend; tabella triage non ancora |
| Delete account / privacy page update | Fatto (`/dashboard/settings` + `/privacy`) |
| Proiezioni dedicate oltre debito/SIOPE/SSN | Euristica ampliata (catalogo quasi completo) |

### Provisioning cloud (checklist)

1. Creare progetto Supabase `dvns-boards` (distinto da ASSISTANT_*).
2. Applicare `supabase/migrations/20261012140000_boards_private.sql`.
3. Esporre lo schema `boards_private` in PostgREST (API → Exposed schemas).
4. Auth Email OTP + SMTP Resend.
5. Env Vercel: `BOARDS_AUTH_SECRET`, `BOARDS_SUPABASE_URL`, `BOARDS_SUPABASE_ANON_KEY`, `BOARDS_SUPABASE_SECRET_KEY` (+ Resend).

## Fasi residue

1. Ship PR + env `BOARDS_*` su Vercel + redeploy unico.
2. Smoke preview (magic link → settings delete → share).
3. Soft launch (link nav/home).
4. Data-requests strutturati (opzionale; feedback email già attivo).

Fuori scope v1: SQL libero, upload utente, join automatici, giudizi AI di spreco, billing.

## Riferimenti codice esistenti

- Catalogo e filtri: `src/lib/mcp/catalog.ts`, `query-schema.ts`, `datasets.ts`
- HTTP corpus: `/api/dati/[dataset]`
- Confronto serie ufficiale: `/esplora/serie`
- Quota (non riusare): `src/lib/assistant/free-quota.ts`, `docs/ASSISTENTE.md`
