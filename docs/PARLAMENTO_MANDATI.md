# Parlamento: legislature per ramo dei parlamentari in carica (XIX)

Snapshot tipizzato che alimenta il filtro **Legislature** dell'atlante
`/politici` (`mandato=`) e la voce «Legislature in Parlamento» del profilo.
Prima fetta della issue #556: timeline dei gruppi, vitalizio, capo partito e
motivo dei passaggi restano fuori.

- `src/data/generated/parlamento-mandati-xix.json`
- ETL: `scripts/etl/parlamento_mandati_xix_snapshot.py` (`--check` offline,
  `--write` interroga le due Camere)
- Spec e lock: `scripts/etl/specs/parlamento-mandati-xix.source.json`
- Contratto: `src/lib/data/parlamento-mandati-contract.ts`

## Fonti e identità

Ogni persona è letta **solo dalla fonte del ramo in cui siede oggi**, con
l'identificativo ufficiale di quel ramo:

| Ramo | Endpoint | Licenza | Percorso |
|---|---|---|---|
| Camera | `https://dati.camera.it/sparql` (OCD) | CC BY 4.0 | `foaf:Person` → `ocd:rif_mandatoCamera` / `ocd:rif_mandatoSenato` → `ocd:rif_leg` |
| Senato | `https://dati.senato.it/sparql` (OSR) | CC BY 3.0 IT | `osr:Senatore` → `osr:mandato` (`ocd:mandatoSenato` / `ocd:mandatoCamera`) → `osr:legislatura` |

Entrambe le fonti pubblicano anche i mandati che la persona ha avuto nell'altro
ramo, collegati al proprio identificativo: il Senato, per esempio, lega i
mandati Camera con `owl:sameAs` al deputato OCD. Il conteggio in Parlamento usa
questi collegamenti ufficiali; **nessuna persona è associata per nome**. Il
Senato risponde 403 alle POST SPARQL: l'ETL usa GET per quel ramo.

Il roster è quello già committato in `politici-camera-xix` e
`politici-senato-xix`. Se uno dei due cambia senza rigenerare questo snapshot,
`--check` fallisce.

## Semantica

- `legislatures.camera`, `legislatures.senato`: legislature repubblicane con
  almeno un mandato in quel ramo; `legislatures.parliament` è l'unione.
- `firstTermInChamber`: la XIX è l'unica legislatura nel ramo di appartenenza.
- `firstTermInParliament`: la XIX è l'unica legislatura in entrambi i rami.
- Più mandati nella stessa legislatura e nello stesso ramo, per esempio dopo una
  proclamazione in sostituzione o un'elezione annullata, contano una volta.
- Per i senatori a vita le legislature sono quelle in cui hanno seduto, non
  elezioni.
- Soldi: assenti. Periodo: legislature repubblicane fino alla XIX. Provenance:
  due risposte SPARQL lockate per byte e SHA-256.

## Fail-closed

L'import si blocca quando:

- un membro in carica non ha mandati nella fonte, oppure non ha un mandato XIX
  aperto nel proprio ramo;
- il tipo del mandato e il suo URI indicano rami diversi, o un mandato Senato
  appartiene a un altro senatore;
- compare una legislatura non repubblicana: Costituente e Regno non vengono
  numerati;
- lo stesso mandato arriva con valori discordanti;
- legislature, flag o `coverage` non si ricalcolano dai mandati;
- una risposta non corrisponde al lock o il roster diverge dagli snapshot
  politici.

## Cosa non misura

Non è una misura di esperienza politica complessiva. Incarichi regionali,
locali, europei o di governo senza seggio non sono contati, e «primo mandato
parlamentare» non significa prima esperienza istituzionale. Non è un calcolo di
vitalizio: requisiti e importi dipendono da regole e periodi che questo
snapshot non contiene. Il filtro esclude i membri del Governo che non siedono in
Parlamento, perché per loro nessun ramo pubblica mandati.

## Verifiche

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python -m unittest discover -s tests/etl -p 'test_parlamento_mandati_xix_snapshot.py'
node --experimental-strip-types --test tests/parlamento-mandati-contract.test.mjs
node --experimental-strip-types --test --test-name-pattern='legislature filter' tests/politici-atlas-model.test.mjs
```
