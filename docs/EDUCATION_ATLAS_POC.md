# Atlante — POC istruzione

Questo documento definisce il primo perimetro per aggiungere l'istruzione
all'Atlante già integrato in DoveVannoINostriSoldi. Non introduce un nuovo
nome di prodotto. La prima implementazione è stata preparata localmente in un
worktree separato ed è proposta come PR applicativa.

## Domanda

Quali percorsi di istruzione sono presenti nei territori italiani, come stanno
cambiando e dove si osservano possibili disallineamenti tra offerta formativa,
tessuto produttivo e investimenti pubblici?

La parola **lacuna** non descrive automaticamente una carenza. Nella prima
versione indica soltanto un'assenza, una copertura bassa o una variazione
osservata nella fonte. Un eventuale confronto con le imprese sarà presentato
come **disallineamento potenziale**, non come prova di carenza di lavoratori o
di inefficienza della scuola.

## Perimetro POC

### 1. Percorsi e indirizzi

Fonte MIM, dataset `ALUSECGRADOIND`:

- scuola secondaria di secondo grado;
- anno scolastico;
- tipo percorso (valori ufficiali `LICEO`, `TECNICO`, `PROFESSIONALE`,
  `PROFESSIONALE IeFP`);
- percorso e indirizzo;
- studenti maschi e femmine in forma aggregata;
- codice della scuola per il join territoriale.

La distribuzione statale e quella paritaria restano distinguibili. Il dataset
degli indirizzi disponibile ora espone gli anni scolastici 2022/23, 2023/24 e
2024/25; la serie è quindi sufficiente per un primo trend, ma non per una
storia lunga.

### 2. Territorio scolastico

Fonte MIM, anagrafe delle scuole:

- regione, provincia e Comune;
- codice scuola e tipo di istituzione;
- statale/paritaria;
- denominazione e sede come attributi della fonte, non come profilo
  personale.

Il join deve usare il codice scuola. Non si ricostruisce il territorio dal
nome dell'istituto.

### 3. Soldi e progetti

Seconda tranche: OpenCoesione per progetti e pagamenti classificati nel tema
`Istruzione e formazione`, con territorio, data, importi e stato della fonte.
Pagamenti, finanziamenti, impegni e costi previsti restano misure diverse e
non vengono sommati.

### 4. Contesto territoriale

Terza tranche: indicatori ISTAT su titoli di studio, popolazione e occupazione
alla geografia effettivamente pubblicata. Questi dati hanno periodi e grane
diverse dalla serie scolastica e non vengono fusi in un unico indicatore senza
un contratto esplicito.

## Implementazione locale della prima tranche

La prima prova è ora disponibile nella route `/istruzione` e usa la stessa
grammatica di Atlante Imprese: mappa regionale, filtri, classifica descrittiva,
trend e fonte sempre visibile. Il filtro per percorso porta anche agli
indirizzi di studio aggregati, mentre la card “Copertura della fonte” espone la
copertura mancante senza trasformarla in un giudizio.

Questa prima tranche resta volutamente regionale: provincia e Comune sono
presenti nell'anagrafe MIM come campi di join, ma non vengono ancora esposti
come filtri o profili. Allo stesso modo, progetti e pagamenti pubblici restano
nella seconda tranche OpenCoesione descritta sopra. Il totale dei territori
osservati non viene quindi presentato come Italia completa quando la fonte non
contiene tutte le Regioni.

Il generatore `scripts/etl/education_atlas_snapshot.py` scarica i dodici CSV
MIM del triennio, verifica lo schema, normalizza i nomi regionali, fa il join
su `CODICESCUOLA` e produce l'aggregato committato in
`src/data/generated/education-atlas-snapshot.json`, insieme al manifest
`education-atlas-source-files.json`. Il dataset è disponibile anche come
`education_students_by_pathway` nel catalogo MCP, con paginazione, le dodici
ricevute di provenienza (URL, ruolo, hash, byte, righe, data di pubblicazione e
data di riferimento della distribuzione) e caveat.

## Prima UI

La vista resta dentro Atlante e riusa la grammatica di Atlante Imprese:

1. selezione della Regione nel perimetro osservato;
2. card con periodo e perimetro;
3. distribuzione per tipo di percorso;
4. esplorazione degli indirizzi;
5. trend per anno scolastico;
6. classifica descrittiva, tabelle dei principali valori e fonte sempre visibile;
7. provincia/Comune e progetti/pagamenti come estensioni successive, con
   periodo e grana mantenuti separati.

Non si pubblicano classifiche di scuole, insegnanti o studenti. Non si
identificano persone e non si ricavano giudizi di qualità da un numero di
iscritti.

## Collegamento con Atlante Imprese

In una fase successiva si può mettere a confronto:

- studenti e percorsi tecnici/professionali per territorio;
- sezioni ATECO e dimensione del tessuto produttivo già presente in Atlante
  Imprese;
- eventualmente addetti o turnover aggregati, mantenendo separati periodi,
  classificazioni e perimetri.

Il collegamento tra un indirizzo scolastico e una sezione ATECO sarà una
**mappatura editoriale dichiarata**, non una classificazione ufficiale del
mercato del lavoro. La UI dovrà chiamarlo confronto o segnale di possibile
disallineamento, mai “domanda insoddisfatta” o “indirizzo inutile”.

## Audit iniziale — 27 agosto 2026

Input MIM 2024/25 verificati offline:

| Input | Righe | Studenti | Valori numerici invalidi | Join codice scuola |
|---|---:|---:|---:|---:|
| Statale, indirizzi | 64.102 | 2.506.430 | 0 | 100% |
| Paritaria, indirizzi | 7.657 | 126.230 | 0 | 100% |

Il join è stato misurato contro le anagrafi statale e paritaria 2024/25:
62.012 codici scuola distinti, nessuna duplicazione del codice nella mappa di
join. La copertura comune è di 18 regioni: i file studenti escludono le
province autonome di Trento e Bolzano, mentre le anagrafi usate per il join
escludono anche Aosta. Il risultato non va quindi chiamato “Italia completa”.

Nel file statale, il totale studenti passa da 2.518.855 nel 2022/23 a
2.506.430 nel 2024/25 (-0,49%). Nello stesso intervallo gli indirizzi
`INDUSTRIA E ARTIGIANATO` crescono dell'11,38%, mentre `CLASSICO` diminuisce
del 7,54%. Sono variazioni descrittive del file, non spiegazioni causali.

Il primo snapshot locale contiene 108 osservazioni regionali, 1.086 per
percorso e 6.677 per indirizzo. Tutti i 12 join anno/tipo scuola hanno avuto
zero righe orfane. Le fonti, gli hash SHA-256 dei file e i conteggi di input
sono conservati nel manifest dei file sorgente e riconciliati con lo snapshot;
il controllo offline è eseguibile con
`python3 scripts/etl/education_atlas_snapshot.py --check`.

## Fonti e condizioni

- MIM pubblica il dataset degli indirizzi con periodicità annuale e licenza
  IODL 2.0; la pagina del dataset descrive la classificazione disponibile dal
  2018/19. Il catalogo della licenza è registrato come
  `http://www.dati.gov.it/iodl/2.0/` nella provenienza MCP.
- La pagina MIM dell'anagrafe statale dichiara anch'essa IODL 2.0; la data di
  pubblicazione del dataset è distinta dalla data `Dati al 31/08` contenuta
  nella distribuzione annuale.
- OpenCoesione dichiara per il dataset pagamenti frequenza bimestrale e
  licenza CC BY 4.0.
- Le condizioni vanno registrate per ogni distribuzione concreta, insieme a
  URL, data di pubblicazione, data di riferimento (`dataAsOf`), hash, schema,
  periodo e copertura. Il manifest conserva entrambe le date e l'ETL limita a
  50 MiB la lettura di ogni CSV remoto.
- `python3 scripts/etl/education_atlas_snapshot.py --check` verifica il
  contenuto committato e le ricevute già registrate; non scarica nuovamente i
  file e quindi non dimostra che l'URL remoto non sia cambiato. Il generatore
  senza `--check` è il passaggio online che scarica le distribuzioni e aggiorna
  gli hash.

## Stima di lavoro

Stima operativa, non promessa di calendario. La prima voce è stata completata
nel worktree locale:

- audit e source lock MIM: completati;
- POC indirizzi + trend + UI + test: 3–5 giorni;
- OpenCoesione, pagamenti/progetti e QA della PR: altri 3–5 giorni;
- confronto istruzione/imprese con crosswalk documentato: 3–7 giorni
  aggiuntivi.

Quindi un POC leggibile è circa metà o due terzi della prima tranche di
Atlante Imprese, perché può riusare route, mappe, filtri, MCP e contratti già
esistenti. Una versione completa con spesa, edifici, indicatori territoriali
e confronto con le imprese è invece un progetto da circa 2–3 settimane di
lavoro concentrato.

## Definition of done della prima tranche

- snapshot MIM statale/paritaria con URL, hash, licenza e periodo;
- schema validato e join sul codice scuola;
- copertura geografica esplicita, incluse le autonomie non presenti;
- trend solo su anni con definizione comparabile;
- indirizzi e tipi percorso filtrabili senza dati individuali;
- fonte, periodo, perimetro e limiti visibili nella UI;
- test per duplicati, valori negativi/null, join orfani e variazioni di schema;
- endpoint MCP read-only con paginazione e provenance;
- nessuna etichetta automatica di “lacuna”, spreco o qualità.
