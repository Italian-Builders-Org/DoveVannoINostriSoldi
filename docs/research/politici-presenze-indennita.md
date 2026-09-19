# Presenze parlamentari e trattamento economico — esito fonti

Verifica e2e (settembre 2026) sulle fonti ufficiali per le schede persona di `/politici`.

## Presenze / partecipazione al voto

| Ramo | Fonte ufficiale | Esito | Azione in prodotto |
| --- | --- | --- | --- |
| **Camera** | [Partecipazione al voto](https://www.camera.it/deputati/statistiche_voto) → vista [deputati cumulativa](https://www.camera.it/deputati/statistiche_voto/vista?leg=19&type=deputati&riepil_mese_end=2026-02-28) | Tabella HTML ufficiale con voti, missioni, totale presenze, assenze e assenze giustificate **per ogni deputato** | Snapshot `camera-partecipazione-voto` in scheda (dato individuale) |
| **Senato** | Open data votazioni / pagine istituzionali | **Nessuna** tabella ufficiale di % presenza equivalente | Gap dichiarato; **nessun** dato presenza sulle schede senatori |

Cosa misura la Camera: partecipazione alle **votazioni elettroniche in Aula** (voto o missione = presenza). Non misura le commissioni.

## Stipendi / indennità

| Perimetro | Fonte ufficiale | Esito | Azione in prodotto |
| --- | --- | --- | --- |
| **Deputati** | [Trattamento economico](https://www.camera.it/deputati/trattamento-economico) | Solo **aliquote istituzionali** uguali per tutti, non cedolini nominativi | Snapshot acquisito in repo per provenance, **non mostrato in scheda** (non è compenso individuale) |
| **Senatori** | Pagina trattamento economico Senato | Challenge WAF → niente hash ripetibile | Non pubblicato |
| **Ministri / PdR / stipendi personali** | — | Nessuna busta paga nominativa ufficiale acquisita | Non inventato |

## Regola

In scheda persona solo i campi **individuali** da snapshot validato. Assenza di match o ramo senza fonte ⇒ campo assente, non stima.
