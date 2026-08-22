# Rendiconto finanziario PCM 2024

La pagina `/palazzo-chigi` usa il **Conto finanziario 2024** pubblicato dalla Presidenza del Consiglio dei ministri. Il perimetro è la sola PCM: non comprende i bilanci interni di Camera e Senato e non coincide con il rendiconto dei Ministeri.

## Fonte

- titolare: Presidenza del Consiglio dei ministri;
- pagina ufficiale: `https://presidenza.governo.it/AmministrazioneTrasparente/Bilanci/BilancioPreventivoConsultivo/ContoFinanziario/2024/index.html`;
- risorsa scoperta nella pagina: `Conto finanziario 2024.xlsx`;
- DPCM di approvazione: 10 giugno 2025;
- pubblicazione/aggiornamento della pagina: 19 giugno 2025;
- file: 146.215 byte;
- SHA-256: `7944cb81a7e9f151b44bb5577d380cd8adf9671ddbebcc1ad530b91b90615603`;
- licenza: non dichiarata sulla pagina ufficiale.

## Perimetro e trasformazione

Il workbook contiene 32 colonne, 572 righe dati e una riga finale vuota, esclusa. Tutte le righe appartengono all'esercizio 2024 e allo stato di previsione 19.

La pipeline conserva separatamente:

- stanziamento definitivo di competenza;
- pagato in conto competenza (`C/C`);
- rimasto da pagare in conto competenza;
- impegnato;
- pagato in conto residui (`C/R`).

Per ogni riga il file contiene e riconcilia la formula:

```text
impegnato = pagato in conto competenza + rimasto da pagare in conto competenza
```

Il totale pagato mostrato dalla pagina è una trasformazione esplicita:

```text
pagato totale nell'esercizio = pagato C/C + pagato C/R
```

Stanziamenti, impegni e pagamenti non vengono sommati tra loro. I residui non sono trattati come nuova spesa dell'anno.

## Riproduzione

Aggiornamento dalla fonte ufficiale:

```bash
python3 scripts/etl/pcm_financial_account.py
```

Controllo offline degli artefatti committati:

```bash
python3 scripts/etl/pcm_financial_account.py --check
python3 -m unittest tests/etl/test_pcm_financial_account.py
```

La pipeline fallisce se cambiano intestazioni, esercizio, stato di previsione, copertura, formule o riconciliazioni.
