# ADR-002 — Object storage OpenCUP

- **Stato:** proposta operativa; R2 approvato come prima scelta, provisioning e restore da eseguire.
- **Data:** 7 settembre 2026.
- **Riferimenti:** [ADR-001](ADR-001-generated-artifacts-storage.md), [decisioni del maintainer su #249](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/249#issuecomment-5574486182).

## Perimetro della draft PR

La pipeline offline trasforma lo ZIP ufficiale in oggetti redatti con indice
per CUP esatto. La candidata locale verificata contiene 11.973.988 righe:
2.203.779.590 byte sorgente e 58.979 oggetti prodotto, per 3.650.205.754 byte.
Queste misure vanno riconfermate sulla release destinata al primo upload.

Le nuove ricerche OpenCUP restano spente in UI, API e MCP; la fonte non compare
nello stato pubblico. La scheda storica `catalog-only` e la sua provenienza
restano visibili con i conteggi del corpus già pubblicato, senza righe nazionali.

Il reader attuale legge oggetti locali verificati. La connessione autenticata
a R2 e il manifest remoto devono essere integrati e verificati dopo la review
di questa draft, prima dell'attivazione. I nomi R2 sotto sono proposti, non
variabili già consumate dal runtime.

La ricerca per CF del titolare e i collegamenti dalle schede ente/coesione/opere
richiesti da #249 restano da completare. CF/PIVA sono oscurati nel prodotto:
serve concordare un identificativo esatto pubblicabile e il relativo indice,
senza ricostruire identità da nomi o titoli. Questa draft non chiude #249.

## Storage, accesso e versioni

- Bucket nell'account dell'organizzazione, creati dai maintainer.
- Raw CSV/ZIP privato in un bucket separato; nessun accesso raw dal runtime.
- Bucket prodotto con soli oggetti redatti, chiavi `sha256/<digest>` e nessun
  listing pubblico. Solo il manifest decide quali oggetti leggere.
- Manifest e ricevuta versionati in Git; verifica byte/SHA prima dell'uso,
  cache immutabile solo per digest, rollback tramite manifest precedente.
- Retention della release corrente e delle due precedenti. Conservare comunque
  ogni oggetto referenziato da `main`, un deploy attivo o un manifest mantenuto.
- Backup in un dominio di guasto distinto, scelto dai maintainer prima del
  caricamento in produzione.

R2 non implementa il [versioning S3](https://developers.cloudflare.com/r2/api/s3/api/).
La proposta è conservare ogni versione per digest, con manifest immutabili e
[Bucket Lock](https://developers.cloudflare.com/r2/buckets/bucket-locks/).
Questa soluzione non equivale al versioning nativo del bucket richiesto da
ADR-001: i maintainer devono accettarla esplicitamente nella review dell'ADR
oppure indicare un'alternativa prima del provisioning.

## Configurazione proposta

I maintainer inseriscono questi secret; in issue/PR non vanno mai i valori:

- `DVNS_OPENCUP_R2_RUNTIME_ACCESS_KEY_ID`
- `DVNS_OPENCUP_R2_RUNTIME_SECRET_ACCESS_KEY`
- `DVNS_OPENCUP_R2_CI_ACCESS_KEY_ID`
- `DVNS_OPENCUP_R2_CI_SECRET_ACCESS_KEY`

Configurazione server-side: `DVNS_OPENCUP_R2_ACCOUNT_ID`,
`DVNS_OPENCUP_R2_PRODUCT_BUCKET`, `DVNS_OPENCUP_R2_RAW_BUCKET`.
Runtime in sola lettura sul prodotto; CI può caricare candidati ma non
promuoverli. La configurazione locale già supportata è
`DVNS_OPENCUP_PROJECTS_MANIFEST`, percorso del manifest accanto a `sha256/`.

## Stima da approvare prima dell'upload

Ipotesi mensile: tre versioni completamente diverse, un refresh e una sua
ripetizione, due verifiche integrali e 100.000 ricerche senza cache.

| Voce | Volume previsto |
| --- | --- |
| Storage prodotto + ZIP raw, tre versioni | 10,951 + 6,611 = 17,562 GB |
| Scritture refresh, inclusa ripetizione | meno di 120.000 oggetti, oltre al multipart raw |
| Letture runtime | massimo 800.000, usando il budget di 8 oggetti per ricerca |
| Verifiche integrali CI | circa 118.000 letture e 7,30 GB scaricati da R2 |
| Upload CI | circa 11,71 GB tra raw e prodotto per due tentativi |
| Download sorgente ufficiale | circa 4,41 GB per due tentativi |

Con il [listino R2 Standard](https://developers.cloudflare.com/r2/pricing/)
verificato il 7 settembre 2026 e franchigie interamente disponibili, queste
ipotesi costano circa 0,12 USD/mese: 18 GB arrotondati, meno 10 gratuiti, a
0,015 USD/GB-mese. Le operazioni restano sotto le franchigie di un milione di
scritture e dieci milioni di letture; l'egress R2 è gratuito.
Sono esclusi backup esterno, compute, log, IVA e traffico del provider
applicativo. Ricalcolare considerando anche gli altri consumi dell'account;
il limite di spesa finale spetta ai maintainer.

## Verifica e attivazione

Build offline, usando il source lock versionato e percorsi privati esterni a Git:

```python
from pathlib import Path
from opencup_projects import build_release, official_contract, verify_release

output = Path("/percorso/privato/release")
build_release(Path("/percorso/privato/OpendataProgetti.zip"), output, official_contract())
verify_release(output / "manifest.json")
```

Il modulo si importa con `PYTHONPATH=scripts/etl`.
Prima della visibilità, i maintainer devono:

1. completare review, decisione sul versioning, provisioning e upload di prova;
2. scegliere un oggetto dal manifest, annotare digest/byte e copiarlo nel backup;
3. rimuovere soltanto la copia di prova, ripristinarla dal backup e riscaricarla
   per digest, verificando byte/SHA prima della decompressione;
4. verificare canary e ricerca CUP nell'ambiente ripristinato;
5. registrare in issue/PR data, ambiente, commit, manifest, digest ed esito;
6. attivare insieme policy, stato fonte, UI/API e MCP.

Un errore lascia il prodotto spento; nessun fallback silenzioso a `latest`
o ad altri digest. Ripetere periodicamente il restore con esito registrato.

**Da aggiornare prima dell'attivazione:** bucket e permessi effettivi senza
segreti, approvazione del versioning, destinazione/retention e frequenza di
verifica del backup, stima approvata, reader R2 e manifest testati, ricevuta
del restore e decisione di promozione.
