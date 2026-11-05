# Corpus DVNS su Supabase

Il progetto scelto è `zvqhikeylxynsljwgosc` (`fps26-preferiresti`, eu-west-1).
Ospita anche servizi estranei a DVNS: gli import scrivono esclusivamente negli
schemi privati `dvns_metadata`, `dvns_corpus` e `dvns_snapshots`. Nessuna modifica al reader del sito,
alla Data API pubblica o alle tabelle degli altri servizi.

## Cosa viene trasferito

- `dvns_metadata.snapshots`: proof completa del rilascio, SHA del codice e hash del catalogo.
- `dvns_metadata.datasets`: tutti i dataset del catalogo, metadata originali e ricevute.
- `dvns_corpus.rows`: proiezioni pubbliche complete, ordinali relativi al dataset e payload JSONB originali. Le celle rimangono stringhe: vuoto, zero, assenza e oscuramento non vengono normalizzati.
- `dvns_metadata.chunks`: checkpoint atomici con hash del chunk compresso e righe.
- `dvns_metadata.imports`: ricevute finali, inserite soltanto dopo rilettura completa e digest riconciliato.

I conteggi sorgente dei dataset `catalog-only` non attestano la presenza dei loro
raw nel repository. Questi dataset sono catalogati ma non diventano righe pubbliche.
Gli snapshot tipizzati esterni al corpus, gli indici derivati ANAC e i file raw
restano fuori da questo importer. Non sommare le loro righe a quelle del corpus:
spesso sono rappresentazioni diverse degli stessi fatti.

## Setup isolato

Usare Python 3.12 e un virtualenv proprio del checkout:

```sh
uv venv --python 3.12 .venv
uv pip sync --python .venv/bin/python --require-hashes supabase/requirements-import.txt
```

La credenziale server è `DVNS_DATABASE_URL` nel file locale passato con
`--env-file`. Il file deve essere escluso da Git; non copiarlo tra worktree.
L'importer legge il valore letteralmente, senza shell expansion. Sono ammessi
soltanto il database `postgres`, l'host del progetto scelto o il suo Session
pooler di eu-west-1 con username del progetto, e TLS `require`/`verify-full`.
La password nella URI deve essere percent-encoded. Nessuna chiave pubblica o
variabile `NEXT_PUBLIC_` è usata.

Per il corpus, applicare soltanto le migrazioni `dvns_corpus_private` e `dvns_import_chunks`
al progetto scelto. **Non eseguire `supabase db push` sull'intera directory**:
le altre migrazioni assistant/boards hanno destinazioni diverse.

## Preflight offline e import

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python -m unittest discover -s tests/etl -p 'test_supabase_corpus_*.py'
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python scripts/etl/supabase_corpus_bulk.py > artifacts/supabase/preflight.jsonl
.venv/bin/python -u scripts/etl/supabase_corpus_import.py --env-file /percorso/privato/.env.local > artifacts/supabase/import-all.jsonl 2>&1
```

Per un dataset usare `--dataset ID`; ripetere il comando riprende dai checkpoint.
`--batch-chunks` accetta 1–25 chunk. Il lock di sessione impedisce due importer
DVNS contemporanei. Ogni batch usa COPY FROM STDIN in una tabella temporanea,
poi inserisce righe, confronta i payload e salva i checkpoint nella stessa
transazione. I dati divergenti non vengono sovrascritti. Gli errori interrompono
l'esecuzione e non generano una ricevuta di successo; il comando può essere
rilanciato dopo la diagnosi. Nessun refresh delle fonti è avviato.

La verifica finale rilegge tutte le righe ordinate tramite cursore server con
memoria limitata, ricostruisce il JSON canonico e confronta SHA-256 e cardinalità
con la ricevuta sorgente. Si esegue anche sui dataset già importati: un checkpoint
non sostituisce la prova dei contenuti persistiti.

## Prova di ripresa ed errori

Per verificare un'interruzione controllata su una prima importazione:

```sh
.venv/bin/python scripts/etl/supabase_corpus_import.py --env-file /percorso/privato/.env.local --dataset affitti-immobili --batch-chunks 1 --max-batches 1
.venv/bin/python scripts/etl/supabase_corpus_import.py --env-file /percorso/privato/.env.local --dataset affitti-immobili
```

La prima esecuzione termina con codice 3 dopo il commit del blocco; la seconda
non duplica le righe e completa la ricevuta dopo il confronto del digest.
Su un dataset già completo la prima esecuzione può terminare normalmente senza
nuovi blocchi: il caso va riprodotto su una destinazione di test fresca.

La prova live del 3 novembre 2026 ha anche alterato una cella soltanto dentro una
transazione di test: la rilettura ha rifiutato il digest e il rollback ha
ripristinato il payload originale. Comando e log sono negli artifact locali
`artifacts/supabase/negative-readback.py` e `.log`, senza credenziali.

## Consultazione e confini

```sql
select id, title, domain, publication, expected_public_rows
from dvns_metadata.datasets order by domain, id;
select dataset_id, verified_rows, rows_sha256, verified_at
from dvns_metadata.imports order by dataset_id;
select ordinal, payload->'cells' as cells
from dvns_corpus.rows
where snapshot_id = '<snapshot_id>' and dataset_id = '<dataset_id>'
order by ordinal limit 50;
```

Specificare sempre snapshot e dataset nelle query sulle righe. La chiave primaria
supporta questo accesso; non sono creati indici GIN indiscriminati sui payload.
Non ci sono grant anon/authenticated o policy pubbliche. Il reader applicativo,
le tabelle di dominio, il backup indipendente e la prova di restore costituiscono
fasi successive: questo import non ne dimostra il completamento.

## Documenti degli altri snapshot

`supabase_snapshot_documents.py` censisce tutti i file delle radici generate e
trasferisce i documenti `.json` in `dvns_snapshots.documents`, con path, gruppi,
SHA codice e hash dei byte in `dvns_snapshots.files`. I numeri passano come testo
JSON originale e la rilettura usa Decimal: nessun passaggio da float. Le righe
del corpus e i documenti sono rappresentazioni separate e non vanno sommati.

Applicare anche la sola migrazione `dvns_snapshot_documents`. Preflight offline:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python scripts/etl/supabase_snapshot_documents.py --code-sha SHA_DEL_CODICE
.venv/bin/python scripts/etl/supabase_snapshot_documents.py --code-sha SHA_DEL_CODICE --env-file /percorso/privato/.env.local
```

I file con disposition `manifest-only` sono solo inventariati: pack e archivi
compressi derivati non sono copiati nel database da questo comando. La presenza
nell'inventario non equivale alla disponibilità dei relativi byte su Supabase.
Prima di un nuovo import verificare capacità e stato dei servizi condivisi.
Il batch corpus predefinito è 5 chunk; 25 resta il massimo esplicito. Dopo un
DiskFull durante un batch da 25, il pannello riportava solo 23% di disco usato;
la ripresa con 5 ha consentito di proseguire senza cambiare risorse.

## Archivio dei byte originali su Storage

Il bucket `dvns-snapshots` è privato. La sola chiave server per Storage è nel file
locale separato passato con `--storage-env-file`; non è una chiave client.
Applicare anche la migrazione `dvns_storage_blobs`.

Il comando raccomandato raggruppa i file non ancora archiviati in oggetti di
massimo 4 MiB, evitando una richiesta per ciascun piccolo file:

```sh
.venv/bin/python -u scripts/etl/supabase_pack_archive.py --env-file /percorso/privato/.env.local --storage-env-file /percorso/privato/.env.storage.local
```

`dvns_snapshots.blobs` collega l'hash del file originale a parti ordinate con
chiave, offset, byte e hash del segmento. Le ricevute precedenti, senza offset,
indicano oggetti singoli con offset zero. Ogni oggetto è caricato senza upsert,
poi scaricato e verificato prima di registrare i file che contiene. Dopo l'upload
il comando ricostruisce TUTTI i file da Storage, con cache di un solo oggetto
(4 MiB), confrontando hash e dimensione con l'inventario locale. La modalità
`--verify-only` ripete soltanto questa prova di recupero.

Il client riusa una connessione TLS per worker, rifiuta redirect e limita i retry.
Il caricamento per singolo file rimane disponibile in
`supabase_snapshot_storage.py --path PERCORSO --workers 1` per prove mirate.
Non usare molti worker sul progetto Nano: l'API ha restituito 429 per limite
connessioni. Non si modificano le policy per aggirare il limite.

L'archivio dei byte e la materializzazione delle righe SQL sono stati distinti:
una riga in files è un inventario, una riga in blobs attesta l'archiviazione
verificata, una riga in imports attesta la rilettura completa del dataset SQL.
Dopo la pulizia per spazio esaurito, imports era vuota. La nuova esecuzione del
4 novembre, successiva al resize, ha materializzato e verificato integralmente
113 dataset / 8.047.880 righe; il catalogo contiene 135 voci, comprese quelle
che non distribuiscono righe pubbliche.

## Budget e ripresa del corpus

Il limite predefinito del corpus è ora 2 GiB di pg_database_size e il codice
rifiuta progetti in sola lettura. Questo limite non misura il WAL: prima di
alzarlo controllare disco allocato, WAL, temporanei e carichi condivisi. Su 8 GB
il bulk ha fatto intervenire la protezione della piattaforma e le righe sono
state ripulite, mantenendo catalogo e artifact. Non ripetere il bulk completo
sulla stessa capacità e non forzare globalmente la modalità scrivibile.

L'utente ha autorizzato soltanto il target di 24 GB gp3, circa 2 USD/mese di
solo disco aggiuntivo oltre agli 8 GB inclusi. Nessun cambio compute/piano.
Al 3 novembre, dopo l'autoscaling della piattaforma il disco risultava 12 GB
con nuovo cooldown. Il 4 novembre, terminato il cooldown, è stato applicato e
verificato il target di 24 GB; Nano è rimasto invariato.
Dopo verifica effettiva di 24 GB e modalità scrivibile, un budget conservativo
iniziale per la sola dimensione DB è 12 GiB:

```sh
.venv/bin/python -u scripts/etl/supabase_corpus_import.py --env-file /percorso/privato/.env.local --batch-chunks 5 --max-database-bytes 12884901888
```

Il comando è terminato con successo il 4 novembre: 113 ricevute e 8.047.880
righe rilette integralmente con digest esatti; 8.119 checkpoint riconciliati.
Verifica finale in `artifacts/supabase/verification-after-resize.json`, log
`import-after-resize.jsonl`, comando di verifica `verify-after-resize.py`.
DB finale circa 8,82 GB, scrivibile; Infrastructure circa 10,94 GB occupati su
24 GB inclusi WAL e sistema. Documenti 595, file archiviati 10.022, zero mancanti.
I reader del sito e le API pubbliche restano quelli precedenti.

## Sito locale con lettura PostgreSQL

`npm run dev:supabase -- --hostname 127.0.0.1 --port 43174` abilita
`DVNS_DATA_BACKEND=supabase` soltanto per quel processo. Richiede
`DVNS_DATABASE_URL` nel file `.env.local` ignorato da Git. Da un worktree usare
`DVNS_ENV_FILE=/percorso/del/checkout/originale/.env.local`, senza copiare segreti.
`npm run dev` conserva il backend filesystem; non è stato cambiato il deploy.

Le righe del corpus (113 dataset, `/dati`, `/api/dati` e tutti i selector che
passano da `integrated-sources`) arrivano da `dvns_corpus.rows`. Catalogo e prove
di rilascio sono fissati al pin verificato. Gli snapshot tematici hanno lettori
separati che usano la cache di release Supabase descritta sotto.

Il reader usa due connessioni al massimo, transazioni READ ONLY, timeout SQL
10 s e deadline 15 s; nessun grant pubblico e nessuna scrittura. Ogni chunk
legge al massimo 1.000 righe tramite PK (snapshot, dataset, ordinale numerico),
oltre a una query della ricevuta verificata. Conserva limiti di scansione,
cursori e filtri del selector pubblico. Non aggiunge cache di risultati o
prefetch; non legge tutti gli 8 milioni di record per una visita. Le chiavi
rimangono server-only. Il reader confronta lo SHA-256 del JSON canonico
delle righe con il digest dei byte decompressi nel manifest versionato
`src/data/supabase-chunk-digests.json`. La chiave del manifest è l'hash
del gzip già vincolato dalla prova di rilascio. Il generatore
`python3 scripts/etl/supabase_chunk_digests.py` verifica la prova e gli
hash dei gzip prima di decomprimerli. Usare `--check` per verificare il
manifest senza riscriverlo. Una prova mancante o righe divergenti producono
un errore di lettura.

La modalità locale usa la credenziale server già configurata, con transazioni
esplicitamente read-only: il Session pooler non applica necessariamente le
opzioni di sessione inviate nello startup packet. Un eventuale deploy richiede
un riesame separato di ruolo SQL dedicato, capacità e budget di richieste.

### Snapshot tematici e cache locale di release

`dev:supabase` ora prepara anche tutti gli artifact registrati prima di avviare
Next. Richiede il virtualenv Python 3.12 con `supabase/requirements-import.txt`
e il file Storage originale `.env.storage.local` accanto alla env SQL; per un
percorso diverso usare `DVNS_STORAGE_ENV_FILE`. Le credenziali non sono copiate
nella directory runtime; la chiave Storage viene letta solo dal restore Python.

La revisione dati è fissata in `supabase/runtime-release.json`: SHA del registro
e dell'inventario completo. Il nuovo codice di main può usare quel rilascio se
il registro dei dati è invariato; un nuovo rilascio richiede import e pin
verificati, non la selezione automatica dell'ultimo record nel DB.

- Corpus: query SQL dirette, come sopra. Gli 8.119 chunk Git non sono copiati
  nella cache runtime.
- Snapshot/indici: manifest e 595 documenti da PostgreSQL, byte originali dal
  bucket privato Supabase. Sono ricostruiti 1.903 file (595 JSON e 1.308 archivi/
  indici), confrontando hash e byte dell'inventario fissato e valori JSON con
  Decimal. La copia byte-esatta conserva gli hash attesi dagli adapter.
- Cache su disco in `artifacts/supabase-runtime/release-<inventory_sha256>`:
  ogni avvio rilegge il DB e verifica i file, riparando byte locali divergenti
  solo da oggetti cloud verificati. Manifest, documento, segmento o oggetto
  mancante/divergente bloccano l'avvio. Nessun fallback ai generated del repo.
- Next parte in una vista runtime separata `site-<run>`, con copie del codice
  aggiornato e collegamenti alle due radici ripristinate (`src/data/generated`,
  `data/source-ledger`). Ha una `.next` propria; il lock impedisce due avvii
  di questa modalità nello stesso checkout. Riavviare `dev:supabase` dopo
  modifiche al codice per ricreare la vista aggiornata.

È una lettura da cache di snapshot immutabili, non una SELECT per ogni grafico:
non trasforma in query di rete i lettori sincroni o gli import JSON. La cache
viene validata prima di aprire il server. SQL resta read-only e viene chiuso
prima dei download; i trasferimenti sono seriali, con una cache oggetto di
4 MiB. JSONB è confrontato con i byte ripristinati senza conversioni float.

Fonti live (IPA/OpenBDAP), specifiche e configurazione editoriale, stemmi e
asset statici pubblicati (compresa la nuova mappa GTFS di main) conservano il
loro percorso: non sono artifact tabellari del registro da convertire in query
SQL. Non sono state cambiate route pubbliche, policy, tabelle o dati cloud.
La modalità normale `npm run dev` continua a funzionare offline con Git.
