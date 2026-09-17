# Certificato intermedio OpenCivitas

Il server `docs.opencivitas.it` non invia il certificato intermedio necessario
per completare la catena TLS. L'ETL mantiene la verifica TLS e aggiunge soltanto
il certificato pubblico mancante:

- soggetto: `Sectigo Public Server Authentication CA OV R36`;
- fonte AIA dichiarata dal certificato del server: `http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt`;
- SHA-256: `65:42:D1:76:BE:D5:0F:19:3C:0C:E2:97:AE:44:EC:D8:A0:A8:6B:EC:2E:DE:68:27:69:34:40:59:B4:E7:85:30`;
- validità: 22 marzo 2021 - 21 marzo 2036.

Il certificato è stato verificato contro la radice già presente nel trust store.
Non vengono disattivati i controlli TLS e non viene usato un proxy.
