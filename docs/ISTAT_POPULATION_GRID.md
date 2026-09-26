# Griglia territoriale ISTAT 1 km² (Censimento 2021)

Prima fetta di [#664](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/664):
aggregati **statici** della popolazione legale sulla griglia regolare Eurostat
da 1 km² pubblicata da ISTAT. Nessun workflow di refresh e nessun richiamo API
a runtime.

## Cosa aggreghiamo

Dal CSV ufficiale (`GrigliaPop2021_Ind_ITA_CSV.zip`):

| Aggregato | Dove compare |
| --- | --- |
| Totale persone, maschi/femmine, fasce d’età ufficiali del CSV, nati, occupati | `/territori/griglia`, `/api/territori/griglia` |
| Numero di celle e fasce di densità (0, 1-9, …, 5.000+) | stessa pagina/API |
| Celle di confine per `CNTR_ID` | API + artifact |

Non pubblichiamo le ~319k righe di cella nel prodotto: restano nell’asset
ufficiale hashed. Non interpoliamo celle assenti e non stimiamo valori.

## Dove vive nel prodotto

- UI: [`/territori/griglia`](../src/app/territori/griglia/page.tsx)
- API statica: [`/api/territori/griglia`](../src/app/api/territori/griglia/route.ts)
- Artifact: `src/data/generated/istat-population-grid-2021.{data,meta}.json`
- Lock: `scripts/etl/specs/istat-population-grid-2021.source.json`

## Appoggio ai dati economici

La griglia **non** è la chiave di join per i dataset economici già online.
L’appoggio territoriale operativo resta:

1. **Codice ISTAT comunale** → corpus `istat-misura-comune-*` (`/dati/...`)
2. **Geografia comunale SITUAS** già usata da `/territori` per €/km² e filtri

La pagina griglia li collega esplicitamente e dichiara il limite.

## Soldi / periodo / provenance

- **Soldi:** assenti (`soldi.present: false`).
- **Periodo:** Censimento 2021; landing aggiornata al 10 settembre 2024.
- **Provenance:** URL ufficiali ISTAT, SHA-256 dello zip e del membro CSV,
  hash della nota metodologica, `acquiredAt` fissato nell’artifact.

## Fuori scope

- Digital twin / simulazioni di policy
- Join spaziale cella→comune/regione
- Refresh schedulato o fetch Situas/Eurostat a runtime
- Commit delle 319k celle nel tree pubblico

## Riproduzione offline

```bash
# Solo validazione del bundle committato (CI / locale, zero rete)
python3 scripts/etl/istat_population_grid_2021.py --check

# Rigenerazione da zip già scaricato in locale (rete non usata dallo script)
python3 scripts/etl/istat_population_grid_2021.py --write \
  --input /path/to/GrigliaPop2021_Ind_ITA_CSV.zip

node --experimental-strip-types --test tests/istat-population-grid-2021.test.mjs
```
