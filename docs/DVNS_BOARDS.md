# DVNS Boards - laboratorio cittadino sui dati pubblici

Studio di sistema (ottobre 2026). Nessuna UI di board è ancora in produzione.
Questo documento fissa decisioni, verifica infrastruttura, contratto delle
ricette, privacy e fasi di implementazione.

## Decisioni di prodotto

- **Account reali** (magic link email), sync multi-device.
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
   - riuso di `RESEND_API_KEY` / `RESEND_FROM_EMAIL` se il mittente è lo stesso

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

### Tile catalog v1 (candidati MCP)

Selezione iniziale (filtri semplici, serie già pubbliche). Espandere solo dopo
che Auth + CRUD board sono stabili.

| datasetId | Filtri tipici tile | Vista suggerita |
|---|---|---|
| `debito_pubblico_italiano` | (nessuno) | kpi, line |
| `siope_comuni` | year, region | kpi, bar |
| `siope_entrate_comuni` | year, region | kpi, bar |
| `openbdap_spesa_stato` | year, month | line, kpi |
| `openbdap_ssn_storico_nazionale` | (nessuno) | line |
| `opencivitas_fabbisogni` | year, region | table, bar |
| `consulenti_incarichi` | year | kpi, line |
| `inps_pensioni_vigenti` | (nessuno) | kpi |
| `inps_invalidita_civile` | year, region | bar, table |
| `eurostat_cofog` | country, year, cofog | line, bar |
| `istat_cofog` | territory, year, cofog | line, bar |
| `cpt_finanza_regionale` | year, region | table, bar |

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

### Flusso magic link

1. Utente inserisce email su `/accedi`.
2. Server richiede OTP/magic link a Supabase Auth (SMTP Resend).
3. Click → `/auth/callback` scambia codice per sessione cookie httpOnly (`@supabase/ssr`).
4. Area `/mio` richiede sessione; senza sessione redirect a `/accedi`.
5. Logout invalida sessione; «Elimina account» cancella `auth.users` + righe RLS cascata e conferma.

### Diritti

- Export: JSON delle proprie board (`BoardDocument[]`).
- Cancellazione: endpoint autenticato + conferma; niente soft-delete infinito senza base legale.
- Aggiornare [`src/app/privacy/page.tsx`](../src/app/privacy/page.tsx) prima del go-live Auth.
- Assistente: resta senza account obbligatorio; BYOK e quota HMAC **non** migrano nelle board.

## Feedback dati mancanti

Distinto da [`/api/segnalazioni`](../src/app/api/segnalazioni/route.ts) (bug → GitHub Issues).

Stati: `received` → `triaged` → `wont` | `roadmap` | `shipped` (con link issue).
Triage maintainer; nessuna promessa automatica di import.

## Fasi di implementazione

1. **Auth skeleton** - progetto Boards, Resend SMTP, `/accedi`, callback, privacy, delete.
2. **Board CRUD** - crea/rinomina/elimina, lista `/mio`, persistenza RLS.
3. **Tile catalog v1** - composer sulle 12 serie sopra; `POST /api/boards/query` con rate-limit per `user_id`.
4. **Share unlisted** - link sola lettura.
5. **Data-requests** - form + triage.
6. **Espansione catalogo** - altri dataset MCP con filtri stabili.

Fuori scope v1: SQL libero, upload utente, join automatici, giudizi AI di spreco, billing.

## Riferimenti codice esistenti

- Catalogo e filtri: `src/lib/mcp/catalog.ts`, `query-schema.ts`, `datasets.ts`
- HTTP corpus: `/api/dati/[dataset]`
- Confronto serie ufficiale: `/esplora/serie`
- Quota (non riusare): `src/lib/assistant/free-quota.ts`, `docs/ASSISTENTE.md`
