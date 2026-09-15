# Ampliamento del report sulla spesa pubblica

## Perimetro della modifica

Nuovo approfondimento nell’archivio già presente: `/report/spesa-pubblica-italiana-2026`.
Non sostituisce `/report/bilancio-stato-2025`, non introduce un nuovo menu e non chiude
l’epic #493 o l’agente #502. L’articolo copre le dieci divisioni COFOG e una lettura
trasversale dei Comuni. Le evidenze sono una ricognizione documentale, non una run
su tutte le transazioni italiane.

23 schede di evidenza, 12 calcoli riproducibili, 26 riferimenti: 15 voci di evidenza,
metodologia e provenienza, più 11 cataloghi da cui acquisire approfondimenti.
Gli interventi proposti sono analisi del report, non affermazioni attribuite ai titolari.

## Architettura

- Il contenuto canonico è `src/content/reports/public-spending-2026.json`.
- La pagina usa il contratto editoriale e confronta la mappa congelata con
  `queryEurostatCofog`, senza scaricare dati o creare un nuovo dataset ufficiale.
- Il report non modifica lo snapshot esistente. I valori macro sono arrotondati
  a 0,01 miliardi. Il rilascio 2024 resta distinto dalle evidenze settoriali 2023-2025.
- Il componente `MonthlyReportsArchive` riceve una seconda analisi. Gli articoli
  mensili e il rapporto precedente restano inalterati.
- PDF, JSON pubblico, CSV delle evidenze e Markdown sono derivati dallo stesso contenuto.
  Il manifest riporta hash dei derivati, non hash di file esterni mai acquisiti.
- Se la versione corrente dello snapshot diverge, la pagina avverte della revisione;
  il gate pre-pubblicazione si ferma. Non si riscrivono retroattivamente report e PDF.

## Verifiche locali indipendenti

```bash
node --experimental-strip-types --test tests/public-spending-report.test.mjs
python3 -m unittest discover -s tests/reports -v
python3 scripts/reports/build_public_spending_report.py --check
```

Il calcolo TypeScript usa frazioni con BigInt; il calcolo Python usa Decimal.
Gli operandi hanno riferimenti alle metriche sorgente editoriali. Alterare la metrica
senza aggiornare correttamente il calcolo, perdere una fonte, duplicare una funzione
oppure trasformare il quadro in un audit del 100% delle transazioni fa fallire i test.

## Gate obbligatorio sul repository completo

```bash
node --experimental-strip-types scripts/reports/check_public_spending_snapshot.mjs
```

Legge i byte effettivi dello snapshot Eurostat, verifica l’hash contro metadato e
report, riconcilia dimensione, celle italiane 2024, importi arrotondati, quota del PIL
e scarto fra divisioni e totale entro la tolleranza dichiarata. **Questo gate non è
stato eseguito sui byte originali nell’ambiente di preparazione.** I test del gate
usano fixture sintetiche e non certificano la fonte reale.

Rieseguire tutti i controlli richiesti da AGENTS/CONTRIBUTING, incluso il browser
nell’applicazione reale. Il test geometrico svolto nella preparazione riguarda il
markup del componente isolato con un serializzatore JSX e una fixture COFOG:
non verifica il runtime Next/React, l’idratazione, il layout completo o il deployment.

## Rigenerazione del PDF

```bash
python3 -m pip install -r scripts/reports/requirements-public-spending.txt
python3 scripts/reports/build_public_spending_report.py
```

La dipendenza è solo di sviluppo. Il renderer non scarica font: usa DejaVu Sans
quando installato, altrimenti Helvetica. Non vengono distribuiti file di font.
I byte PDF sono riproducibili nello stesso ambiente di renderer e font; con font
alternativi cambia l’impaginazione e va controllata visivamente. `--check` non
richiede ReportLab e controlla gli artefatti già generati senza modificarli.

## Revisione editoriale ancora richiesta

Confermare le fonti indicate come testo ufficiale indicizzato, ricontrollare i rilasci
ed eventualmente acquisire i byte secondo le policy del repository. Verificare in
particolare il testo MiC nella versione corrente, il dispositivo C-515/23 e i conteggi
ANAC. Non attribuire al 2026 somme effettivamente pagate non osservate; la penalità
semestrale è una base riducibile e non va moltiplicata per inventare un cumulato.

L’edizione resta esplicitamente in bozza finché non c’è revisione umana. Per il
rilascio, rimuovere coerentemente la dicitura dalle superfici dopo l’approvazione,
registrare la revisione e rigenerare gli artefatti. Non cambiare il perimetro per far
apparire l’analisi più completa di quanto sia.
