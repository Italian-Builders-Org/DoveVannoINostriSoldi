# Presenze al voto alla Camera

Quaderno DVNS sulla distribuzione ufficiale della partecipazione alle votazioni
elettroniche alla Camera (XIX legislatura, fino a febbraio 2026).

## Pubblicazione

- Pagina HTML: `/studi/presenze-camera`
- PDF versionato: `public/studi/presenze-camera/v1/presenze-camera.pdf`
- Copia di ricerca: `paper/presenze-camera.pdf` (byte identici al PDF pubblico)
- Capsule congelata: `src/content/studies/camera-presenze.json`
- Tabella di lavoro: `generated/distribution.json`

## Fonte primaria

Camera dei deputati, tabella «Partecipazione al voto» (vista deputati,
riepilogo cumulativo fino a febbraio 2026):

https://www.camera.it/deputati/statistiche_voto/vista?leg=19&type=deputati&riepil_mese_end=2026-02-28

Lo snapshot validato nel repository e
`src/data/generated/camera-partecipazione-voto.json`. I numeri pubblicati nello
studio sono congelati nella capsule e non ricalcolati a ogni visita.

## Limiti

Presenza = voti espressi + missioni. Le missioni non sono presenza fisica in
Aula. Il lavoro in commissione non è incluso. Il Senato non pubblica una
tabella ufficiale equivalente. Solo i deputati con match anagrafico entrano
nella distribuzione.

## Ricostruzione

```bash
python3 research/camera-presenze-voto/freeze.py
node --experimental-strip-types research/camera-presenze-voto/render-pdf.mjs
```
