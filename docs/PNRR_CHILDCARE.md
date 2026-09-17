# Traccia PNRR: asili e prima infanzia

La pagina `/coesione/asili`, le schede `/progetti/[cup]`, l'API `/api/pnrr/asili` e il dataset MCP `pnrr_asili` condividono lo stesso snapshot verificato di Italia Domani.

## Perimetro

L'integrazione seleziona soltanto il codice ufficiale `M4C1I1.01.00`, “Piano per asili nido e scuole dell'infanzia e servizi di educazione e cura per la prima infanzia”. Non rappresenta l'intero PNRR.

La release estratta il 13 giugno 2026 contiene. Il campo `referenceDate` è la data di estrazione dichiarata nei CSV; `observedAt` (`2026-08-21T12:15:00Z`) indica quando lo snapshot locale è stato verificato e generato. Non sono la data di pubblicazione di una nuova release upstream.

La release contiene:

- 3.841 progetti e 3.841 CUP unici;
- 3.842 localizzazioni, con almeno una localizzazione per ogni CUP;
- 18.851 righe gara per 3.672 progetti;
- 18.250 righe aggiudicatario per 3.591 progetti;
- 2.700 Comuni distinti nelle localizzazioni.

## Fonti e source lock

L'ETL usa quattro CSV pubblicati nel catalogo open data Italia Domani:

1. `PNRR_Progetti.csv`;
2. `PNRR_Localizzazione.csv`;
3. `PNRR_Gare.csv`;
4. `PNRR_Aggiudicatari_Gare.csv`.

URL, dimensione e SHA-256 di ogni input sono bloccati in `scripts/etl/specs/pnrr-childcare.source.json`. Un cambiamento di byte, schema, data di estrazione o copertura interrompe la rigenerazione finché la nuova release non viene revisionata.

## Collegamenti

Progetti e localizzazioni sono collegati per CUP esatto. Gare e aggiudicatari conservano la chiave composta:

```text
CUP + CIG + Codice interno PDA + Codice procedura utente
```

Il portale non usa denominazioni di enti o imprese per creare corrispondenze. Nella release corrente 2 righe aggiudicatario su 18.250 non trovano la stessa chiave completa in una gara: restano associate al CUP, ma non vengono attribuite a una procedura specifica.

## Significato degli importi

La scheda mantiene quattro livelli separati:

- finanziamento PNRR registrato sul progetto;
- importo complessivo delle gare;
- importo di aggiudicazione;
- pagamenti ReGiS.

L'ultimo livello non è presente nei CSV integrati e viene mostrato come mancante. Finanziamento, gara e aggiudicazione non vengono chiamati “pagamenti” o “spesa realizzata”. Le somme di gara e aggiudicazione nella UI sono valori derivati dalle righe fonte e vengono etichettate come tali.

## Evidenza nella UI

Ogni scheda usa quattro etichette:

- `osservato`: valore presente nella fonte;
- `collegato`: record unito tramite chiave esatta;
- `derivato`: valore calcolato da righe osservate;
- `mancante`: valore non pubblicato o collegamento incompleto.

La validazione Italia Domani viene riportata come campo fonte, non trasformata in un giudizio di qualità, efficienza o legalità. Il controllo live OpenBDAP MOP usa lo stesso CUP, ha un budget di 8 secondi e non blocca la scheda primaria se l'upstream non risponde.

## Rigenerazione

Scaricare i quattro asset ufficiali bloccati dal manifest, poi eseguire:

```bash
python3 scripts/etl/pnrr_childcare_snapshot.py \
  --projects-input /percorso/PNRR_Progetti.csv \
  --locations-input /percorso/PNRR_Localizzazione.csv \
  --tenders-input /percorso/PNRR_Gare.csv \
  --awardees-input /percorso/PNRR_Aggiudicatari_Gare.csv
python3 scripts/etl/pnrr_childcare_snapshot.py --check
python3 -m unittest -v tests/etl/test_pnrr_childcare_snapshot.py
```

L'output dati è JSON compatto per restare sotto 25 MiB; i metadati separati conservano copertura, totali, metodologia e legame crittografico con l'artefatto. La CI ordinaria valida tutto offline. Il workflow schedulato controlla gli upstream e segnala una variazione senza commettere automaticamente una release non revisionata.
