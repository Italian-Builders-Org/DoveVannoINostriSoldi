# Lamezia Terme: copertura del profilo ANAC

Verifica del 9 settembre 2026, riferita al feedback in #185 e allo snapshot
presente in `c8db14c2`. Il profilo `c_m208`, codice fiscale ente `00301390795`,
mostra 10 procedure e 10 aggiudicazioni. **Non è il totale annuo dell’ente.**

## Riscontro sui file originali

Sono stati verificati byte, SHA-256, membro ZIP e schema di tutti i dodici
archivi CIG 2025 e del registro delle stazioni appaltanti, contro
`scripts/etl/specs/anac-entity-procurement.source.json`.
Il digest della specifica è
`83ad261f83e7b4ff50bdfe95581cc99f4a07f2a4e43708f4f079aceaf218825d`.
Le URL ufficiali e le licenze sono nella specifica; i conteggi mensili e
i digest degli archivi sono nel [riscontro JSON](2026-09-09-lamezia-anac.json).

| Passaggio | Risultato |
| --- | ---: |
| Righe CIG con il codice fiscale dell’ente nella fonte | 137 |
| Righe non prevalenti | 4 |
| CIG distinti con riga prevalente | 133 |
| Esclusi dal collegamento per intervallo AUSA | 123 |
| Riconciliati e presenti nel profilo | 10 |

Il registro associa AUSA `0000161199` allo stesso codice fiscale, con
`data_inizio` del 22 dicembre 2025 e `data_fine` del 31 dicembre 2099.
La pipeline verifica la data di pubblicazione del CIG rispetto a questo
intervallo. I 123 CIG precedenti risultano `ausa-outside-registry-interval`;
i dieci rimanenti coincidono esattamente con l’insieme pubblicato, dal
23 al 31 dicembre. Non mancano file mensili nell’acquisizione verificata.

## Decisione e limiti

La corrispondenza del codice fiscale nella fonte è un indizio di copertura
parziale, ma non dimostra da sola l’identità storica richiesta dal contratto.
Non estendiamo retroattivamente l’intervallo AUSA e non correggiamo i numeri
aggiungendo record non riconciliati. Per farlo serve uno storico ufficiale
o una documentazione della fonte che chiarisca la semantica delle date.

133 è un conteggio di CIG della fonte, **non** di aggiudicazioni. Questa
verifica non ha ricalcolato le aggiudicazioni o gli importi dei 123 esclusi,
né stabilisce la completezza dei dati nazionali o dell’attività dell’ente.
I dieci record di aggiudicazione sono quelli del profilo verificato.

La UI dichiara ora la copertura dell’ente non accertata prima dei dati e
dei confronti, spiegando che dodici file mensili non garantiscono dodici
mesi di copertura per ogni ente. La stessa regola vale per tutti i profili;
mediane, percentili e concentrazione restano descrittivi dei soli record
riconciliati e non dell’intera attività amministrativa.

## Riproduzione offline

Scaricare gli archivi alle URL della specifica in una directory dedicata,
mantenendo i nomi `cig_csv_2025_01.zip` … `cig_csv_2025_12.zip` e
`stations.zip`. L’audit non scarica dati e rifiuta file diversi dai lock:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/audit_lamezia_procurement.py --input-dir /percorso/archivi > /tmp/lamezia-audit.json
diff -u docs/investigations/2026-09-09-lamezia-anac.json /tmp/lamezia-audit.json
```

Il risultato documenta questa release: una futura modifica degli input o
del profilo richiede un nuovo riscontro, non l’aggiornamento automatico del
conteggio riportato in questa nota.
