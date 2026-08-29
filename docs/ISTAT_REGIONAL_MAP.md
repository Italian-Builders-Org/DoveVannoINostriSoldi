# Mappa regionale e provinciale ISTAT

La mappa della home usa i **confini delle unità amministrative a fini statistici ISTAT al 1 gennaio 2026**, versione generalizzata, con licenza CC BY 4.0.

- fonte ufficiale: `https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip`;
- SHA-256 verificato: `b011a590656c3a3ebc297fba80726a376aa843b6f164641cf6a4a990021a81d6`;
- layer regionali: `Reg01012026_g/Reg01012026_g_WGS84.shp`;
- layer provinciali: `ProvCM01012026_g/ProvCM01012026_g_WGS84.shp`;
- chiave di join: `COD_REG`, codice ISTAT univoco della regione;
- output versionati: `src/data/generated/italy-regions.ts` e `src/data/generated/italy-provinces.ts`.

I file generati contengono soltanto i 20 path regionali e i 110 path provinciali semplificati, con i relativi codici. Nessuna geometria viene scaricata nel browser e non serve una libreria cartografica a runtime.

Entrambi i layer usano la stessa proiezione nazionale `istat-2026-regional-envelope-560x640-p12-v1`, calcolata una sola volta sull'inviluppo del layer regionale. Il metadato di proiezione viene scritto in entrambi gli output e confrontato nei test. In questo modo i confini provinciali e i contorni regionali sono sovrapponibili senza correzioni CSS o trasformazioni specifiche per layer.

## Rigenerazione

Scaricare il pacchetto ufficiale, verificarne il checksum, estrarre il layer regionale e lanciare:

```bash
node scripts/maps/generate_italy_regions.mjs \
  src/data/generated/italy-regions.ts \
  /percorso/Limiti01012026_g.zip \
  regions

node scripts/maps/generate_italy_regions.mjs \
  src/data/generated/italy-provinces.ts \
  /percorso/Limiti01012026_g.zip \
  provinces
```

Il generatore verifica lo SHA-256 dello ZIP ufficiale, legge `.shp` e `.dbf` direttamente dall'archivio verificato e rifiuta input che non contengano esattamente 20 regioni o 110 province. Il test `tests/italy-regions.test.mjs` verifica copertura, codici, path e identità del metadato di proiezione dei due layer.

## Significato della visualizzazione

Nella mappa estesa il colore rappresenta i **pagamenti di cassa dei Comuni per abitante della popolazione coperta**, aggregati per regione. Nella mappa compatta della home, quando sono disponibili i dati provinciali, **i colori rappresentano le province**, mentre hover, clic, tastiera, contorno e pannello di dettaglio continuano a identificare la **regione**. Il layer regionale è quindi il bersaglio interattivo, non una seconda scala cromatica.

Le aggregazioni seguono la sede dell'ente ricavata tramite IPA: non localizzano fisicamente dove la spesa è avvenuta e non misurano efficienza, qualità o merito amministrativo.

Attribuzione mostrata nell'interfaccia:

> Confini amministrativi a fini statistici: ISTAT, 1 gennaio 2026, CC BY 4.0; geometria semplificata da DoveVannoINostriSoldi.
