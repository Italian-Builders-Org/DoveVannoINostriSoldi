import Link from "next/link";
import { integer } from "@/lib/format";
import type { EditorialSurfacePreview } from "@/lib/integrated-editorial";
import { getIntegratedDataOverview } from "@/lib/integrated-public-view";
import styles from "./integrated-surface-preview.module.css";

type Props = Readonly<{
  preview: EditorialSurfacePreview;
}>;

export default async function IntegratedSurfacePreview({ preview }: Props) {
  const overview = await getIntegratedDataOverview();
  const catalogById = new Map(overview.datasets.map((dataset) => [dataset.id, dataset]));
  const datasets = preview.datasets.slice(0, 3).map((configured) => {
    const dataset = catalogById.get(configured.id);
    if (!dataset) {
      throw new Error(`Dataset editoriale non presente nel catalogo: ${configured.id}`);
    }
    return { configured, dataset };
  });

  return (
    <section className={`panel ${styles.preview}`} aria-labelledby="partecipazioni-approfondimenti">
      <div className={styles.heading}>
        <div>
          <h2 id="partecipazioni-approfondimenti">{preview.title}</h2>
          <p>{preview.description}</p>
        </div>
        <Link href="/dati">Tutti i dati integrati</Link>
      </div>

      <ul className={styles.rows}>
        {datasets.map(({ configured, dataset }) => (
          <li key={dataset.id}>
            <div className={styles.metric}>
              <strong>{integer(dataset.sourceRows)}</strong>
              <span>righe sorgente</span>
            </div>
            <div className={styles.copy}>
              <h3><Link href={`/dati/${dataset.id}`}>{configured.label}</Link></h3>
              <p>
                {!dataset.queryable && configured.catalogBoundary
                  ? configured.catalogBoundary
                  : dataset.caveats[0] ?? dataset.publicationNote}
              </p>
            </div>
            <div className={styles.action}>
              <span className={dataset.queryable ? "tag tag-accent" : "tag tag-neutral"}>
                {dataset.queryable ? "Interrogabile" : "Catalogato"}
              </span>
              <Link href={`/dati/${dataset.id}`}>Apri dati e fonti</Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
