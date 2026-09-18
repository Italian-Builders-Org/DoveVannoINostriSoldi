# Parlamento: atti firmati, iter e votazioni finali (XIX legislatura)

Due snapshot tipizzati, uno per ramo, che alimentano la sezione "Proposte di
legge" del profilo persona in `/politici` e l'endpoint
`/api/politici/<id>/atti`. Rispondono alla issue #545.

- `src/data/generated/camera-atti-voti-xix.json`: proposte di iniziativa
  parlamentare firmate dai deputati, iter e votazioni finali con voto nominale.
- `src/data/generated/senato-atti-voti-xix.json`: disegni di legge a prima
  firma senatore, fasi dell'iter e votazioni finali con voto nominale.

## Perché due adapter e perché i rami non si confrontano

Camera e Senato pubblicano i dati con ontologie diverse (`dati.camera.it` usa
OCD, `dati.senato.it` usa OSR) e soprattutto contano in modo diverso: alla
Camera gli astenuti risultano presenti ma non votanti
(`presenti = votanti + astenuti`), al Senato gli astenuti contano fra i votanti
(`votanti = favorevoli + contrari + astenuti`). Anche il perimetro differisce:
alla Camera entrano gli atti a prima firma deputato, al Senato i disegni la cui
fase iniziale è "presentato" al ramo Senato con primo firmatario senatore.
Confrontare i numeri dei due rami (conteggi, mediane, percentili) non ha
significato: statistiche e percentile sono calcolati sempre dentro il roster
del proprio ramo.

## Camera

### Fonte e query

Fonte unica: endpoint SPARQL ufficiale `https://dati.camera.it/sparql`
(Open Data Camera, ontologia OCD, licenza CC BY 4.0 dichiarata dal portale).
Cinque risposte, tutte lockate in `provenance.responses` con bytes, righe e
SHA-256 cumulativo:

1. `acts` — atti XIX con `ocd:primo_firmatario` (SELECT DISTINCT, paginata
   `LIMIT 5000 OFFSET k`).
2. `coSigners` — `ocd:altro_firmatario` degli stessi atti. La risposta supera il
   limite dell'endpoint sui risultati ordinati (OFFSET + LIMIT ≤ 10.000), quindi
   pagina per chiave: `FILTER(STR(?atto) >= <ultimo atto>)` e dedup delle coppie
   al merge; una pagina piena su un solo atto fallisce chiusa.
3. `iterStates` — `ocd:rif_statoIter` con `dc:title` e `dc:date` (paginata).
4. `finalVotes` — votazioni con etichetta contenente "finale" collegate a un
   atto (paginata).
5. `nominalVotes` — una query per votazione finale tenuta: `?dep ?tipo` per i
   record `ocd:voto` (ThreadPoolExecutor, 4 worker, digest cumulativo).

Ogni risposta con esattamente 10.000 righe fallisce chiusa
(`cap endpoint raggiunto`): è il segno di una possibile troncatura.

### Perimetro

Entrano solo gli atti il cui primo firmatario è un deputato XIX
(`deputato.rdf/d<num>_19`): 2.585 atti. I 337 disegni di legge a prima firma di
un membro del Governo (blank node con `ocd:rif_membroGoverno`) sono esclusi e
conteggiati in `coverage.actsWithGovernmentFirstSigner`; le loro votazioni
finali sono conteggiate in `coverage.finalVotesOnOtherActs` e non incluse. Gli
atti con numero suffisso (`ac19_1038-B`, `-bis`, …) restano: `number` è stringa,
`baseNumber` intero per l'ordinamento.

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
Qualsiasi altro valore ferma l'import.

### Cosa non misura

La firma non è paternità del testo finale; i conteggi non misurano
produttività o merito; "Non ha votato" non distingue assenza, missione o
scelta; le votazioni segrete non espongono il voto individuale; le finali su
disegni di legge governativi sono fuori perimetro; il Senato ha uno snapshot
separato con ontologia e regole di conteggio proprie; nessun importo è
presente.

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
`https://dati.senato.it/`). L'endpoint accetta solo richieste GET (il POST è
rifiutato con 403) e il WAF rifiuta query con `BIND`/`IF`; i literal sono
tipizzati, quindi i filtri confrontano `STR(?x)`. Sei risposte lockate in
`provenance.responses` con bytes, righe e SHA-256 cumulativo:

1. `phases` — nodi `osr:Ddl` XIX con iniziativa a primo firmatario senatore:
   `idDdl`, `idFase`, `fase`, `ramo`, `progressivoIter`,
   `presentatoTrasmesso`, `statoDdl`, `dataStatoDdl`, `dataPresentazione`,
   `natura`, `titolo` (SELECT DISTINCT, paginata `OFFSET 5000`).
2. `signers` — iniziative `osr:Iniziativa` con `osr:senatore` e flag
   `osr:primoFirmatario` opzionale (keyset su `?ddl`, `LIMIT 5000`): il flag è
   presente solo sui primi firmatari, quindi una clausola obbligatoria farebbe
   sparire i cofirmatari.
3. `finalVotes` — `osr:Votazione` XIX con etichetta contenente "finale" e
   `osr:oggetto/osr:relativoA` verso un disegno (SELECT DISTINCT; le votazioni
   collegate a più disegni compaiono su più righe).
4. `sessions` — `osr:dataSeduta` e `osr:numeroSeduta` di tutte le sedute XIX;
   le sedute di commissione possono mancare di numero, ma quelle referenziate
   dalle finali lo hanno sempre.
5. `nominalVotes` — una query per votazione tenuta: predicati `favorevole`,
   `contrario`, `astenuto`, `presenteNonVotante`, `inCongedoMissione`
   (ThreadPoolExecutor, digest cumulativo).
6. `disegniXix` — COUNT dei disegni XIX con iniziativa, per
   `coverage.actsExcludedNonSenatorFirstSigner`.

### Modello a fasi e perimetro

Ogni nodo `osr:Ddl` è una **fase** di un disegno di legge: l'unità dello
snapshot è il disegno (`osr:idDdl`, id `ddl-<id>`), non la fase. Le fasi sono
ordinate per `osr:progressivoIter`; i disegni abbinati compaiono come fasi
fuse (es. `S.93-338-353-B`). Perimetro: disegni la cui fase iniziale è
`presentato` sul ramo `S` con esattamente un primo firmatario senatore su
quella fase (i flag sui nodi fusi successivi non contano). I disegni XIX con
iniziativa ma senza primo firmatario senatore (deputati, Governo, Regioni,
CNEL, popolare) sono esclusi e conteggiati in
`coverage.actsExcludedNonSenatorFirstSigner`; le votazioni finali su quei
disegni sono conteggiate in `coverage.finalVotesOnOtherActs`. Quattro disegni
hanno titoli divergenti fra le fasi: vince il titolo normalizzato più lungo.
`officialPage` usa `Ddliter/<idDdl>.htm` (la pagina risponde 202 al probe
automatizzato per anti-bot, ma è il pattern canonico).

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
indicazione del motivo; le finali su disegni non a prima firma senatore sono
escluse; le votazioni segrete non espongono il voto individuale; la Camera ha
uno snapshot separato con ontologia e regole di conteggio proprie; nessun
importo è presente.

### Verifica e refresh

```bash
# verifica offline dell'artifact committato (network guard obbligatorio)
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python3 scripts/etl/senato_atti_voti_xix_snapshot.py --check

# test ETL offline
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  python3 -m unittest discover -s tests/etl -p 'test_senato_atti_voti_xix_snapshot.py'

# refresh dalla fonte (senza guard; aggiorna artifact e lock della spec)
python3 scripts/etl/senato_atti_voti_xix_snapshot.py --write
```

Contratto runtime: `src/lib/data/senato-atti-voti-contract.ts`
(`parseSenatoAttiVotiSnapshot`, Zod strict + riconciliazioni). Test Node:
`tests/senato-atti-voti-contract.test.mjs`, `tests/politici-atti-route.test.mjs`.
Spec sorgente: `scripts/etl/specs/senato-atti-voti-xix.source.json`.
