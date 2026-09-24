# Parlamento: atti firmati, iter e votazioni finali (XIX legislatura)

Due snapshot tipizzati, uno per ramo, che alimentano la sezione "Voti finali e
proposte di legge" del profilo persona in `/politici` e l'endpoint
`/api/politici/<id>/atti`. Rispondono alla issue #545.

- `src/data/generated/camera-atti-voti-xix.json`: atti di iniziativa
  parlamentare e governativa, iter e votazioni finali con voto nominale.
- `src/data/generated/senato-atti-voti-xix.json`: disegni di legge a prima
  firma senatore o di iniziativa governativa con fase Senato, iter e votazioni
  finali con voto nominale.

Nel profilo persona, la vista iniziale privilegia le votazioni finali quando
esistono voti nominali per il parlamentare. Prima firma e cofirme restano viste
separate. La risposta API espone anche atti e votazioni incluse ed escluse,
così il client non deve dedurre la completezza dal numero di risultati.

## Perché due adapter e perché i rami non si confrontano

Camera e Senato pubblicano i dati con ontologie diverse (`dati.camera.it` usa
OCD, `dati.senato.it` usa OSR) e soprattutto contano in modo diverso: alla
Camera gli astenuti risultano presenti ma non votanti
(`presenti = votanti + astenuti`), al Senato gli astenuti contano fra i votanti
(`votanti = favorevoli + contrari + astenuti`). Anche il perimetro differisce:
alla Camera entrano gli atti di iniziativa parlamentare e governativa con
relazioni ufficiali verificabili; al Senato entrano i disegni presentati al
Senato con primo firmatario senatore e quelli di iniziativa governativa con
almeno una fase Senato.
Confrontare i numeri dei due rami (conteggi e mediane) non ha significato: le
statistiche sono calcolate sempre dentro il roster del proprio ramo.

## Camera

### Fonte e query

Fonte unica: endpoint SPARQL ufficiale `https://dati.camera.it/sparql`
(Open Data Camera, ontologia OCD, licenza CC BY 4.0 dichiarata dal portale).
Cinque risposte, tutte lockate in `provenance.responses` con bytes, righe e
SHA-256 cumulativo:

1. `acts` — atti XIX con `ocd:primo_firmatario`; per l'iniziativa governativa
   acquisisce anche la relazione ufficiale al Governo responsabile quando
   disponibile (SELECT DISTINCT, paginata `LIMIT 5000 OFFSET k`).
2. `coSigners` — `ocd:altro_firmatario` degli stessi atti. La risposta supera il
   limite dell'endpoint sui risultati ordinati (OFFSET + LIMIT ≤ 10.000), quindi
   pagina per chiave: `FILTER(STR(?atto) >= <ultimo atto>)` e dedup delle coppie
   al merge; una pagina piena su un solo atto fallisce chiusa.
3. `iterStates` — `ocd:rif_statoIter` con `dc:title` e `dc:date` (paginata).
4. `finalVotes` — votazioni con etichetta contenente "finale" collegate a un
   atto (paginata).
5. `nominalVotes` — una query per votazione finale collegabile: `?dep ?tipo` per i
   record `ocd:voto` (ThreadPoolExecutor, 4 worker, digest cumulativo).

Ogni risposta con esattamente 10.000 righe fallisce chiusa
(`cap endpoint raggiunto`): è il segno di una possibile troncatura.

### Perimetro

Entrano gli atti di iniziativa parlamentare e governativa. Per i primi il
proponente è il deputato indicato da `deputato.rdf/d<num>_19`; per i secondi il
proponente formale è il Governo, senza trasformare i membri del Governo
elencati nei blank node in autori individuali. Il Governo responsabile resta
un campo distinto e può essere `null` quando la relazione non è esposta.
`coverage.actsByInitiative` riconcilia i due perimetri. Gli atti con numero
suffisso (`ac19_1038-B`, `-bis`, …) restano: `number` è stringa, `baseNumber`
intero per l'ordinamento.

Le votazioni finali osservate si riconciliano sempre come
`finalVotesObserved = finalVotes + finalVotesExcluded`. Restano fuori dal
corpus verificato le votazioni prive di un atto risolvibile e quelle i cui
conteggi nominali non coincidono con i totali ufficiali dichiarati.

### Classi di esito

Gli stati iter ufficiali (`dc:title` dello `ocd:statoIter`) sono mappati in
`outcomeClasses`: `assegnato`, `in-esame`, `approvato-camera-trasmesso`,
`approvato-definitivamente-non-pubblicato`, `legge`, `assorbito`, `ritirato`,
`respinto`, `altro-concluso`. Lo stato corrente è quello con data massima; a
parità di data vince la classe più avanzata in quest'ordine. Uno stato senza
data o non mappato ferma l'import; il validatore richiede anche che ogni
`officialStates` dichiarato torni alla classe giusta.

### Identità verificate (strict, fail-closed)

Sui conteggi ufficiali della Camera gli astenuti sono presenti ma non votanti:

- `favorevoli + contrari == votanti`
- `favorevoli + contrari + astenuti == presenti`
- `approvato == (favorevoli > maggioranza)`
- conteggi nominali: `#F == favorevoli`, `#C == contrari`, `#A == astenuti`

I tipi di voto osservati sono `Favorevole`, `Contrario`, `Astensione`,
`Non ha votato`, `Ha votato` (votazione segreta), codificati `F C A N V`.
Qualsiasi altro valore ferma l'import. Una votazione con relazione incompleta o
conteggi non riconciliati non entra nel corpus pubblicabile e incrementa
`coverage.finalVotesExcluded`; le votazioni incluse rispettano tutte le
identità sopra.

### Cosa non misura

La firma non è paternità del testo finale; i conteggi non misurano
produttività o merito; "Non ha votato" non distingue assenza, missione o
scelta; le votazioni segrete non espongono il voto individuale; una votazione
finale riguarda l'atto nel suo complesso e non ogni singola misura contenuta;
il Senato ha uno snapshot separato con ontologia e regole di conteggio proprie;
nessun importo è presente.

### Verifica e refresh

```bash
# verifica offline dell'artifact committato (network guard obbligatorio)
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python3 scripts/etl/camera_atti_voti_xix_snapshot.py --check

# test ETL offline
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python3 -m unittest discover -s tests/etl -p 'test_camera_atti_voti_xix_snapshot.py'

# refresh dalla fonte (senza guard; aggiorna artifact e lock della spec)
python3 scripts/etl/camera_atti_voti_xix_snapshot.py --write
```

Contratto runtime: `src/lib/data/camera-atti-voti-contract.ts`
(`parseCameraAttiVotiSnapshot`, Zod strict + riconciliazioni). Test Node:
`tests/camera-atti-voti-contract.test.mjs`, `tests/politici-atti-route.test.mjs`.
Spec sorgente: `scripts/etl/specs/camera-atti-voti-xix.source.json`.

## Senato

### Fonte e query

Fonte unica: endpoint SPARQL ufficiale `https://dati.senato.it/sparql`
(Open Data Senato, ontologia OSR, licenza CC BY 3.0 IT, landing
`https://dati.senato.it/`). Il producer usa GET: il POST e alcune forme di
query sono state rifiutate con `403`. Un refresh fallito non sostituisce lo
snapshot validato; il checkpoint locale consente di riprendere le risposte
della stessa giornata UTC senza ripetere i lotti già acquisiti.

Lo snapshot pubblicato è stato acquisito il 23 settembre 2026: 1.872 atti,
222 votazioni finali incluse (166 collegate a iniziative governative), 25
votazioni finali osservate solo su altri atti e 41.545 voti nominali. Un
refresh completo del 24 settembre ha restituito gli stessi conteggi e digest
di fonte, quindi non ha sostituito l'artifact identico. I `403` osservati il
22 settembre e su alcune query il 23 non autorizzano a dichiarare sempre
disponibile l'endpoint: ogni nuovo refresh deve riconciliare dati e provenienza.

Lo storico dei gruppi nello snapshot `politici-senato-xix` è acquisito
separatamente dall'endpoint SPARQL ufficiale: `ocd:aderisce` lega il senatore
all'adesione di legislatura 19 con `osr:inizio` e `osr:fine`; le denominazioni
sono intervalli datati distinti. La fine dell'intervallo Senato è inclusiva,
diversamente dalla Camera. Al 23 settembre l'artifact contiene 288 intervalli
di adesione e 14 denominazioni pertinenti alla legislatura. Il validator
verifica che ciascuno dei 41.545 voti nominali delle 222 finali incluse abbia
esattamente un gruppo e una denominazione alla data del voto. Questo non
equivale a uno storico completo dei mandati o a una misura di presenza al
lavoro; il roster delle persone resta puntuale alla propria data di osservazione.

Sette risposte sono lockate in `provenance.responses` con bytes, righe e
SHA-256 cumulativo:

1. `phases` — nodi `osr:Ddl` XIX con iniziativa a primo firmatario senatore o
   governativa:
   `idDdl`, `idFase`, `fase`, `ramo`, `progressivoIter`,
   `presentatoTrasmesso`, `statoDdl`, `dataStatoDdl`, `dataPresentazione`,
   `natura`, `titolo` (SELECT DISTINCT, paginata `OFFSET 5000`).
2. `signers` — iniziative `osr:Iniziativa` con `osr:senatore` e flag
   `osr:primoFirmatario` opzionale (keyset su `?ddl`, `LIMIT 5000`): il flag è
   presente solo sui primi firmatari, quindi una clausola obbligatoria farebbe
   sparire i cofirmatari.
3. `governmentInitiatives` — tipo `Governativa` e presentatori formali
   `osr:presentatore`; le etichette del Governo si ricavano solo dal suffisso
   ufficiale del presentatore, senza matching dei nomi.
4. `finalVotes` — `osr:Votazione` XIX con etichetta contenente "finale" e
   `osr:oggetto/osr:relativoA` verso un disegno (SELECT DISTINCT; le votazioni
   collegate a più disegni compaiono su più righe).
5. `sessions` — `osr:dataSeduta` e `osr:numeroSeduta` di tutte le sedute XIX;
   le sedute di commissione possono mancare di numero, ma quelle referenziate
   dalle finali lo hanno sempre.
6. `nominalVotes` — query a lotti di 12 votazioni tenute: predicati
   `favorevole`, `contrario`, `astenuto`, `presenteNonVotante`,
   `inCongedoMissione` (4 worker, digest cumulativo).
7. `disegniXix` — COUNT dei disegni XIX con iniziativa, per riconciliare
   gli atti osservati, inclusi ed esclusi.

### Modello a fasi e perimetro

Ogni nodo `osr:Ddl` è una **fase** di un disegno di legge: l'unità dello
snapshot è il disegno (`osr:idDdl`, id `ddl-<id>`), non la fase. Le fasi sono
ordinate per `osr:progressivoIter`; i disegni abbinati compaiono come fasi
fuse (es. `S.93-338-353-B`). Perimetro: disegni presentati al Senato con
primo firmatario senatore, oppure di iniziativa governativa con almeno una
fase Senato. Gli altri disegni sono quantificati in
`coverage.actsExcludedOtherInitiative` o
`coverage.actsExcludedNoEligibleSenatePhase`; le votazioni finali collegate
solo a questi atti sono eventi distinti in
`coverage.finalVotesOnOtherActs`. Un voto collegato a più disegni inclusi
rimane un solo evento. `officialPage` punta alla scheda DDL della prima fase
Senato tramite `idFase`.

### Classi di esito

La classe deriva dalla coppia (`statoDdl`, `ramo`) della fase corrente, con
`officialStates` nel formato `"<stato> @ <ramo>"`:

- `legge`: `appr. definit. Legge` su `S` o `C`
- `approvato-senato-trasmesso`: ultima fase sul ramo `C` diversa da legge,
  oppure ramo `S` con `approvato`, `appr. in t.u.`, `appr. con modificaz`
- `in-esame`: ramo `S` con `esame in comm.`, `in relazione`,
  `concluso l'esame`, `all'esame assemblea`
- `assegnato`: ramo `S` con `assegnato (no esame)`, `da assegn. a commis.`
- `assorbito`: `assorbito`; `ritirato`: `ritirato`; `respinto`: `respinto`
  (non osservato)

Una coppia non mappata ferma l'import; il validatore richiede che lo stato
corrente torni alla classe giusta e che ogni `officialStates` non sia stato
spostato di classe.

### Identità verificate (strict, fail-closed)

Al Senato gli astenuti contano fra i votanti:

- `favorevoli + contrari + astenuti == votanti`
- `presenti >= votanti`
- `approved == (favorevoli > maggioranza)`
- conteggi nominali: `#F == favorevoli`, `#C == contrari`, `#A == astenuti`
- nessun senatore in due liste nominali incompatibili della stessa votazione

Il nominale codifica `F C A P M`: favorevole, contrario, astenuto, presente
non votante, in congedo o missione. Le votazioni `segreta` non espongono il
nominale (`votes` vuoto). La relazione `presenti == votanti + #P` non è
universale (regge solo su una minoranza delle votazioni osservate) e non è
strict.

### Cosa non misura

La firma non è paternità del testo finale; i conteggi non misurano
produttività o merito; "arrivata in fondo" è la classe `legge`; "non
presente" è l'assenza da tutte le liste ufficiali della votazione, senza
indicazione del motivo; le finali sugli atti fuori perimetro restano escluse;
le votazioni segrete non espongono il voto individuale; la Camera ha
uno snapshot separato con ontologia e regole di conteggio proprie; nessun
importo è presente.

### Verifica e refresh

```bash
# verifica offline dell'artifact committato (network guard obbligatorio)
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  .venv/bin/python scripts/etl/senato_atti_voti_xix_snapshot.py --check

# test ETL offline
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  .venv/bin/python -m unittest discover -s tests/etl -p 'test_senato_atti_voti_xix_snapshot.py'

# refresh dalla fonte (senza guard; aggiorna atomicamente solo l'artifact)
# Prima della pubblicazione, revisionare e aggiornare separatamente i lock della spec.
.venv/bin/python scripts/etl/senato_atti_voti_xix_snapshot.py --write --checkpoint .scratch/politici-voti-coerenza/senato-refresh/GIORNO-UTC
```

Contratto runtime: `src/lib/data/senato-atti-voti-contract.ts`
(`parseSenatoAttiVotiSnapshot`, Zod strict + riconciliazioni). Test Node:
`tests/senato-atti-voti-contract.test.mjs`, `tests/politici-atti-route.test.mjs`.
Spec sorgente: `scripts/etl/specs/senato-atti-voti-xix.source.json`.
