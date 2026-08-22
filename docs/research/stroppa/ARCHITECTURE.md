# Contratto di evidenza Stroppa

## Problema

Il pacchetto Stroppa è un indice di piste e trasformazioni, non una fonte primaria. I file mescolano copie finali, derivati, note, QC, bozze e raw; alcuni campi sono incompleti o non comparabili. Il prodotto deve poter mostrare fatti, confronti e mancanze senza trasformare una riga del pacchetto in un'accusa. L'architettura esistente richiede snapshot compatti, validazione fail-closed, metriche versionate e un selector condiviso da UI e API.

## Uso dal punto di vista del chiamante

La PR A definisce soltanto il contratto. Le PR successive aggiungeranno lo snapshot reale e queste funzioni:

```ts
const result = queryStroppaEvidence({ topic: "direct-award", year: 2025 });
const detail = getStroppaEvidenceDetail(result.items[0].id);
const card = getStroppaShareCard(detail.id);
const download = getStroppaCompactExport();
```

Il registro FOIA resta un modulo client separato:

```ts
const template = prepareFoiaDraft(evidenceId);
saveLocalFoiaDraft(template);
const text = exportFoiaDraft(template);
```

Non esistono metodi di invio, email, webhook o mutazione server.

## Forma

La base è uno snapshot normalizzato e specifico per il dominio Stroppa. Fonti, soggetti, osservazioni, coorti, benchmark, valutazioni e controlli di pubblicazione hanno una sola definizione. Le card sono proiezioni materializzate e riconciliate, non una seconda fonte di verità. Un sidecar separato conserva digest, input selezionati, copertura, licenza e tempi di osservazione.

Le invarianti sono nei tipi e nel validatore:

- gli importi sono centesimi EUR interi sicuri, con fase contabile, unità e trattamento IVA;
- la provenienza dal pacchetto resta `package_only_unverified` e non abilita una card pubblicabile;
- uno scostamento richiede comparabilità verificata, coorte minima, denominatore, esclusioni, quantili e formula riconciliabile;
- un'irregolarità documentata richiede un atto ufficiale qualificante e il suo stato procedurale;
- una mancanza di trasparenza richiede norma primaria, applicabilità, data e luoghi ufficiali controllati;
- quando uno di questi requisiti manca, la sola classe ammessa è `incomplete_or_not_comparable`.

Il modulo pubblico futuro nasconderà join, indici e regole dietro quattro query. Il payload wire del pacchetto e i path locali non fanno parte dell'interfaccia pubblica.

## Decisione di sintesi

Sono state confrontate due forme: documenti-caso autosufficienti e ledger normalizzato. Il ledger è la base perché evita duplicazioni di fonti e coorti e coincide con i pattern snapshot/selector già presenti. Dal documento-caso viene adottato soltanto `ShareCardModel`, materializzato al build e riconciliato con il ledger. È stato scartato un repository universale: il progetto usa moduli profondi ma specifici per dataset. È stato scartato anche lo stato FOIA dentro il repository read-only, perché mescolerebbe evidenza e mutazione locale.

## Tradeoff accettati

- Accettiamo un builder più articolato in cambio di una sola verità per fonti, soggetti e benchmark.
- Accettiamo di non pubblicare subito molte righe in cambio di confronti realmente omogenei.
- Accettiamo un sidecar aggiuntivo in cambio di digest e copertura verificabili senza esporre path interni.
- Accettiamo card materializzate in cambio di rendering semplice, ma il validatore deve riconciliarle.

## Alternative considerate

- **Documento `EvidenceCase` autoritativo:** interfaccia iniziale corta, ma duplica provenienza e coorti in ogni caso e rende le correzioni coordinate.
- **Estensione di `AuditSignal`:** persa perché quel tipo descrive segnali aggregati e controlli con semantica più ampia; non può garantire i requisiti record-level di card e FOIA.
- **Repository evidenza generico:** persa perché esporrebbe opzioni astratte e tipi wire senza nascondere più complessità del modulo specifico.

## Domande e rischi aperti

- Quale sottoinsieme mantiene la stessa base economica, IVA, unità, periodo e categoria dopo il riscontro sulla fonte primaria?
- Quali record nominativi sono necessari e proporzionati per il valore civico della prima slice?
- La licenza o il diritto di riuso copre i derivati compatti selezionati, oltre alla consultazione delle fonti ufficiali?

## Primo passo di implementazione

Validare manifest e snapshot sintetici, poi costruire un ETL specifico per il primo sottoinsieme che supera i gate di fonte, licenza e comparabilità.
