# Contributi obbligatori e destinazioni IRPEF

Verifica delle proposte #571, #572, #573 e #569, al 15 ottobre 2026.
Le sei coperture non erano presenti come dataset dedicati. L'issue #675 è una
segnalazione della proposta #569, non una prova dell'integrazione.

## Pubblicato con questo import

ARERA, rendiconti della gestione 2024 e 2025:

- `arera-entrate-2024-2025`: 54 record, capitoli al V livello con codice ARERA.
- `arera-spese-2024-2025`: 6 record, titoli al I livello.

Le righe passano dal corpus integrato e sono disponibili su `/dati`, nelle API
del corpus e attraverso le query integrate del server MCP. `/fonti` collega le
viste. Il tool MCP esistente usa `dataset: "spesa_pa_dettaglio"` e
`code: "arera-entrate-2024-2025"` oppure `code: "arera-spese-2024-2025"`.
Nessuna acquisizione alla visita e nessun nuovo servizio a pagamento.

Fonti: allegati A alle delibere [164/2025/A](https://www.arera.it/atti-e-provvedimenti/dettaglio/25/164-25)
e [137/2026/A](https://www.arera.it/atti-e-provvedimenti/dettaglio/26/137-26).
Pubblicazioni: 16 aprile 2025 e 5 maggio 2026; acquisizione: 15 ottobre 2026.
Byte originali, SHA-256, fogli e date sono vincolati in
`scripts/etl/specs/arera-bilanci.source.json`.

I [termini ARERA](https://www.arera.it/termini-e-condizioni-uso-del-sito) dichiarano
**CC BY-SA 4.0**. L'attribuzione e la condivisione degli adattamenti con la stessa
licenza si applicano ai dati derivati; la licenza del codice non le sostituisce.
La copia dei termini è conservata con hash nella fixture.

Previsioni, accertamenti/impegni, riscossioni/pagamenti di competenza, residui e
cassa hanno colonne distinte. I titoli gerarchici non sono sommati ai capitoli;
l'avanzo è escluso dalle entrate. Le partite di giro sono incluse e riconoscibili.
Gli importi sono espressi al centesimo, come nel formato visualizzato dei fogli;
le approssimazioni binarie XLSX inferiori a un milionesimo di euro non alterano
il centesimo. Le celle vuote restano mancanti, gli zeri osservati restano zero.

Il controllo offline ricostruisce tutte le righe dagli XLSX, verifica periodo,
identità uniche e riconciliazioni con i totali di competenza, residui e cassa.
Le uscite sono limitate ai titoli: alcuni riepiloghi del dettaglio al V livello
non coincidono con la somma dei capitoli. Non sono stati corretti arbitrariamente
né trasformati in accuse di spreco. Per esempio, nel 2024 la somma dei pagamenti
complessivi dei capitoli con codice ARERA è 157.830.783,24 euro, contro
157.830.785,24 euro nel totale; nel 2025 sono 99.134.029,06 contro 99.134.031,06.
I titoli al I livello riconciliano esattamente con i totali pubblicati.

Aggiornamento manuale: acquisire la nuova annualità, rivedere hash, intestazioni,
periodo, licenza e riconciliazioni prima di modificare il contratto. Poi:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python scripts/etl/arera_bilanci.py --publish
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python scripts/etl/arera_bilanci.py --check
```

## Coperture ancora aperte

| Proposta | Riscontro | Passo necessario |
| --- | --- | --- |
| #571, consorzi di bonifica | Tevere e Agro Romano è confluito nel Litorale Nord. Il [portale trasparenza del successore](https://www.consorziobonificalitoralenord.it/amministrazione-trasparente/) pubblica i consuntivi. I rendiconti 2024 e 2025 di [Ragusa](https://www.consorziobonifica8rg.it/amministrazione-trasparente/bilanci/bilancio-preventivo-e-consuntivo.html) sono scansioni: nessuna tabella testuale estraibile. | Ottenere esportazioni strutturate o definire un'estrazione PDF con verifica indipendente delle righe e dei totali; verificare il riuso per ogni consorzio. Nessun totale nazionale da un pilota. |
| #572, autorità indipendenti | Primo pilota ARERA disponibile. Non comprende ANAC, AGCOM, AGCM, ART, CONSOB o IVASS. | Ampliare un'autorità alla volta con rendiconti e licenze verificati. Gli appalti ANAC già presenti non sono entrate contributive. |
| #573, EPR | [CONAI](https://www.conai.org/termini-e-condizioni/) pone limiti al riuso, anche commerciale. Non è una licenza aperta. | Chiarire le condizioni del file da pubblicare o scegliere un'altra fonte ufficiale con riuso verificato. Distinguere contributi raccolti e corrispettivi distribuiti; nessuna assimilazione automatica a tributi della PA. |
| #569, 8 per mille | [MEF](https://www1.finanze.gov.it/finanze/pagina_dichiarazioni/public/ottoxmille.php): serie ufficiale individuata; la discussione segnala clausole generali di copyright. | Verificare le condizioni specifiche del dataset rispetto al copyright generale. Separare anno fiscale, dichiarazione, riparto e pagamento; non colmare importi non pubblicati. |
| #569, 5 per mille | [Agenzia delle Entrate](https://www.agenziaentrate.gov.it/portale/elenco-complessivo-dei-beneficiari): CSV AF 2024 in sette parti, aggiornati al 17 giugno 2026. Nessuna licenza esplicita verificata nella pagina o nel collegamento privacy. | Chiarire il riuso, poi acquisire e riconciliare tutte le parti originali, inclusi casi duplicati/esclusi. I totali del CSV allegato dal contributore non sono ancora certificati da DVNS. |
| #569, 2 per mille | [MEF, dichiarazioni 2025](https://www1.finanze.gov.it/finanze/2xmille/public/index.php?tree=2025AADUEXM0101): tabella ufficiale individuata. | Verificare il riuso specifico e le somme originali; distinguere scelte e somme attribuite dai pagamenti. |

La mancata verifica di una licenza non dimostra un divieto generale di riuso.
Queste righe documentano ciò che manca prima della pubblicazione; non dichiarano
concluse le proposte. I semplici collegamenti esterni su `/fonti` non sono contati
come nuovi dataset integrati.
