import type { OpenCupProjectRow } from "../src/lib/opencup-projects-index";

declare const row: OpenCupProjectRow;

function acceptsPublicCell(value: string | null): void {
  void value;
}

acceptsPublicCell(row.cells.CUP);
acceptsPublicCell(row.cells.DESCRIZIONE_SINTETICA_CUP);

// The projects release has no geography: a consumer must join a dedicated source.
// @ts-expect-error COMUNE is not part of the public OpenCUP projects projection.
acceptsPublicCell(row.cells.COMUNE);

export {};
