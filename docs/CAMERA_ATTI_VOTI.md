# Camera: atti firmati, iter e votazioni finali (XIX legislatura)

Snapshot tipizzato `src/data/generated/camera-atti-voti-xix.json`: le proposte di
legge di iniziativa parlamentare firmate dai deputati, il loro iter e le
votazioni finali con il voto nominale di ciascun deputato. Alimenta la sezione
"Proposte di legge" del profilo persona in `/politici` e l'endpoint
`/api/politici/<id>/atti`. Risponde alla issue #545; il Senato resta un
follow-up perché espone un'ontologia diversa su `dati.senato.it`.

## Fonte e query

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

## Perimetro

Entrano solo gli atti il cui primo firmatario è un deputato XIX
(`deputato.rdf/d<num>_19`): 2.585 atti. I 337 disegni di legge a prima firma di
un membro del Governo (blank node con `ocd:rif_membroGoverno`) sono esclusi e
conteggiati in `coverage.actsWithGovernmentFirstSigner`; le loro votazioni
finali sono conteggiate in `coverage.finalVotesOnOtherActs` e non incluse. Gli
atti con numero suffisso (`ac19_1038-B`, `-bis`, …) restano: `number` è stringa,
`baseNumber` intero per l'ordinamento.

## Classi di esito

Gli stati iter ufficiali (`dc:title` dello `ocd:statoIter`) sono mappati in
`outcomeClasses`: `assegnato`, `in-esame`, `approvato-camera-trasmesso`,
`approvato-definitivamente-non-pubblicato`, `legge`, `assorbito`, `ritirato`,
`respinto`, `altro-concluso`. Lo stato corrente è quello con data massima; a
parità di data vince la classe più avanzata in quest'ordine. Uno stato senza
data o non mappato ferma l'import; il validatore richiede anche che ogni
`officialStates` dichiarato torni alla classe giusta.

## Identità verificate (strict, fail-closed)

Sui conteggi ufficiali della Camera gli astenuti sono presenti ma non votanti:

- `favorevoli + contrari == votanti`
- `favorevoli + contrari + astenuti == presenti`
- `approvato == (favorevoli > maggioranza)`
- conteggi nominali: `#F == favorevoli`, `#C == contrari`, `#A == astenuti`

I tipi di voto osservati sono `Favorevole`, `Contrario`, `Astensione`,
`Non ha votato`, `Ha votato` (votazione segreta), codificati `F C A N V`.
Qualsiasi altro valore ferma l'import.

## Cosa non misura

La firma non è paternità del testo finale; i conteggi non misurano
produttività o merito; "Non ha votato" non distingue assenza, missione o
scelta; le votazioni segrete non espongono il voto individuale; le finali su
disegni di legge governativi sono fuori perimetro; il Senato non è incluso;
nessun importo è presente.

## Verifica e refresh

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
