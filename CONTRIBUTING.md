# Contribuire a DoveVannoINostriSoldi

Grazie per il contributo. Il progetto tratta dati pubblici che possono essere
facilmente interpretati oltre ciò che la fonte dimostra. Una modifica è pronta
quando sono corretti sia il codice sia il significato pubblicato.

## Prima di scrivere codice

Apri o collega una issue per cambiamenti sostanziali. La coda di lavoro con
priorità e issue collegate è in [docs/ROADMAP.md](docs/ROADMAP.md). Per una nuova fonte indica
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

Per i test ETL usa Python 3.12 e le stesse dipendenze della CI:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --no-deps --only-binary=:all: --require-hashes -r requirements-etl.txt
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3218
```

Il sito parte dagli snapshot versionati, senza database o credenziali. Alcune
ricerche contattano IPA/OpenBDAP e possono mostrare errori della fonte quando
la rete non è disponibile. Il build scarica Geist da Google Fonts.

Ogni worktree deve avere `node_modules`, `.venv`, `.next` e porta propri.
Non copiare segreti o condividere `.next` tra checkout. Per crearne uno:
`git worktree add -b codex/nome-task /tmp/dvns-nome-task HEAD`, poi esegui
il setup in quella directory. Per la mappa del codice leggi
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contratti dati

Ogni snapshot versionato deve avere un adapter fail-closed. Il contratto deve
bloccare almeno schema inatteso, provenienza non ufficiale, licenza o periodo
incoerenti, hash diversi, duplicati, importi non validi e riconciliazioni rotte.
Le date di riferimento, pubblicazione, osservazione e verifica restano campi
distinti.

Per **nuove fonti tabular** il binario predefinito è il corpus integrato
(headers + celle stringa + evidence + URL + hash), non un JSON ad hoc di pagina.
Prima di scrivere codice segui
[docs/DATA_IMPORT_STANDARD.md](docs/DATA_IMPORT_STANDARD.md): checklist di
import, tre assi obbligatori (soldi, periodo, provenance) e decisione
corpus vs snapshot tipizzato. Gli agenti usano la skill
`.agents/skills/import-dvns-dataset/`.

Una PR che aggiunge dati senza questo schema non è pronta al merge, anche se i
test tecnici passano. Se manca uno dei campi obbligatori o la fonte non espone
un perimetro verificabile, il contributo deve fermarsi a catalogazione, proof o
documentazione del limite invece di inventare valori.

## Verifica locale

La CI è organizzata in cinque job paralleli (`static`, `security`, `node`,
`etl`, `production`) aggregati da `CI / required`. Il job `security` esegue la
scansione Zizmor dei workflow ed è bloccante. Per riprodurla usa Zizmor 1.29.0:
`zizmor --persona auditor .github/workflows/`. Il job static include anche
`actionlint` 1.7.12 e `npm run ci:action-pins`. I gate applicativi sono:

```bash
npm ci
npm run ci:static
npm run test:node
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci npm run test:etl
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci npm run test:snapshots
npm run build
NEXT_PORT=3218 npm run test:production
git diff --check
```

`ci:static` esegue lint, typecheck, design:check e brand:check.
`typecheck` genera i tipi Next anche in una checkout appena installata.
Se il tuo interprete Python non si chiama `python3`, indicalo con `PYTHON`
(per esempio `PYTHON=python npm run test:node`): i test che attraversano il
confine ETL usano quel nome, il default resta `python3`.
`test:production` avvia il server dal build esistente, aspetta la readiness e
lancia smoke/load MCP,
browser core/editoriale/report, CSP e Lighthouse. Rifiuta una porta occupata e
termina il proprio server anche se un gate fallisce. Il log è in
`artifacts/production/next.log`; i fallimenti browser salvano screenshot e
diagnostica in `artifacts/browser/`; Lighthouse scrive in `.lighthouseci/`.
`NEXT_LOG_FILE` permette un percorso alternativo. Per ripetere un solo test
browser avvia `npm start -- --hostname 127.0.0.1 --port 3218` e usa, per esempio,
`DVNS_BASE_URL=http://127.0.0.1:3218 npm run test:browser:core`.

### Feedback rapido

```bash
node --experimental-strip-types --test tests/global-search.test.mjs
node --experimental-strip-types --test --test-name-pattern='deadline' tests/mcp-deadline.test.mjs
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python -m unittest discover -s tests/etl -p 'test_integrated_source_release.py'
```

Scegli i file dal dominio modificato; aggiungi i contratti e le route che lo
consumano. I test Node usano `node:test` e gli ETL `unittest`, senza runner custom.
Le query HTTP simulate sostituiscono l'adapter esterno; la suite produzione
esercita invece il server reale. Un errore `listen EPERM` in un sandbox richiede
loopback consentito, non la rimozione del test o del network guard.

### Misure runtime

`npm run bench:runtime` misura ricerca locale e sito, formattazione e alcuni
percorsi di aggregazione sugli snapshot versionati. Produce JSONL con versione
Node, corpus, query, mediana/min/max per batch e digest dell'output. Import e
caricamento iniziale sono esclusi: tre warmup precedono sette campioni da almeno
150 ms. I tempi sono per batch, non per singola query né per richiesta HTTP.

Esegui baseline e patch in sequenza, con lo stesso Node e corpus e senza build
o suite concorrenti. Confronta anche i digest e ripeti le misure rumorose.
I digest non sostituiscono i test di correttezza. Questi numeri non misurano
latenza delle fonti live, rete, rendering o cold start.

### ETL e artifact verification

```bash
npm run test:etl        # trasformazione, riconciliazione e contratti ETL
npm run test:snapshots  # generated-artifact registry + offline artifact checks
```

`test:etl` esegue l'intera suite di test Python (trasformazione, riconciliazione,
contratti fail-closed) una sola volta. La prova completa del corpus integrato
(`check_committed`) appartiene a `CommittedReleaseProofTests` in
`tests/etl/test_integrated_source_release.py`, insieme agli altri due gate di
release. Il test Node `integrated-curated-datasets` mantiene il controllo
indipendente del ledger; non rilancia la stessa prova Python.

`test:snapshots` valida il registro degli artifact generati
(`scripts/ci/generated-artifacts.json`), controlla che
[docs/SOURCE_SNAPSHOT_INVENTORY.md](docs/SOURCE_SNAPSHOT_INVENTORY.md) sia
allineato al registro, esegue i controlli offline `--check` unici per ogni
artifact, verifica la pulizia del worktree e rileva file generati non
registrati. Non riesegue la suite ETL. Se il registro o un workflow di refresh
cambiano, rigenera l'inventario con
`python3 scripts/ci/source-snapshot-inventory.py --write`.

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

Il merge su `main` è consentito quando il check `required` è verde e i thread
di review sono risolti. GitHub non chiede l'approve di un altro maintainer.
La review umana resta utile su UI ampia, fonti nuove, workflow e sicurezza:
valuta correttezza, semantica dei dati, accessibilità e manutenibilità oltre
ciò che i test coprono. Per le PR dati, la review deve controllare anche
aderenza allo schema comune di import, presenza di `soldi`/`periodo`/`provenance`
e comportamento fail-closed del contratto. Non usare force-push sulle branch dei
contributor.
