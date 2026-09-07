# Registro integrato di fonti e dataset

Questo documento descrive il rilascio pubblico completo del corpus integrato.
La prova canonica è `data/source-ledger/release-proof.json`: collega ricevuta
degli elementi, catalogo delle identità di fonte e 91 ricevute dataset.

## Contratto chiuso

| Livello | Totale | Equazione |
| --- | ---: | --- |
| Elementi inventariati | 51.303 | 46.438 file regolari + 4.860 hard link + 5 link simbolici |
| Identità di fonte | 34.071 | 32.578 pubblicate + 1.493 in quarantena |
| Occorrenze di fonte | 262.618 | tutte associate a una delle 34.071 identità |
| Dataset correnti | 91 | 69 interrogabili + 19 `catalog-only` + 3 `derived-only` |
| Righe sorgente | 14.457.856 | 1.475.510 pubbliche + 12.979.505 `catalog-only` + 2.841 `derived-only` |
| Byte delle sorgenti selezionate | 2.967.342.031 | somma dei byte impegnati nelle 91 ricevute |

La quarantena del catalogo non elimina l'identità: conserva ID opaco,
classificazione, occorrenze e motivo, ma non il valore privato o non sicuro.
Le 1.475.510 righe della proiezione pubblica restano invece interrogabili anche
quando la risorsa dichiara `licenseStatus: not-declared`; questo stato è un
caveat di riuso, non un filtro di pubblicazione. Quattro insiemi Consip, che
totalizzano 1.032.426 unità sorgente, hanno licenza verificata CC BY 4.0;
3.867 righe sono interrogabili e lo snapshot strutturato restante è
`catalog-only`. Le sue
1.028.559 unità fisiche comprendono 1.028.557 record validi e 2 frammenti
malformati preservati, non trasformati in record.
Il dataset `salute-posti-letto-2023` dichiara IODL 2.0 nella scheda ministeriale.
Le tre serie `istat-misura-comune-*` conservano `not-declared` per il singolo
asset e il riferimento alle condizioni generali ISTAT. [Contratto e
riproduzione](ISTAT_MISURA_COMUNE.md): 23.688 righe comunali, 2014–2024,
proiettate dalle celle del workbook ufficiale; non sono importi monetari.
Il dataset `mim-scuole-statali-comuni` aggiunge 6.648 righe comunali alla
release precedente (87 dataset, 840.160 righe pubbliche): conteggi di codici
marcati come sedi nell'anagrafe MIM 2026/27, IODL 2.0, raccordati a ISTAT
tramite le identità MEF (CC BY 3.0 IT). [Contratto e riproduzione](MIM_SCHOOL_SERVICES.md).
Il dataset `ted-avvisi-italia-2026-08` aggiunge 2.825 avvisi TED, con almeno
un committente in Italia e pubblicazione ad agosto 2026. Riuso degli avvisi
GUUE verificato; nessuna somma o join con ANAC. [Contratto e riproduzione](TED_NOTICES.md).
Il dataset `pnrr-progetti` aggiunge 291.398 registrazioni nazionali ReGiS,
con 285.992 CUP validi distinti e localizzazioni collegate esattamente.
Finanziamenti e pagamenti restano distinti. [Contratto e riproduzione](PNRR_PROJECTS.md).
Il catalogo pubblico delle fonti occupa 9.286.646 byte e ha SHA-256
`bd28e08c84f5f99f127a7e350b0268314c90f9290881803140f20d6c2662448f`.

## Tutti i dataset

`Righe/unità` è il conteggio canonico della sorgente selezionata. Coincide con i
record strutturati salvo i casi dichiarati che preservano frammenti fisici.
`Pubbliche` indica le righe interrogabili. `Fonti` conta le righe con almeno un
collegamento puntuale pubblicabile. Gli stati e le etichette sono riportati con i valori canonici
usati dalle API. Il catalogo conserva anche titolare, periodo, date disponibili,
ultimo controllo, frequenza e portali canonici. Dove questi metadati non sono
presenti, lo stato resta esplicitamente non disponibile; la ricevuta del dataset
fornisce comunque un percorso di provenienza verificabile.

| ID | Titolo | Dominio | Righe/unità | Pubbliche | Fonti | Stato | Evidenza | Licenza |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| `affidamenti-diretti` | Affidamenti diretti | procurement | 6.506 | 6.506 | 6.501 | rows | documented-fact | not-declared |
| `affitti-immobili` | Affitti e immobili | operations | 1.172 | 1.172 | 1.169 | rows | documented-fact | not-declared |
| `auto-welfare` | Auto e welfare | operations | 153 | 153 | 128 | rows | documented-fact | not-declared |
| `benchmark-consulenze` | Benchmark consulenze | benchmarks | 56 | 0 | 52 | catalog-only | needs-explanation | not-declared |
| `benchmark-contratti` | Benchmark contratti | benchmarks | 11 | 0 | 11 | catalog-only | needs-explanation | not-declared |
| `benchmark-istituzioni` | Benchmark istituzionali | benchmarks | 23 | 0 | 23 | catalog-only | needs-explanation | not-declared |
| `buchi-organico` | Documenti sull'organico non reperiti | transparency | 850 | 850 | 850 | rows | missing-data | not-declared |
| `buchi-trasparenza` | Buchi di trasparenza rilevati | transparency | 258 | 258 | 246 | rows | missing-data | not-declared |
| `c8-a` | Working set C8 A | candidate-batches | 1.835 | 0 | 1.835 | catalog-only | needs-explanation | not-declared |
| `c8-b` | Working set C8 B | candidate-batches | 492 | 0 | 492 | catalog-only | needs-explanation | not-declared |
| `c8-c` | Working set C8 C | candidate-batches | 508 | 0 | 508 | catalog-only | needs-explanation | not-declared |
| `c8-d` | Working set C8 D | candidate-batches | 309 | 0 | 309 | catalog-only | needs-explanation | not-declared |
| `campagne-pubblicita` | Campagne e pubblicità | operations | 94 | 94 | 94 | rows | documented-fact | not-declared |
| `capitoli-consulenze` | Capitoli per consulenze | consultancies | 224 | 224 | 224 | rows | documented-fact | not-declared |
| `capitoli-consulenze-copertura` | Copertura dei capitoli consulenze | transparency | 42 | 42 | 42 | rows | missing-data | not-declared |
| `cataloghi-url-supplementari` | Cataloghi URL supplementari | sources | 109 | 0 | 0 | catalog-only | documented-fact | not-declared |
| `catalogo-url-trasparenza` | Catalogo URL Amministrazione Trasparente | sources | 1.240 | 1.240 | 1.239 | source-index | documented-fact | not-declared |
| `cdp-compensi-sedi` | Compensi e sedi CDP | operations | 57 | 57 | 57 | rows | documented-fact | not-declared |
| `cig-aggiudicatari-extra` | CIG e aggiudicatari: lotti supplementari | procurement | 2.391 | 2.391 | 2.390 | rows | documented-fact | not-declared |
| `cig-autorita` | CIG di autorità | procurement | 1.047 | 1.047 | 1.047 | rows | documented-fact | not-declared |
| `cig-ministeri` | CIG di ministeri e Presidenza | procurement | 14.824 | 14.824 | 14.823 | rows | documented-fact | not-declared |
| `collaboratori-extra` | Collaboratori aggiuntivi | consultancies | 137 | 137 | 137 | rows | documented-fact | not-declared |
| `collaboratori-frammenti` | Frammenti collaboratori supplementari | appointments | 626 | 0 | 626 | catalog-only | documented-fact | not-declared |
| `comparazione-ue` | Confronti UE sul personale | personnel | 127 | 0 | 125 | catalog-only | needs-explanation | not-declared |
| `comparazione-ue-staff-funzioni` | Confronti UE per funzione | personnel | 26 | 0 | 26 | catalog-only | needs-explanation | not-declared |
| `consip-contratti-riconciliati` | Contratti Consip riconciliati | procurement | 3.669 | 3.669 | 0 | rows | documented-fact | not-declared |
| `consip-ranking` | Ranking derivato Consip | procurement | 1 | 0 | 0 | derived-only | needs-explanation | not-declared |
| `consip-snapshot-strutturati` | Snapshot strutturati Consip | procurement | 1.028.559 | 0 | 0 | catalog-only | documented-fact | verified-open-cc-by-4.0 |
| `consip-winners-2024` | Aggiudicatari Consip 2024 | procurement | 389 | 389 | 0 | rows | documented-fact | verified-open-cc-by-4.0 |
| `consip-winners-2025` | Aggiudicatari Consip 2025 | procurement | 1.884 | 1.884 | 0 | rows | documented-fact | verified-open-cc-by-4.0 |
| `consip-winners-2026` | Aggiudicatari Consip 2026 | procurement | 1.594 | 1.594 | 0 | rows | documented-fact | verified-open-cc-by-4.0 |
| `consulenze-legali` | Consulenze legali | consultancies | 352 | 352 | 352 | rows | documented-fact | not-declared |
| `consulenze-pnrr` | Consulenze PNRR | consultancies | 213 | 213 | 213 | rows | documented-fact | not-declared |
| `corte-conti` | Atti della Corte dei conti | oversight | 93 | 93 | 93 | rows | documented-fact | not-declared |
| `cv-incarichi` | CV e incarichi | consultancies | 139 | 0 | 119 | catalog-only | needs-explanation | not-declared |
| `eventi-convegni` | Eventi e convegni | operations | 109 | 109 | 109 | rows | documented-fact | not-declared |
| `fuori-consip` | Contratti da rendere comparabili | procurement | 207 | 207 | 206 | rows | needs-explanation | not-declared |
| `gruppi-vincitori` | Gruppi e fornitori | procurement | 27 | 0 | 17 | catalog-only | needs-explanation | not-declared |
| `incarichi-nominativi-buchi-copertura` | Incarichi: sezioni non reperite | transparency | 5 | 5 | 5 | rows | missing-data | not-declared |
| `incarichi-nominativi-buchi-riga` | Incarichi: righe con copertura incompleta | transparency | 1.186 | 1.186 | 1.185 | rows | missing-data | not-declared |
| `incarichi-nominativi-shard` | Incarichi nominativi: fonti estese | appointments | 39.685 | 39.685 | 39.685 | rows | documented-fact | not-declared |
| `indennita-organi` | Indennità degli organi | personnel | 131 | 131 | 131 | rows | documented-fact | not-declared |
| `indice-enti` | Indice degli enti | entities | 170 | 170 | 12 | source-index | documented-fact | not-declared |
| `istat-misura-comune-dipendenza-anziani` | A misura di Comune · Indice di dipendenza anziani | demography | 7.896 | 7.896 | 0 | rows | documented-fact | not-declared |
| `istat-misura-comune-dipendenza-strutturale` | A misura di Comune · Indice di dipendenza strutturale | demography | 7.896 | 7.896 | 0 | rows | documented-fact | not-declared |
| `istat-misura-comune-vecchiaia` | A misura di Comune · Indice di vecchiaia | demography | 7.896 | 7.896 | 0 | rows | documented-fact | not-declared |
| `mim-scuole-statali-comuni` | Scuole statali · sedi per Comune | education | 6.648 | 6.648 | 0 | rows | documented-fact | verified-open-iodl-2.0 |
| `missioni` | Capitoli per missioni e trasferte | operations | 618 | 618 | 618 | rows | documented-fact | not-declared |
| `missioni-cdp` | Missioni degli organi di Cassa Depositi e Prestiti | operations | 6 | 6 | 6 | rows | documented-fact | not-declared |
| `missioni-cdp-buchi` | Missioni CDP: documenti mancanti | transparency | 8 | 8 | 7 | rows | missing-data | not-declared |
| `nominativi-incarichi` | Incarichi nominativi | consultancies | 1.633 | 1.633 | 1.633 | rows | documented-fact | not-declared |
| `openbdap-capitoli-2024-2026` | Capitoli OpenBDAP 2024–2026 | state-accounts | 17.792 | 17.792 | 17.792 | rows | documented-fact | not-declared |
| `openbdap-consulenze-ce` | Consulenze OpenBDAP per categoria economica | appointments | 605 | 605 | 605 | rows | documented-fact | not-declared |
| `openbdap-personale-piani-gestione` | Personale OpenBDAP per piano di gestione | personnel | 5.556 | 5.556 | 5.556 | rows | documented-fact | not-declared |
| `opencup-census-window` | Finestra di riconciliazione CUP | projects | 5 | 0 | 5 | catalog-only | needs-explanation | not-declared |
| `opencup-metadati` | Metadati OpenCUP | sources | 91 | 0 | 0 | catalog-only | documented-fact | not-declared |
| `opencup-progetti-bulk` | Progetti OpenCUP: archivio bulk | projects | 11.942.784 | 0 | 0 | catalog-only | documented-fact | not-declared |
| `opencup-soggetti` | Soggetti titolari OpenCUP | projects | 54.323 | 54.323 | 0 | rows | documented-fact | not-declared |
| `opencup-trend-area-soggetto` | Trend OpenCUP per area e soggetto | projects | 984 | 0 | 0 | catalog-only | documented-fact | not-declared |
| `partecipate-at-focus` | Partecipate: ingressi Amministrazione Trasparente | transparency | 32 | 32 | 31 | source-index | documented-fact | not-declared |
| `partecipate-statali-focus` | Partecipate statali: focus | participations | 155 | 155 | 155 | rows | documented-fact | not-declared |
| `partecipate-statali-perimetro` | Partecipate statali: perimetro arricchito | participations | 28 | 0 | 28 | derived-only | documented-fact | not-declared |
| `parti-atti` | Soggetti negli atti | evidence | 159.493 | 159.493 | 159.493 | rows | documented-fact | not-declared |
| `personale` | Personale degli enti | personnel | 247 | 247 | 245 | rows | documented-fact | not-declared |
| `problemi-trasparenza` | Documenti e sezioni non reperiti | transparency | 291 | 291 | 287 | rows | missing-data | not-declared |
| `procurement-affidamenti-c1-extra` | Affidamenti diretti C1 supplementari | procurement | 185 | 185 | 185 | rows | documented-fact | not-declared |
| `procurement-atti-mimit` | Atti di acquisto MIMIT | procurement | 5.789 | 5.789 | 5.789 | rows | documented-fact | not-declared |
| `procurement-difesa-direzioni` | Procedure delle direzioni della Difesa | procurement | 122 | 122 | 122 | rows | documented-fact | not-declared |
| `procurement-difesa-procedimenti` | Procedimenti TERRARM | procurement | 27 | 27 | 27 | rows | documented-fact | not-declared |
| `procurement-indici-mimit` | Indice laterale bandi MIMIT | procurement | 2.794 | 0 | 2.794 | catalog-only | documented-fact | not-declared |
| `procurement-mimit-dork` | Atti MIMIT supplementari | procurement | 27 | 27 | 27 | rows | documented-fact | not-declared |
| `procurement-partecipate` | Affidamenti delle partecipate | procurement | 11.115 | 11.115 | 11.115 | rows | documented-fact | not-declared |
| `rimborsi-spese` | Rimborsi spese | operations | 21 | 21 | 21 | rows | documented-fact | not-declared |
| `rimborsi-spese-buchi` | Rimborsi spese: copertura mancante | transparency | 14 | 14 | 11 | rows | missing-data | not-declared |
| `rinnovi-proroghe` | Rinnovi e proroghe | procurement | 440 | 440 | 440 | rows | needs-explanation | not-declared |
| `segnalazioni` | Segnali da verificare | evidence | 168 | 168 | 168 | rows | needs-explanation | not-declared |
| `segnalazioni-card` | Righe preparatorie per schede | evidence | 2.812 | 0 | 2.812 | derived-only | needs-explanation | not-declared |
| `segnalazioni-parti` | Soggetti collegati alle segnalazioni | evidence | 164 | 164 | 0 | rows | needs-explanation | not-declared |
| `staff-funzioni` | Staff per funzione | personnel | 69 | 69 | 69 | rows | documented-fact | not-declared |
| `trasparenza-parchi-l38` | Trasparenza dei parchi nazionali | transparency | 300 | 300 | 258 | source-index | documented-fact | not-declared |
| `url-morti` | URL non raggiungibili | transparency | 98 | 98 | 98 | rows | missing-data | not-declared |
| `pnrr-progetti` | PNRR · catalogo nazionale dei progetti · 13 giugno 2026 | cohesion | 291.398 | 291.398 | 291.398 | rows | documented-fact | verified-open-cc-by-4.0 |
| `ted-avvisi-italia-2026-08` | Avvisi TED · committenti in Italia · agosto 2026 | procurement | 2.825 | 2.825 | 2.825 | rows | documented-fact | verified-open-eu-reuse |
| `vincitori` | Aggregati fornitori e settori | procurement | 682 | 682 | 0 | rows | documented-fact | not-declared |
| `vincitori-cig` | Vincitori collegati ai CIG | procurement | 120 | 120 | 119 | rows | documented-fact | not-declared |
| `salute-posti-letto-2023` | Posti letto per Regione e disciplina · 2023 | health | 1.019 | 1.019 | 0 | rows | documented-fact | verified-open-iodl-2.0 |
| `siope-inventario-enti` | SIOPE: inventario enti | public-spending | 201 | 201 | 0 | rows | documented-fact | not-declared |
| `siope-uscite-asl` | SIOPE: pagamenti delle ASL | public-spending | 334.479 | 334.479 | 0 | rows | documented-fact | not-declared |
| `siope-uscite-citta-metropolitane` | SIOPE: pagamenti delle Città metropolitane | public-spending | 56.188 | 56.188 | 0 | rows | documented-fact | not-declared |
| `siope-uscite-province` | SIOPE: pagamenti delle Province | public-spending | 270.194 | 270.194 | 0 | rows | documented-fact | not-declared |
| `siope-uscite-regioni` | SIOPE: pagamenti delle Regioni | public-spending | 150.088 | 150.088 | 0 | rows | documented-fact | not-declared |

Il bulk OpenCUP contiene 11.942.784 record CSV reali. Il conteggio grezzo di
11.991.275 linee fisiche di dati è più alto di 48.491 perché alcuni campi
quotati contengono newline: quelle linee aggiuntive appartengono a record già
contati e non rappresentano altri progetti.

## Redazioni e fedeltà

La pipeline conserva le righe e distingue sempre stringa vuota, marker come
`n.d.` e zero osservato. Non promuove una data al primo gennaio a data esatta,
non somma pagamenti e previsioni e non unisce incarichi nominativi a capitoli
contabili.

Le redazioni sono parte del contratto, non modifiche silenziose. Nel rilascio
corrente le 194.304 redazioni dichiarate dalle ricevute coincidono con quelle
degli artefatti. Credenziali, cookie, sessioni, URL riservati, path locali,
riferimenti di processo e identificatori dichiarati privati vengono rimossi
prima del calcolo dell'hash pubblico della riga.

## Superfici pubbliche

- `/dati`: tutti i 79 dataset e i loro stati;
- `/dati/<id>` e `/api/dati/<id>`: ricerca e paginazione delle 57 proiezioni;
- `/fonti/copertura`: riconciliazione dei tre livelli del rilascio e metadati di
  fonte e freschezza per tutti i 79 dataset;
- `/fonti/catalogo` e `/api/fonti/catalogo`: tutte le 34.071 identità;
- `/appalti`, `/incarichi`, `/spese`, `/controlli` e `/confronti`: anteprime
  concise di non più di tre percorsi pertinenti;
- `/appalti/dettaglio`, `/incarichi/dettaglio`, `/spese/operative` e
  `/trasparenza`: pagine-hub di espansione con tutti i percorsi del dominio e
  registro tecnico espandibile;
- 21 pagine tematiche sotto `/appalti`, `/incarichi`, `/spese`, `/controlli`,
  `/confronti` e `/trasparenza`: risultati, confini probatori, prime righe e
  collegamento al dataset completo;
- un'anteprima dedicata in `/partecipazioni`, che mantiene primaria la vista
  nazionale MEF e conduce ai tre insiemi di approfondimento; 21 pagine e questa
  anteprima rappresentano insieme tutti i 79 dataset una sola volta;
- MCP `spesa_pa_dettaglio`: lo stesso selettore pubblico con `code`, `query`,
  `limit` e `offset`.

Pagine, API e MCP delegano a `src/lib/integrated-public-view.ts`. Il loader
server-only verifica release, ricevute, hash, gzip canonico, schema, cardinalità
e URL prima di restituire una riga.

## Verifica riproducibile

I controlli offline non richiedono i percorsi privati:

```bash
python3 scripts/etl/source_corpus_intake.py --check
python3 scripts/etl/integrated_curated_datasets.py check
python3 scripts/etl/integrated_source_release.py --check
python3 -m unittest discover -s tests/etl
node --test tests/integrated-curated-datasets.test.mjs \
  tests/integrated-source-public-view.test.mjs
```

Il controllo forte delle sorgenti storiche rilegge anche il contenitore con
`verify-source`; i percorsi e le mappe esatte non vengono committati. Gli import
successivi hanno source lock e comandi di riproduzione propri: le serie ISTAT
comunali sono verificabili dalle celle sorgente versionate o dall'XLSX originale;
i conteggi scolastici dalle celle MIM selezionate o dal CSV originale.
Il catalogo delle identità viene
ricostruito con una chiave HMAC
privata stabile, così gli ID pubblici sono riproducibili senza rendere
reversibili i valori in quarantena.
