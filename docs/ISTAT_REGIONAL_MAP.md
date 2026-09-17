# Mappa regionale ISTAT

La mappa della home usa i **confini delle unità amministrative a fini statistici ISTAT al 1 gennaio 2026**, versione generalizzata, con licenza CC BY 4.0.

- fonte ufficiale: `https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip`;
- SHA-256 verificato: `b011a590656c3a3ebc297fba80726a376aa843b6f164641cf6a4a990021a81d6`;
- layer: `Reg01012026_g/Reg01012026_g_WGS84.shp`;
- chiave di join: `COD_REG`, codice ISTAT univoco della regione;
- output versionato: `src/data/generated/italy-regions.ts`.

Il file generato contiene soltanto i 20 path SVG semplificati e i relativi codici. Nessuna geometria viene scaricata nel browser e non serve una libreria cartografica a runtime.

## Rigenerazione

Scaricare il pacchetto ufficiale, verificarne il checksum, estrarre il layer regionale e lanciare:

```bash
node scripts/maps/generate_italy_regions.mjs \
  src/data/generated/italy-regions.ts \
  /percorso/Limiti01012026_g.zip
```

Il generatore verifica lo SHA-256 dello ZIP ufficiale, legge `.shp` e `.dbf` direttamente dall'archivio verificato e rifiuta input che non contengano esattamente 20 record e 20 geometrie. Il test `tests/italy-regions.test.mjs` verifica la bijezione fra codici ISTAT, nomi delle regioni SIOPE e path prodotti.

## Significato della visualizzazione

Il colore rappresenta i **pagamenti di cassa dei Comuni per abitante della popolazione coperta**. L'aggregazione regionale segue la sede dell'ente ricavata tramite IPA: non localizza fisicamente dove la spesa è avvenuta e non misura efficienza, qualità o merito amministrativo.

Attribuzione mostrata nell'interfaccia:

> Confini amministrativi a fini statistici: ISTAT, 1 gennaio 2026, CC BY 4.0; geometria semplificata da DoveVannoINostriSoldi.
