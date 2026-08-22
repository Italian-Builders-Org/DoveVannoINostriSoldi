# Slice verificata: campagna editoriale VIVE 2026

Stato delle fonti al 22 agosto 2026. Questa slice parte da cinque righe del catalogo affidamenti e le verifica nelle determine pubblicate dal Vittoriano e Palazzo Venezia, istituto autonomo del Ministero della Cultura. Nel repository entrano soltanto fatti strutturati, URL e digest: le pagine e i PDF ufficiali non vengono copiati.

## Cosa è stato verificato

Le cinque determine riguardano la promozione editoriale della mostra “La Maddalena di Piero di Cosimo: arte, storia e vite di donne nel Rinascimento fiorentino”, in programma dal 16 aprile al 5 luglio 2026. Ogni atto espone CIG, operatore, procedura, importo netto, IVA, impegno lordo e capitolo.

| CIG | Determina e fonte ufficiale | Importo nel pacchetto | Netto nell'atto | Lordo nell'atto | Base trovata nel pacchetto | Benchmark |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `BB18EDFD7B` | [n. 57 del 1 aprile 2026](https://trasparenza.cultura.gov.it/archivio105_procedure-dal-01012024_0_42689_566_1.html) | €2.500,00 | €2.500,00 | €3.050,00 | netto | incluso |
| `BB19028CFB` | [n. 58 del 1 aprile 2026](https://trasparenza.cultura.gov.it/archivio105_procedure-dal-01012024_0_42690_566_1.html) | €1.586,00 | €1.300,00 | €1.586,00 | lordo | incluso |
| `BB19625E0D` | [n. 59 del 1 aprile 2026](https://trasparenza.cultura.gov.it/archivio105_procedure-dal-01012024_0_42691_566_1.html) | €2.600,00 | €2.600,00 | €3.172,00 | netto | incluso |
| `BB19F574A5` | [n. 60 del 1 aprile 2026](https://trasparenza.cultura.gov.it/archivio105_procedure-dal-01012024_0_42692_566_1.html) | €3.039,63 | €2.491,50 | €3.039,63 | lordo | incluso |
| `BB23E9F610` | [n. 67 del 7 aprile 2026](https://trasparenza.cultura.gov.it/archivio105_procedure-dal-01012024_0_43234_566_1.html) | €7.200,00 | €7.200,00 | €8.784,00 | netto | escluso: piattaforma specifica |

Il campo importo del pacchetto alterna quindi tre valori netti e due lordi. La pipeline non prova a indovinare la base: usa gli importi netti espliciti nelle determine e conserva la discrepanza come caveat di provenienza.

## Coorte e denominatore

I candidati sono cinque. Le determine 57–60 condividono:

- stesso ente e stessa mostra;
- stessa data di affidamento, capitolo di spesa e procedura;
- stessa descrizione generica del servizio e gli stessi due gruppi di attività editoriali;
- importo totale di aggiudicazione al netto dell'IVA.

La determina 67 è esclusa perché specifica la “Digital Mediaplatform del quotidiano Il Messaggero”, un perimetro più definito. Denominatore: 5 candidati, 4 inclusi, 1 escluso con motivo visibile.

Sui quattro importi netti (€1.300, €2.491,50, €2.500 e €2.600), con quantili R7 arrotondati al centesimo:

- mediana: €2.495,75;
- percentile 25: €2.193,63;
- percentile 75: €2.525,00;
- percentile 90: €2.570,00.

Il delta di ogni record è `importo netto - mediana`. È un confronto descrittivo tra valori totali affidati, non un prezzo unitario, una stima di mercato o una misura di efficacia. Le determine autorizzano gli affidamenti e subordinano la fatturazione alla conformità: non provano pagamento, esecuzione o completamento.

## Cosa non sappiamo

Le determine richiamano preventivi che non risultano allegati ai cinque documenti verificati. Non sono quindi confrontabili pubblico raggiunto, quantità di articoli, durata delle sponsorizzazioni, impression o altri volumi editoriali. Il confronto non dimostra spreco, convenienza, illecito o qualità del servizio.

La licenza del pacchetto ricevuto resta non verificata. La slice non redistribuisce il file sorgente né i PDF: pubblica un piccolo insieme di fatti estratti da atti ufficiali, con CIG, link e digest necessari alla verifica.

## Riproducibilità

- Input curato e digest degli atti: `scripts/etl/specs/stroppa-vive-editorial-campaign.json`.
- Trasformazione deterministica: `scripts/etl/build_stroppa_vive_campaign.py`.
- Snapshot e metadati compatti: `src/data/generated/stroppa-vive-campaign.*.json`.
- Il test ETL rigenera byte per byte gli artefatti e fallisce su derive di importo, IVA, base o perimetro.
