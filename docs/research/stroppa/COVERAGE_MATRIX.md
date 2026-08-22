# Matrice di copertura

Stato al 22 agosto 2026. “Maturo” descrive la struttura del pacchetto, non autorizza la pubblicazione senza fonte primaria, licenza e verifica del record.

| Area | Artefatto candidato | Copertura osservata | Stato | Confine per il prodotto |
| --- | --- | --- | --- | --- |
| Affidamenti diretti | `dashboard/affidamenti-diretti.tsv` + `.json` | 6.506 record, 6.484 CIG unici, 2.445 importi, 2.293 contraenti | Identità forte, campi molto parziali | Explorer sì; ranking e benchmark no finché base, atto e coorte non sono verificati |
| Consulenze e incarichi | `segnalazioni-card.tsv`, benchmark e NOTE | cataloghi nominativi e 19 casi benchmark | Misto | Minimizzare nomi/CF; annuale e totale non sono intercambiabili |
| Consulenze legali / PNRR | NOTE e TSV dedicati | legali 352 righe; PNRR 213 righe nel profilo selettivo | Maturo come indice | Hub e strati non provano il singolo importo; non sommare layer diversi |
| Eventi, convegni, campagne | TSV dedicati e NOTE | eventi 109/71 importi; campagne 94/19 importi | Parziale | IVA quasi sempre ignota; keyword in 176 AD sono solo candidati |
| Missioni, rimborsi, auto, welfare, affitti | QC OpenBDAP e file dedicati | missioni e rimborsi hanno QC di riconciliazione | Maturo su alcune voci | Tenere distinti PG, capitolo, cassa e bilancio; non sommare strati |
| Rinnovi e proroghe | `rinnovi-proroghe.tsv` + NOTE | 440 cluster | Maturo come segnale | `importo_somma` ritirato/n.d.; cluster non è totale speso |
| Fuori Consip | TSV + NOTE | finestra 2024-08-01–2026-08-20 | Parziale | Mapping conservativo, BDNCP assente, 2025 ASP incompleto |
| Vincitori, gruppi, ripetuti | segnalazioni e rinnovi | identificatori e cluster disponibili | Parziale | Missingness fornitori impedisce concentrazione completa |
| Violazioni trasparenza | `violazioni-trasparenza.tsv` | 291 righe dichiarate | Candidato FOIA | Verificare norma, applicabilità, luogo e data; assenza nel pacchetto non basta |
| Personale, indennità, staff | benchmark istituzioni e segnali | aggregati 2025-2026 | Opaco | Coorti istituzionali spesso non omogenee; nessuna inferenza nominativa |
| Benchmark istituzioni/contratti/consulenze | tre TSV + revisioni | 23 / 11 / 19 righe | QC utile, qualità variabile | Cerebro e Santoro esplicitamente non like-for-like; fonti commerciali non sono mercato |
| Corte dei conti | NOTE + atti | 93 righe, 8 importi espressi negli atti | Alta fiducia su atti risolti | Sei listing 2026 senza download restano buchi; importo nell'atto non è automaticamente spreco |
| Proposte e segnalazioni | `segnalazioni.tsv` | 168 segnali dichiarati | Indice editoriale | Messaggi e priorità di prodotto non sono prova dei fatti |

## Gap trasversali

- Licenza/riuso non verificati a livello archivio o candidato.
- `urls.csv` non riconcilia con il README: 1.240 righe dati contro 781 dichiarate.
- Il master affidamenti non ha un file NOTE/QC dedicato; il JSON contiene solo controlli incorporati.
- Il 22,1% delle date affidamenti cade al 1° gennaio e tre righe hanno solo il mese: niente benchmark mensili o stagionali senza precisione esplicita.
- La classificazione del metodo negli affidamenti deriva dal testo `oggetto`; non esiste un campo metodo sorgente.
- Copertura importi per ente molto disomogenea: non pubblicare classifiche di totali tra enti.
