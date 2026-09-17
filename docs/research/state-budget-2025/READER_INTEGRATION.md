# Audit del bilancio: seguito dopo la PR #509

La #509 è chiusa e mergiata. Questo seguito riunisce l'audit a 22 schede e la
sezione sulle spending review, sulla stessa pagina e sullo stesso PDF. Il
contenuto proviene dai pacchetti `dvns-pr509-audit-2026-09-15` e
`dvns-spending-review-aggiornamento`; il CSS conserva la correzione dei bordi
già mergiata. Non riaprire la PR storica.

## Pubblicazione e percorso di lettura

Restano un solo articolo, `/report/bilancio-stato-2025`, e il relativo PDF.
Il redirect precedente e l'archivio delle prove rimangono invariati.
Il contenuto canonico è `src/content/reports/state-budget-reader.json`.

L'articolo segue entrate, impegni, pagamenti, confronto temporale e risultati.
I riscontri sono organizzati in quattro percorsi: costi dell'inadempimento,
risultati mancati, crediti/riscossione, errori nei documenti. Gli aiuti all'estero
sono un contesto distinto, non una voce classificata automaticamente come spreco.
Il quadro COFOG riguarda tutta la PA nel 2024; non è il bilancio statale 2025.

## Contenuto nuovo

25 riscontri in un solo articolo: 17 della #509, cinque dell'audit successivo
(incentivi edilizi, assistenti sociali, cessazioni tardive INPS, registrazioni
erronee/duplicate INPS, rottamazioni) e tre della spending review (affitti,
energia, pasti dell'Esercito). 71 calcoli e 62 fonti. I casi originari restano
una sola volta. Le stime econometriche sono attribuite agli autori: non sono
nuove stime DVNS.

Il nuovo audit automatico controlla 15 aggregati RGS e 105 importi acquisiti:
45 identità contabili, sette somme di colonna e dieci verifiche sulla serie
storica 2015-2024. Ogni differenza monetaria è calcolata in centesimi interi;
la serie storica mantiene la tolleranza di un milione dei totali arrotondati.
I CSV mantengono unità, anni e fonti. Gli stock annuali non vengono sommati.

La fonte RGS dichiara 5.395 righe di capitolo: qui ne sono state riesaminate **zero**.
Non presentare i 62 controlli sugli aggregati come audit di tutte le spese.
I valori ministeriali vanno confrontati con lo snapshot completo già nel progetto.
La riconciliazione contabile non prova l'efficienza della spesa.

## PDF e pagina

Impaginazione continua: niente salto pagina per ogni caso. Grafici vettoriali,
tabelle multipagina con intestazioni ripetute, fonti cliccabili e segnalibri.
Titolo, periodo e apertura di ogni caso restano uniti. Nessun font distribuito.
Palette e logo DVNS preesistenti, grafici con etichette e valori oltre al colore.
Il sito mantiene conclusioni visibili e formule/dettagli espandibili.

## Provenienza

Il registro `reader-source-register.json` distingue documento originale,
testo estratto e pagine consultate tramite indicizzazione. I byte originali delle
nuove fonti non sono tutti disponibili: gli hash non acquisiti restano null.
Gli hash del pacchetto attestano i file consegnati, non certificano le fonti.

Gli allegati Radio Radio del 2020 e 2021 sono stati letti come piste. La bozza di
557 proposte non prova pagamenti; salari/risparmio non identificano un errore di
capitolo. Le esclusioni sono registrate e non sono state trasformate in accuse.

## Comandi nel clone completo

```sh
python scripts/reports/build_state_budget_reader.py --check
python scripts/reports/audit_state_budget.py --check --require-upstream
node --experimental-strip-types --test tests/state-budget-reader.test.mjs tests/state-budget-reader-snapshot.test.mjs
python -m unittest discover -s tests/reports -p 'test_state_budget_*.py'
```

I test di `tests/etl` espongono le stesse classi al percorso di CI esistente;
non contarli due volte. I casi fixture non costituiscono verifica degli originali.
Il controllo dello snapshot COFOG e quello RGS richiedono i file veri, non mock.

Eseguire poi i comandi ufficiali di lint, typecheck, test, build e browser del
progetto. La suite browser mensile deve continuare a chiamare
`inspectStateBudgetReader`, mantenendo archivio, articolo mensile e redirect.
Questo ambiente verifica solo il componente isolato e i moduli forniti, non la
build Next completa o la preview Vercel. Non dichiarare CI verde prima del run.
