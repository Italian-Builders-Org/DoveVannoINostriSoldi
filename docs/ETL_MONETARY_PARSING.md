# Parsing monetario degli ETL

Le policy descrivono il contratto della singola fonte. Non si riconosce il formato
automaticamente e non si interpretano vuoti o marcatori di privacy come zero.

## Contratti prima dell'estrazione (#315)

I casi in `tests/etl/test_monetary_adapters.py` passano anche sui due adapter
precedenti all'estrazione delle primitive comuni.

| Adapter | Formato | Segno e assenza | Conversione |
| --- | --- | --- | --- |
| OpenCivitas 2022 | Intero o decimale con virgola, senza raggruppamenti; spazi esterni rimossi | Il parser ammette il meno; la normalizzazione richiede spesa storica non negativa e spesa standard positiva. Vuoti opzionali e celle con flag restano `None`; i quattro importi principali sono obbligatori | Euro in centesimi, `ROUND_HALF_UP`, anche oltre due cifre decimali |
| SSN/CCE 2024 | Punto e due cifre decimali esatte, senza raggruppamenti; spazi esterni rimossi | Il meno è ammesso; importo obbligatorio, nessun marcatore testuale di assenza ammesso | Euro in centesimi esatti; precisione diversa rifiutata |
| SIOPE, solo riferimento | Interi con meno opzionale, nessuno spazio | Secondo il contratto dell'adapter | La fonte è già in centesimi: nessuna moltiplicazione per 100 |

Il segno `+`, la notazione esponenziale, i valori non finiti e i separatori delle
migliaia sono rifiutati dai due parser migrati. Il limite di pubblicazione è
`abs(centesimi) <= 9_007_199_254_740_991`.

OpenCivitas confronta totali e importi per abitante usando i `Decimal` originali
prima dell'arrotondamento. La trasformazione non deve anticipare tale passaggio
né cambiare il parsing delle percentuali, dei livelli o dell'annualità 2021.

## API condivisa

`scripts/etl/monetary.py` espone una `MoneyPolicy` immutabile e due funzioni:

- `parse_cents(raw, policy)` valida tutta la stringa con il `pattern` dichiarato,
  normalizza soltanto i separatori ammessi e converte con `Decimal`.
- `decimal_to_cents(value, policy)` converte un `Decimal` già validato. È il
  punto usato da `cents()` di OpenCivitas, dopo le riconciliazioni originali.

La policy rende espliciti regex (inclusa la precisione ammessa), separatori,
unità (`euros` oppure `cents`), ammissione dei negativi, spazi esterni e
arrotondamento (`reject` oppure `half_up`). Se una fonte ammette raggruppamenti,
la sua regex deve validarne la posizione prima della rimozione del separatore.
Le policy dei due adapter attuali non li ammettono.

```python
import re
from monetary import MoneyPolicy, parse_cents

policy = MoneyPolicy(
    pattern=re.compile(r"-?\d+\.\d{2}"),
    decimal_separator=".",
    unit="euros",
    allow_negative=True,
    rounding="reject",
    strip_whitespace=True,
)
assert parse_cents("12.34", policy) == 1234
```

I valori non finiti, i formati errati, i segni vietati e i centesimi frazionari
senza arrotondamento ammesso producono `AmountError`. `AmountRangeError`, sua
sottoclasse, distingue gli importi fuori intervallo. I wrapper preservano
`StructuralError` / `SnapshotError` e aggiungono campo o riga della fonte.

Il cambio di unità è esatto e non dipende dalla precisione del contesto Decimal
del chiamante. L'arrotondamento avviene una sola volta, al centesimo; poi si
controlla il limite sicuro. Nessun passaggio attraverso `float`.

Restano negli adapter: vuoti obbligatori/opzionali, privacy e anomalie, vincoli
contabili sul segno, riconciliazioni, periodo, fonte e provenienza. In particolare
`decimal_value()`, `clean_metric()` e `basis_points()` conservano la logica
OpenCivitas preesistente; la primitiva comune sostituisce la sola conversione
monetaria in `cents()`. SIOPE e OpenCivitas 2021 non sono migrati.

## Verifica offline

```bash
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  .venv/bin/python -m unittest discover -s tests/etl -p 'test_monetary*.py'
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
  .venv/bin/python -m unittest discover -s tests/etl -p 'test_ssn_cce_snapshot.py'
```

I test coprono i contratti prima della migrazione, arrotondamento e limiti,
formati dichiarati/rifiutati, assenza e privacy, riconciliazioni e conversione
di ogni cella monetaria degli snapshot esistenti. Non rigenerano gli artifact:
hash, metadati e contenuti versionati restano invariati. I gate completi ETL e
snapshot seguono `CONTRIBUTING.md`.
