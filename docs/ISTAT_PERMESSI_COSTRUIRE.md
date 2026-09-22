# ISTAT · permessi di costruire 2015–2025 (tavole a.1–a.4)

Issue [#379](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/379).

Snapshot tipizzato delle **tavole introduttive nazionali** del rilascio ISTAT
*Statistiche sui permessi di costruire – Anno 2025* (pubblicazione 17 giugno 2026).

## Cosa misura

- **a.1** nuova edilizia residenziale (fabbricati, volume, superficie; abitazioni, superficie utile, stanze, accessori)
- **a.2** ampliamenti residenziali
- **a.3** nuova edilizia non residenziale per settore (agricoltura, industria, commercio, altro, totale)
- **a.4** ampliamenti non residenziali per settore

Unità: conteggi, m³, m². `soldi.present = false`.

## Cosa non misura

- Opere pubbliche MOP/OpenBDAP (`/opere`)
- Cassa SIOPE o spesa COFOG
- Prezzi abitativi OMI / Agenzia Entrate
- Geografia regionale o provinciale (solo Italia in questa slice)
- Serie pre-2005 (rottura metodologica dichiarata da ISTAT)

## Lock byte

| Asset | Byte | SHA-256 |
|---|---:|---|
| `Tavole-16giugno2026.zip` | 968604 | `d6edee1c0e0ad579e82e9f8efe9d09a89244936e874018234d98a5662ade5876` |

I membri a.1–a.4 sono hashed nel source lock. Licenza payload: `not-declared`
(evidenza note legali / open data ISTAT senza inventare CC BY sul zip).

## Superfici

- Pagina: `/edilizia`
- API: `/api/edilizia/permessi-costruire` (`anno`, `tavola=a1|a2|a3|a4`)
- MCP: `istat_permessi_costruire` (`year`, `table`)
- Fixture: `tests/fixtures/istat-permessi-costruire/Tavole-16giugno2026.zip`

## Verifica

```bash
python3 scripts/etl/istat_permessi_costruire_snapshot.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python -m unittest \
  tests.etl.test_istat_permessi_costruire_snapshot
node --experimental-strip-types --test \
  tests/istat-permessi-costruire.test.mjs \
  tests/istat-permessi-costruire-route.test.mjs
```
