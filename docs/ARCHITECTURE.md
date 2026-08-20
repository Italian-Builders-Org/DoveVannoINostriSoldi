# Architettura

## Obiettivo

DoveVannoINostriSoldi deve poter rispondere a una domanda semplice — “dove sono andati questi soldi?” — senza perdere la complessità contabile necessaria a dare una risposta corretta.

Per questo l'architettura è pensata in livelli separati.

## 1. Source registry

Il registro in `src/lib/sources.ts` descrive ogni fonte:

- proprietario;
- area;
- URL ufficiale;
- formato;
- copertura;
- frequenza;
- stato di integrazione.

È il punto di partenza per provenance e monitoring.

## 2. Acquisition

Ogni connettore deve:

1. scaricare solo da endpoint o documenti ufficiali;
2. rispettare rate limit, robots.txt e condizioni d'uso;
3. conservare timestamp di osservazione e metadati HTTP utili;
4. calcolare un hash del raw payload;
5. evitare di riscaricare una versione identica;
6. fallire in modo esplicito: dati vecchi sono preferibili a dati silenziosamente corrotti.

Per sorgenti a file useremo job idempotenti. Per API useremo checkpoint e retry con backoff.

## 3. Raw layer

Il raw non viene “ripulito” in-place.

Schema minimo:

```text
source_id
source_record_id
source_url
source_published_at
observed_at
ingested_at
content_type
raw_hash
raw_payload / object_uri
```

Questo rende ogni trasformazione riproducibile.

## 4. Normalized layer

Entità principali previste:

```text
public_entity
organization_unit
organization_identifier
public_holding
entrusted_service
payment
budget_measure
procurement_procedure
contract
supplier
public_project
grant
consultancy
parliamentary_budget_item
territory
source_snapshot
```

Chiavi di dominio da mantenere:

- Codice IPA;
- codice fiscale / partita IVA quando pubblicabile e utile;
- CIG;
- CUP;
- codici ISTAT territoriali;
- identificativi nativi della fonte.

Gli identificativi non vengono fusi in un singolo ID opaco: si mantiene una tabella di alias con tipo, fonte e validità temporale.

Per le partecipazioni, amministrazione e società sono due organizzazioni collegate da `public_holding`: anno di rilevazione, partecipazione diretta/indiretta, quota e tipo di controllo appartengono alla relazione, non all'identità della società. Gli affidamenti dichiarati restano record `entrusted_service` datati. Codice IPA, codice fiscale, codice AUSA e REA rimangono schemi di identificazione distinti; i match fuzzy per denominazione non vengono promossi a fatto.

## 5. Semantic layer

Qui si calcolano:

- aggregazioni temporali;
- spesa per missione, programma e categoria;
- confronti territoriali;
- valori pro capite;
- concentrazione dei fornitori;
- indicatori di procedura;
- serie storiche.

Ogni metrica ha una `metric_version` e una definizione pubblica.

## 6. Serving

Next.js serve UI e API BFF. Con la prima vera ingestione persistente introdurremo PostgreSQL come datastore analitico-operativo; oggetti raw di grandi dimensioni potranno vivere in object storage.

Nessuna credenziale di ingestione deve essere esposta al browser.

## 7. Freshness

Ogni dataset ha tre tempi distinti:

- `source_published_at`: quando la fonte dichiara di aver pubblicato il dato;
- `observed_at`: quando il nostro sistema ha visto quella versione;
- `ingested_at`: quando è stata acquisita con successo.

La UI mostrerà almeno l'ultimo aggiornamento della fonte e l'ultima ingestione riuscita.

## 8. Qualità

Controlli minimi per batch:

- schema validation;
- numero record e variazione rispetto al batch precedente;
- null rate sulle chiavi;
- duplicati;
- range degli importi;
- continuità temporale;
- referential integrity per CIG/CUP/ente;
- checksum;
- quarantine dei record non validi.

Il sistema non deve eliminare record “strani” solo perché sono outlier: proprio gli outlier possono essere il dato interessante da verificare.
