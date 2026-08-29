# Contribuire a DoveVannoINostriSoldi

Grazie per il contributo. Il progetto tratta dati pubblici che possono essere
facilmente interpretati oltre ciò che la fonte dimostra. Una modifica è pronta
quando sono corretti sia il codice sia il significato pubblicato.

## Prima di scrivere codice

Apri o collega una issue per cambiamenti sostanziali. Per una nuova fonte indica
titolare, URL ufficiale, licenza specifica, formato, geografia, periodo di
riferimento, data di pubblicazione e frequenza di aggiornamento. Spiega anche che
cosa il dato non misura.

Non aprire una issue pubblica per una vulnerabilità non ancora corretta. Segui
[SECURITY.md](SECURITY.md) e usa il report privato.

Non distribuire totali nazionali fra territori senza una geografia pubblicata
dalla fonte. Non trasformare anomalie, differenze contabili o valori elevati in
affermazioni su spreco, frode, efficienza, qualità o responsabilità individuale.

## Ambiente e branch

Usa Node indicato da `.nvmrc` e installa le dipendenze con `npm ci`. Parti
dall'ultimo `origin/main` e mantieni la PR focalizzata. Se la checkout principale
contiene lavoro non tuo, usa un worktree isolato e non resettarla.

## Contratti dati

Ogni snapshot versionato deve avere un adapter fail-closed. Il contratto deve
bloccare almeno schema inatteso, provenienza non ufficiale, licenza o periodo
incoerenti, hash diversi, duplicati, importi non validi e riconciliazioni rotte.
Le date di riferimento, pubblicazione, osservazione e verifica restano campi
distinti.

## Verifica locale

La CI è organizzata in cinque job paralleli (`static`, `security`, `node`,
`etl`, `production`) aggregati da `CI / required`. Il job `security` esegue la
scansione Zizmor dei workflow ed è bloccante, ma non ha un equivalente locale
fra i comandi npm. Puoi riprodurre gli altri gate localmente con i comandi
stabili:

```bash
npm ci
npm run ci:static
npm run test:node
npm run test:etl
npm run test:snapshots
npm run build
git diff --check
```

`ci:static` esegue lint, typecheck, design:check e brand:check insieme.
Se il tuo interprete Python non si chiama `python3`, indicalo con `PYTHON`
(per esempio `PYTHON=python npm run test:node`): i test che attraversano il
confine ETL usano quel nome, il default resta `python3`.
I test browser e Lighthouse richiedono un server `next start` attivo su
`127.0.0.1:3000`; vedi `scripts/ci/run-production-gates.sh` per l'orchestrazione
completa usata dalla CI.

### ETL e artifact verification

```bash
npm run test:etl        # full ETL transformation/reconciliation test suite (295 tests)
npm run test:snapshots  # generated-artifact registry + offline artifact checks
```

`test:etl` esegue l'intera suite di test Python (trasformazione, riconciliazione,
contratti fail-closed) una sola volta.

`test:snapshots` valida il registro degli artifact generati
(`scripts/ci/generated-artifacts.json`), esegue i controlli offline `--check`
unici per ogni artifact, verifica la pulizia del worktree e rileva file
generati non registrati. Non riesegue la suite ETL.

### Limite di trust: PR vs fonti ufficiali

Le pull request validano i dati versionati **offline**: il registro dimostra
che ogni artifact è internamente valido senza contattare fonti esterne.

I workflow pianificati o manuali (`*-refresh.yml`) sono responsabili di
osservare le fonti ufficiali esterne e aggiornare gli snapshot. Il validatore
offline viene usato sia localmente sia nei workflow di refresh, garantendo una
sola implementazione del contratto.

### Network guard

La CI attiva un **application-level network guard** durante la verifica ETL e
artifact. Il guard blocca le connessioni TCP in uscita verso indirizzi non di
loopback. Non è isolamento egress a livello kernel: intercetta i percorsi
applicativi esercitati dalla suite (socket, urllib, http.client, http/https in
Node). Loopback (127.0.0.0/8, ::1) è sempre consentito.

Per attivarlo localmente:

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/ci/validate-generated-artifacts.py --run-checks
```

Una modifica UI richiede anche verifica Browser a 390, 768 e 1280 px, tastiera,
focus, stati di errore/caricamento/vuoto, console e overflow. Una modifica MCP
richiede smoke test sul server HTTP reale e casi negativi. Specifica sempre ciò
che non hai potuto eseguire.

## Licenza dei contributi

Inviando una pull request accetti che il tuo contributo sia incluso nel progetto
sotto GNU Affero GPL v3 (vedi `LICENSE`). Per usi proprietari o commerciali
senza obblighi AGPL vale quanto descritto in `COMMERCIAL.md`.

## Review e merge

La CI verde è necessaria ma non sufficiente. La review valuta separatamente
correttezza, semantica dei dati, accessibilità, sicurezza, performance e
manutenibilità. I thread devono essere risolti con una modifica verificata o con
una motivazione concreta. Non usare force-push sulle branch dei contributor.
