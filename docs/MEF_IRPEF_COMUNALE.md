# Redditi e variabili IRPEF su base comunale

## Perimetro

Lo snapshot integra il rilascio ufficiale MEF riferito all'**anno d'imposta
2024** e alle **dichiarazioni 2025**. Espone, per Comune e per aggregazioni
provinciali e regionali:

- numero di contribuenti;
- reddito complessivo e relativa frequenza;
- reddito imponibile e relativa frequenza;
- **imposta netta dichiarata** e relativa frequenza;
- addizionale regionale dovuta e relativa frequenza;
- addizionale comunale dovuta e relativa frequenza.

Questi dati descrivono variabili dichiarative. L'imposta netta non è il gettito
fiscale totale, non è un incasso di cassa e non viene sottratta alle spese o al
saldo dei Conti Pubblici Territoriali.

## Release bloccata

| Elemento | Valore verificato |
| --- | --- |
| Catalogo | <https://www1.finanze.gov.it/finanze/analisi_stat/public/index.php?opendata=yes> |
| CSV ZIP | <https://www1.finanze.gov.it/finanze/analisi_stat/public/v_4_0_0/contenuti/Redditi_e_principali_variabili_IRPEF_su_base_comunale_CSV_2024.zip> |
| Pubblicazione | 23 aprile 2026 |
| ZIP | 1.028.668 byte · SHA-256 `75cecc95d72b76cda545666154e95ab414df1983f8a0eeef72915862ef4e8cb7` |
| Membro CSV | 2.313.404 byte · SHA-256 `c521886138d24e19df8a09b46b09fcb9b6f86966868783ea416295561930041c` |
| Formato | US-ASCII, CRLF, separatore `;` |
| Nota metodologica | <https://www1.finanze.gov.it/finanze/analisi_stat/public/v_4_0_0/contenuti/nota_metodologica_2024.pdf> |
| Definizioni | <https://www1.finanze.gov.it/finanze/analisi_stat/public/v_4_0_0/contenuti/definizione_variabili_2024_irpef.pdf> |
| Licenza | CC BY 3.0 · attribuzione `MEF – Dipartimento delle Finanze` |

Il MEF non pubblica un checksum firmato: gli hash sono impronte calcolate dal
progetto sulla versione osservata, non firme dell'editore. Il source lock
versiona anche i 52 header in ordine. L'header ufficiale termina con un
anomalo `; ` e viene quindi letto come 53 celle, mentre tutti i 7.897 record
hanno 52 campi. L'ETL accetta soltanto questa anomalia esatta e rifiuta ogni
altra colonna aggiunta, rimossa o riordinata.

## Quattro tempi diversi

- **Anno d'imposta:** 2024, periodo economico delle variabili.
- **Anno delle dichiarazioni:** 2025. Il MEF assegna il contribuente al Comune
  del domicilio fiscale al 31 dicembre dell'anno di presentazione.
- **Pubblicazione della fonte:** 23 aprile 2026.
- **Osservazione dello snapshot:** quando il progetto ha acquisito e verificato
  questi byte; non sostituisce nessuno dei tre tempi precedenti.

Le addizionali seguono inoltre le regole e il domicilio fiscale al 1° gennaio
2024 indicati nelle definizioni MEF. Per questo un'addizionale può comparire in
un Comune diverso da quello che un lettore assocerebbe alla dichiarazione.

## Definizioni e segreto statistico

`Numero contribuenti` include le persone fisiche ricavate da Redditi, 730 e,
per i non dichiaranti, CU; può includere soggetti con reddito lordo zero o con
soli redditi soggetti a imposta sostitutiva. Non coincide quindi con la
frequenza del reddito complessivo.

Il `reddito complessivo`, il `reddito imponibile`, l'`imposta netta` e le
addizionali mantengono il significato delle definizioni ufficiali. In
particolare, l'imposta netta corrisponde all'imposta lorda meno detrazioni e
crediti previsti dalla dichiarazione; la UI la chiama sempre **imposta netta
dichiarata**.

Per proteggere il segreto statistico, il MEF oscura le frequenze inferiori a 4
e i relativi importi; può oscurare anche un'ulteriore occorrenza. Una cella
vuota diventa quindi `null`, mai zero. Un importo letterale `0` resta invece un
valore pubblicato: può rappresentare un ammontare inferiore all'unità di euro.

Gli aggregati che includono celle oscurate espongono soltanto il subtotale
noto, il numero di righe soppresse e lo stato `partial`. Non vengono stimati o
ricostruiti valori mancanti.

## Copertura e aggregazioni

Il file contiene 7.896 Comuni univoci, 107 Province, 20 Regioni e una riga
residuale `Mancante/errata` con 5.305 contribuenti. La riga residuale viene
conservata nella riconciliazione nazionale, ma non è distribuita fra territori
e non compare in graduatorie o risultati geografici.

I codici ISTAT restano stringhe per non perdere gli zeri iniziali. Le Province
derivano dalle prime tre cifre del codice comunale e devono avere una sola
sigla e una sola Regione. Il codice Regione `04` aggrega le due etichette
provinciali di Trento e Bolzano sotto il nome canonico
`Trentino-Alto Adige/Südtirol`, conservando le etichette sorgente nella
provenienza.

Le somme vengono calcolate dall'ETL e ricostruite indipendentemente dal
contratto TypeScript. Ogni divergenza fra Comune, Provincia, Regione, totale
assegnato, residuo e totale nazionale interrompe il caricamento.

## Artefatti e aggiornamento

Il manifest `scripts/etl/specs/mef-irpef-2024.source.json` è l'autorità per
URL, licenza, dimensioni, hash, formato, schema e copertura. L'ETL produce:

- `src/data/generated/mef-irpef-2024.meta.json`, sidecar piccolo per
  provenienza e source health;
- `src/data/generated/mef-irpef-2024.data.json`, dati comunali compatti e
  aggregati riconciliati.

Il sidecar contiene l'hash dei byte canonici dell'artefatto dati. Il source
lock conserva inoltre dimensione e hash dell'output revisionato: una coppia
data/meta modificata in modo autoconsistente non può quindi superare
`--check` senza un aggiornamento esplicito del lock. La validazione offline non
usa la rete:

```bash
python3 scripts/etl/mef_irpef_municipal_snapshot.py \
  --spec scripts/etl/specs/mef-irpef-2024.source.json \
  --input /percorso/Redditi_e_principali_variabili_IRPEF_2024.zip \
  --meta-output src/data/generated/mef-irpef-2024.meta.json \
  --data-output src/data/generated/mef-irpef-2024.data.json \
  --observed-at 2026-08-21T00:00:00Z

python3 scripts/etl/mef_irpef_municipal_snapshot.py --check \
  --spec scripts/etl/specs/mef-irpef-2024.source.json \
  --meta-output src/data/generated/mef-irpef-2024.meta.json \
  --data-output src/data/generated/mef-irpef-2024.data.json
```

Un nuovo anno o una modifica di hash, schema, licenza o definizioni richiede
una revisione del source lock. Il workflow di discovery non ripunta
automaticamente il manifest e non sovrascrive l'ultimo snapshot valido.

## Superficie pubblica

- pagina server-rendered `/territori/irpef`;
- API territoriale paginata `/api/territori/irpef`;
- dataset MCP read-only `mef_irpef_comunale`.

La richiesta iniziale restituisce soltanto le 20 Regioni. Province e Comuni
sono filtrati e paginati, con un massimo di 100 righe. Il file comunale completo
non viene serializzato nel browser né esposto come resource MCP.

Non sono pubblicate classifiche pro capite. Un futuro denominatore dovrà essere
un rilascio ISTAT bloccato e coerente per anno; residenti e contribuenti restano
popolazioni differenti.
