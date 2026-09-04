import "server-only";

import type { IstatTurnoverSource } from "@/lib/istat-turnover-contract";

/**
 * Lightweight source metadata for pages that do not need the observations.
 *
 * Keep this artifact in sync with `source` in the generated ISTAT turnover
 * snapshot. It is deliberately separate from `istat-turnover.ts`: the sources
 * page should not parse or validate the snapshot just to render provenance.
 * The parity gate in `tests/istat-enterprise-turnover.test.mjs` fails if a
 * refresh leaves this metadata stale.
 */
export const istatTurnoverSourceMetadata = {
  id: "istat-frame-territoriale-2024",
  label: "Stima anticipata dei dati economici delle imprese · Frame Territoriale 2024",
  publisher: "Istituto Nazionale di Statistica (ISTAT)",
  url: "https://www.istat.it/wp-content/uploads/2026/03/Tavole20marzo2026.zip",
  archive: {
    bytes: 393392,
    sha256: "d774bcd5862467aa0a7529b8b972f3fd80f85f14f7993aaf355362596960ad04",
  },
  landingUrl: "https://www.istat.it/tavole-di-dati/stima-anticipata-dei-dati-economici-delle-imprese-a-livello-territoriale-il-registro-frame-territoriale-anticipato-anno-2024/",
  license: "CC BY 4.0",
  licenseUrl: "https://www.istat.it/dati/open-data/",
  updatedAt: "2026-03-20",
  observedAt: "2026-08-26T00:00:00+02:00",
  cadence: "annuale",
  coverage: "Unità locali di imprese con almeno un dipendente (Registro Frame Territoriale Anticipato 2024); non è l'universo completo delle sedi attive.",
  caveat: "I dati si riferiscono alle unità locali di imprese con almeno un dipendente (Registro Frame Territoriale Anticipato 2024) e non all'universo completo delle sedi attive. Il fatturato è espresso in migliaia di euro e classificato in ATECO 2007 aggiornamento 2022. I dati sono aggregati per territorio e non identificano singole aziende o persone fisiche. Le tavole del totale e dei macro-settori sono pubblicate separatamente: differenze di pochi migliaia di euro tra somme e totale sono mantenute e possono riflettere gli arrotondamenti della fonte.",
} as const satisfies IstatTurnoverSource;
