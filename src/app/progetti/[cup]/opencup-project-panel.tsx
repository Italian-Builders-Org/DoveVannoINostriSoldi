"use client";

import { useRef, useState } from "react";
import type { OpenCupProjectSelection } from "@/lib/integrated-public-view";
import { formatOpenCupEuro } from "@/lib/opencup-money";
import styles from "./project.module.css";

type OpenCupRow = OpenCupProjectSelection["rows"][number];

function shown(value: string | null | undefined): string {
  return value?.trim() || "non disponibile";
}

function OpenCupRecord({ row, ordinal }: { row: OpenCupRow; ordinal: number }) {
  return (
    <details className={styles.openCupRecord} open={ordinal === 1}>
      <summary>
        <span>Registrazione {ordinal}</span>
        <strong>{shown(row.cells.DESCRIZIONE_SINTETICA_CUP)}</strong>
        <small>riga fonte {row.sourceRow.toLocaleString("it-IT")}</small>
      </summary>
      <div className={styles.openCupRecordBody}>
        <dl className={styles.definitionGrid}>
          <div><dt>Stato anagrafico</dt><dd>{shown(row.cells.STATO_PROGETTO)}</dd></div>
          <div><dt>Data generazione CUP</dt><dd>{shown(row.cells.DATA_GENERAZIONE_CUP)}</dd></div>
          <div><dt>Costo dichiarato</dt><dd>{formatOpenCupEuro(row.cells.COSTO_PROGETTO)}</dd></div>
          <div><dt>Finanziamento richiesto</dt><dd>{formatOpenCupEuro(row.cells.FINANZIAMENTO_PROGETTO)}</dd></div>
          <div><dt>Soggetto titolare</dt><dd>{shown(row.cells.SOGGETTO_TITOLARE)}</dd></div>
          <div><dt>Natura</dt><dd>{shown(row.cells.NATURA_INTERVENTO)}</dd></div>
          <div><dt>Tipologia</dt><dd>{shown(row.cells.TIPOLOGIA_INTERVENTO)}</dd></div>
          <div><dt>Localizzazione dichiarata</dt><dd>{[row.cells.COMUNE, row.cells.REGIONE].filter(Boolean).join(" · ") || "non disponibile"}</dd></div>
        </dl>
      </div>
    </details>
  );
}

export function OpenCupProjectPanel({ initial }: { initial: OpenCupProjectSelection }) {
  const [rows, setRows] = useState(initial.rows);
  const [nextCursor, setNextCursor] = useState(initial.pagination.nextCursor);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sourceUrl = initial.dataset.sourceMetadata.canonicalUrls[0];

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setStatus("Caricamento di altre registrazioni OpenCUP.");
    try {
      const params = new URLSearchParams({
        cup: initial.filters.cup,
        limit: String(initial.pagination.limit),
        cursor: nextCursor,
      });
      const response = await fetch(`/api/opencup/progetti?${params.toString()}`);
      if (!response.ok) throw new Error("OpenCUP non disponibile");
      const page = await response.json() as OpenCupProjectSelection;
      setRows((current) => [...current, ...page.rows]);
      setNextCursor(page.pagination.nextCursor);
      setStatus(`${page.rows.length} registrazioni aggiunte. ${rows.length + page.rows.length} di ${initial.matchedRows} mostrate.`);
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus("Non è stato possibile caricare altre registrazioni. Riprova.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.openCupPanel} aria-labelledby="opencup-title">
      <div className={styles.sectionHeading}>
        <h2 id="opencup-title" ref={headingRef} tabIndex={-1}>Registrazioni OpenCUP</h2>
        <p>{initial.matchedRows.toLocaleString("it-IT")} registrazioni nel rilascio consultato. Le righe duplicate della fonte restano distinte.</p>
      </div>
      <div className={styles.openCupList}>
        {rows.map((row, index) => (
          <OpenCupRecord key={`${row.id}-${row.sourceRow}`} row={row} ordinal={index + 1} />
        ))}
      </div>
      {initial.dataset.evidenceLabel === "synthetic-fixture" ? (
        <p className="notice">Dati sintetici di test: non sono evidenze della fonte OpenCUP.</p>
      ) : null}
      <p className={styles.caveat}>Il costo dichiarato e il finanziamento richiesto sono grandezze diverse. Il finanziamento non è un pagamento osservato e lo stato anagrafico non misura l’avanzamento contabile. La candidatura PNRR in OpenCUP non certifica l’ammissione al Piano.</p>
      <div className={styles.openCupProvenance}>
        <p>Fonte: {sourceUrl ? <a href={sourceUrl}>OpenCUP · DIPE</a> : "non disponibile"}</p>
        <p>Pubblicazione: {initial.dataset.sourceMetadata.publicationDate ?? "data non disponibile"}</p>
        <p>Release manifest: <code>{initial.releaseId}</code></p>
      </div>
      <div className={styles.actions}>
        {nextCursor ? (
          <button className="btn btn-secondary" type="button" onClick={loadMore} disabled={loading}>
            {loading ? "Caricamento…" : "Mostra altre registrazioni"}
          </button>
        ) : null}
        <a className="btn btn-secondary" href={`/api/opencup/progetti?cup=${initial.filters.cup}`}>JSON OpenCUP</a>
      </div>
      <p className={styles.liveStatus} aria-live="polite">{status}</p>
    </section>
  );
}
