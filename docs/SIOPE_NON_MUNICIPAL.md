# SIOPE: Province, Regioni e Città metropolitane

Questa release espone i pagamenti di cassa SIOPE di Province, Regioni comprese le Province
autonome e Città metropolitane per il 2024–2026. I Comuni rimangono nel contratto SIOPE
municipale, che conserva separati pagamenti e incassi.

## Perimetro e fonti

La proiezione legge `SIOPE_ANAGRAFICHE.zip`, `SIOPE_USCITE.<anno>.zip` e il registro IPA
ufficiale. Il titolare SIOPE è la Ragioneria Generale dello Stato, con banca dati gestita da
Banca d'Italia. La licenza e la data di pubblicazione non sono dichiarate dalle risorse usate;
la release le conserva rispettivamente come `not-declared` e `null`.

I tipi ed i comparti sono intenzionalmente distinti:

| Dataset | Tipo SIOPE | Comparto | Contenuto |
| --- | --- | --- | --- |
| `siope-inventario-enti` | tutti | tutti | censimento annuale e diagnostiche pubbliche |
| `siope-uscite-province` | `PROVINCIA` | `PRO` | pagamenti mensili |
| `siope-uscite-regioni` | `REGIONE` | `REG` | pagamenti mensili, incluse Province autonome |
| `siope-uscite-citta-metropolitane` | `CITTA_METROP` | `PRO` | pagamenti mensili |

ASL e altri tipi restano nel solo inventario: non esistono in questa release pagamenti
sanitari, copertura universale della PA, consolidamenti geografici, importi pro capite o
classifiche.

Le righe dei pagamenti usano centesimi interi e hanno una identità temporale SIOPE. Il join
con IPA è ammesso soltanto con codice fiscale esatto e una sola corrispondenza; le righe
unmatched o ambigue non vengono attribuite a un codice IPA. Il 2026 conserva soltanto i mesi
presenti nel file nazionale: non è trattato come anno completo. Un valore `0` è un movimento
osservato, mentre `null` nella vista compatta indica assenza di movimenti osservati.
La vista delle schede include soltanto identità valide in almeno una delle annualità
pubblicate. I codici delle Province cessate prima del 2024 non vengono elencati come
codici inclusi nelle schede delle Città metropolitane subentrate; eventuali conflitti
di tipo entro il periodo 2024–2026 continuano a interrompere la generazione.

## Artefatti e consultazione

Le righe pubbliche complete, il catalogo e le ricevute sono parte del corpus integrato.
Il file `src/data/generated/siope-nonmunicipal-detail.json` è la vista compatta server-only
per le schede ente; non contiene le righe raw del corpus. Il file
`src/data/generated/siope-nonmunicipal-view-proof.json` lega la vista al catalogo, alle quattro
ricevute, agli hash delle righe canoniche e alla release integrata. Il manifest separato
`src/data/generated/siope-nonmunicipal-provenance.json` è un input del sigillo:
la ricostruzione del proof non può modificarlo o ricavarlo dalla vista.

La release corrente conserva il manifest nativo completo di versione 2,
inclusa la ricevuta dei cinque input ufficiali verificata prima del parsing.
La riacquisizione del 6 settembre 2026 riproduce byte per byte i tre dataset
dei pagamenti e conserva tutti gli importi della vista compatta. L'inventario
esplicita anche i movimenti che non ricadono nella validità anagrafica: 1.764
righe nel 2024, 64 nel 2025 e 17 nel 2026. Questi scarti non sono attribuiti
arbitrariamente a un ente o a un tipo. Rispetto all'inventario precedente cambiano
solo stato e nota di copertura; restano 201 righe e tutti i conteggi invariati.
Il formato storico `historical-not-reattested` resta leggibile senza inventare
ricevute retroattive. Per le nuove release,
fonti, hash, date e proiezioni determinano il `releaseId`. Il catalogo dati usa le stesse
righe complete e il MCP le espone con gli identificativi `siope_inventario_enti`,
`siope_province`, `siope_regioni` e `siope_citta_metropolitane`.

Ogni dataset dichiara release, fonti, hash, data di acquisizione e caveat nel catalogo e
nella ricevuta `data/source-ledger/datasets/`. Le pagine ente usano la vista snapshot e non
dipendono dalla disponibilità live di IPA.

## Rigenerazione e controlli

Acquisire i cinque input ufficiali in una directory locale e creare separatamente una ricevuta
immutabile e canonica. La ricevuta ha `schemaVersion: 1`, scope
`non-municipal-payments-inputs` e una voce per ogni file con URL ufficiale esatto, byte,
SHA-256, `acquisitionDate`, `etag` e `lastModified` (gli ultimi due possono essere `null`).
URL, dimensione, hash e data sono verificati **prima** di aprire ZIP o CSV. La pipeline non
calcola né aggiorna i valori attesi della ricevuta: un input divergente interrompe il lavoro e
richiede una nuova acquisizione esplicitamente revisionata.

Generare quindi la proiezione candidata:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
python3 scripts/etl/siope_nonmunicipal.py \
  --input-dir /percorso/input-siope \
  --input-receipt /percorso/input-receipt.json \
  --output-dir /percorso/candidato \
  --acquired-at 2026-09-06T08:00:00+00:00
```

Il builder valida schema, provenienza e riconciliazione tra vista e PSV. Dopo il riesame dei
risultati, se gli input ufficiali sono cambiati si aggiornano intenzionalmente metadati
e valori `expected` dei quattro dataset nella specifica del corpus. La ricevuta di
acquisizione deve coincidere con la data dichiarata nel catalogo. Non si usano gli
output appena prodotti per auto-approvare i nuovi valori.

Se cambia il numero di righe, prima della promozione occorre revisionare anche
il contratto aggregato. Calcolare e verificare separatamente il nuovo totale:
totale precedente meno le righe precedenti dei quattro dataset più le nuove
righe riconciliate. Le quote `catalog-only` e `derived-only` degli altri dataset
restano invariate. Registrare nella review i conteggi precedenti, nuovi e il delta.
Aggiornare esplicitamente:

- `EXPECTED_DATASET_ROWS` in `scripts/etl/integrated_source_release.py`;
- i conteggi corrispondenti in `src/lib/integrated-source-contract.ts`;
- gli attesi di release nei test del corpus e nella skill
  `.agents/skills/verify-dvns-integrated-sources/`.

Non modificare i conteggi per aggirare un errore di riconciliazione. Il promotore
rifiuta un contratto aggregato non allineato **prima di scrivere**. Il test
`SiopeCompletePromotionTests` esercita sia questo rifiuto sia la promozione reale
con nuovi conteggi esplicitamente revisionati, manifest, ricevute e tutti i sigilli.
Dopo la promozione eseguire i gate completi di `CONTRIBUTING.md`: i tre comandi
seguenti sono soltanto il controllo rapido degli artifact.

La promozione completa inserisce i dataset alla prima acquisizione o li sostituisce in un
refresh. Conserva byte per byte tutti gli altri artifact e non richiede i loro raw storici;
rimuove i vecchi chunk dei soli dataset selezionati, ricrea catalogo, ricevute, proof integrata,
manifest nativo, vista compatta e proof della vista, quindi esegue le riconciliazioni prima di concludere:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
python3 scripts/etl/siope_nonmunicipal_corpus.py \
  --source-root /percorso/candidato \
  --dataset siope-inventario-enti \
  --dataset siope-uscite-province \
  --dataset siope-uscite-regioni \
  --dataset siope-uscite-citta-metropolitane
```

Un input invariato produce la stessa proiezione; un candidato con output mancanti viene
rifiutato prima delle scritture e i chunk obsoleti dei dataset selezionati vengono rimossi.
Qualunque errore di scrittura, verifica o sigillo ripristina tutti i file della release
precedente. Per controllare gli artifact promossi non servono rete né input raw:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
python3 scripts/etl/siope_nonmunicipal.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
python3 scripts/etl/integrated_curated_datasets.py check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
python3 scripts/etl/integrated_source_release.py --check
```

La cadenza dei file sorgente non equivale alla pubblicazione del prodotto: acquisizione e
promozione di queste nuove proiezioni sono manuali. Il refresh giornaliero comunale non viene
modificato. I test ETL verificano hash, schema, intervalli, identità temporali e tipo, mapping
tipo-comparto, join, scarti, duplicati, centesimi, riconciliazioni e rollback della promozione.
