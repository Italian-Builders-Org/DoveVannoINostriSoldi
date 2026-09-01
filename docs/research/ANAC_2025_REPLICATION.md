# Replica degli indicatori ANAC 2025

## Domanda

Vogliamo capire quante procedure usano l'affidamento diretto e se i valori dei lotti dichiarati nella BDNCP si concentrano vicino alle soglie previste dalla legge. Il controllo deve essere ripetibile e non deve trasformare un segnale statistico in un'accusa.

## Fonti

- [dataset ufficiale ANAC CIG](https://dati.anticorruzione.it/opendata/dataset?q=cig-&res_format=CSV), dodici file mensili CSV per il 2025, licenza CC BY-SA 4.0;
- [rapporto ANAC sull'addensamento sotto soglia](https://www.anticorruzione.it/-/addensamento-sottosoglia-affidamenti-diretti-servizi-forniture-2021-2024), con [PDF metodologico](https://www.anticorruzione.it/documents/91439/391257415/Anac%2B-%2BAddensamento%2Bsottosoglia%2Baffidamenti%2Bdiretti%2Bservizi%2Be%2Bforniture%2B-%2B2021-2024.pdf/28380fa8-d28d-4010-ebf5-216476e990e6?t=1775812992353);
- [Relazione annuale ANAC 2026 sull'attività svolta nel 2025](https://www.anticorruzione.it/documents/91439/393633199/Anac%2B-%2BRelazione%2Bannuale%2B2026%2Bsu%2Battivit%C3%A0%2B2025.pdf/c2ff7d91-d715-800d-7689-15899ef650c9?t=1776760815657);
- [articolo 50 del decreto legislativo 36/2023](https://www.normattiva.it/uri-res/N2Ls?urn%3Anir%3Astato%3Adecreto.legislativo%3A2023-03-31%3B36~art50%21vig=) su Normattiva.

Nel 2025 l'articolo 50 consente l'affidamento diretto sotto 140.000 euro per servizi e forniture e sotto 150.000 euro per lavori. Per questo non usiamo 40.000 euro come soglia legale dell'analisi 2025.

## Metodo riproducibile

Lo script [`scripts/research/anac_cig_audit.py`](../../scripts/research/anac_cig_audit.py) legge i dodici ZIP senza estrarli, verifica lo schema, richiede la copertura di tutti i mesi, rifiuta CIG duplicati e registra SHA-256 e dimensione di ogni input. La modalità `--official-anac-resources` allega la provenienza delle distribuzioni soltanto se ogni hash coincide con quello verificato: fixture o file diversi non possono ereditare URL ufficiali. La replica è limitata al 2025 perché soglie e regole cambiano nel tempo.

Esempio:

```bash
python3 scripts/research/anac_cig_audit.py \
  --reference-year 2025 \
  --input /percorso/cig_csv_2025_01.zip \
  --input /percorso/cig_csv_2025_02.zip \
  --input /percorso/cig_csv_2025_03.zip \
  --input /percorso/cig_csv_2025_04.zip \
  --input /percorso/cig_csv_2025_05.zip \
  --input /percorso/cig_csv_2025_06.zip \
  --input /percorso/cig_csv_2025_07.zip \
  --input /percorso/cig_csv_2025_08.zip \
  --input /percorso/cig_csv_2025_09.zip \
  --input /percorso/cig_csv_2025_10.zip \
  --input /percorso/cig_csv_2025_11.zip \
  --input /percorso/cig_csv_2025_12.zip \
  --official-anac-resources \
  --output anac-cigs-2025.json
```

La banda vicina alla soglia è definita come `135.000 <= importo_lotto < 140.000`. Il conteggio più stretto comprende soltanto servizi o forniture, `AFFIDAMENTO DIRETTO` e `CONTRATTO D'APPALTO`.

## Prima esecuzione completa

Sui dodici file ufficiali scaricati il 20 agosto 2026 abbiamo letto 1.475.581 righe e selezionato 1.453.918 CIG attivi unici tramite il CPV prevalente. Due CIG non hanno una riga con `flag_prevalente=1` e restano esclusi. La copertura comprende tutti i mesi da gennaio a dicembre. Il [manifesto della replica](./data/anac-cigs-2025-2026-08-20.json) conserva risultati, dimensioni e SHA-256 dei dodici input. Il risultato descrittivo è:

| Misura | Risultato |
| --- | ---: |
| Righe grezze | 1.475.581 |
| CIG unici con CPV prevalente | 1.453.918 |
| Affidamento diretto, etichetta esatta, su tutti i CIG | 81,991075% |
| Tutte le etichette che iniziano con `AFFIDAMENTO DIRETTO` | 83,949232% |
| Procedura aperta su tutti i CIG | 4,958877% |
| Servizi e forniture sotto 140.000 euro, affidamento diretto esatto | 86,658706% |
| Servizi e forniture sotto 140.000 euro, famiglia di etichette dirette | 88,513285% |
| Servizi e forniture nella banda 135.000-140.000 euro | 18.955 CIG |
| Banda, affidamento diretto esatto | 15.697 CIG |
| Banda, contratto d'appalto e affidamento diretto | 13.393 CIG |
| Proxy del denominatore pubblicato da ANAC | 93,000670% |

La presentazione ufficiale ANAC riporta quasi il 95% delle acquisizioni di servizi e forniture tramite affidamento diretto e 13.879 acquisizioni nella fascia 135.000-140.000 euro. La quota vicina al 95% usa un denominatore specifico: affidamenti diretti sotto soglia più procedure non dirette sopra soglia, su contratti attivi di servizi e forniture tra 5.000 e 25 milioni di euro. Non è la quota degli affidamenti diretti su tutti i CIG.

Applicando quel denominatore ai file correnti otteniamo 93,000670%, non quasi 95%. Il calcolo esclude sopra soglia ogni etichetta della famiglia `AFFIDAMENTO DIRETTO`, comprese le adesioni ad accordo quadro. Anche il conteggio della banda non restituisce esattamente 13.879. Le differenze possono dipendere da rettifiche del dataset successive allo snapshot della relazione o da ulteriori dettagli del perimetro. Non forziamo la riconciliazione e non pubblichiamo come replica un valore che non coincide.

## Che cosa possiamo dire

- ANAC segnala ufficialmente un forte ricorso agli affidamenti diretti nei servizi e nelle forniture.
- ANAC segnala ufficialmente un addensamento di acquisizioni tra 135.000 e 140.000 euro.
- I file aperti confermano che vicino alla soglia esiste una concentrazione numerosa, ma serve il perimetro esatto della relazione per riprodurre 13.879.

## Che cosa non possiamo dire

- `importo_lotto` non è un prezzo unitario. Senza quantità, durata e specifiche non si può affermare che carta, computer o siringhe siano stati pagati cento volte di più.
- Un importo vicino alla soglia non prova un frazionamento artificioso.
- Un affidamento diretto non prova uno spreco o un illecito.
- I soli file CIG non bastano per misurare monopoli o fornitori ricorrenti. Serve un join verificato con aggiudicazioni e operatori economici.

## Passo successivo: confronti CPV e enti comparabili

Il join corretto usa `cig + id_aggiudicazione` tra i dataset ufficiali `aggiudicazioni` e `aggiudicatari`. L'importo aggiudicato va contato una sola volta anche quando un raggruppamento temporaneo contiene più imprese.

Quote Top 1 / Top 10 e HHI per ente, sul ranking già pubblicato, sono in questa
slice di #185. Restano fuori CPV, peer group, soglie e bunching. Per ente, periodo
e gruppo CPV si pubblicheranno soltanto gruppi con copertura dichiarata e almeno
30 osservazioni.

La dispersione entro un gruppo CPV sarà chiamata `dispersione della dimensione economica dei lotti`. Pubblicheremo numerosità, mediana, percentili e ampiezza interquartile. Non useremo la parola prezzo senza quantità e unità confrontabili.

Ogni futuro indicatore pubblico dovrà mostrare formula, perimetro, data, hash degli input, spiegazioni alternative e collegamento al record originale.
