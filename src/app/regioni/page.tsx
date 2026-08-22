import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { compactEuro, exactEuro, longDate } from "@/lib/format";
import { istatRegionsMetadata, istatRegionsSnapshot } from "@/lib/istat-regions-snapshot";
import { RegionTitleTreemap } from "./region-title-treemap";
import styles from "./regioni.module.css";

export const metadata: Metadata = {
  title: "Spese delle Regioni, consuntivi 2024",
  description:
    "Impegni 2024 dei bilanci consuntivi Istat per 22 amministrazioni regionali e Province autonome, con Titoli esatti e perimetri distinti.",
};

const percentage = new Intl.NumberFormat("it-IT", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const euro = (cents: number) => cents / 100;
const statusLabel = {
  ordinary: "Regione a statuto ordinario",
  special: "Regione a statuto speciale",
  "autonomous-province": "Provincia autonoma",
} as const;

export default async function RegionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ente?: string | string[] }>;
}) {
  const params = await searchParams;
  const selectedId = typeof params.ente === "string" ? params.ente : "piemonte";
  const selected = istatRegionsSnapshot.entities.find((entity) => entity.id === selectedId);
  if (!selected) notFound();
  const source = istatRegionsMetadata.source;

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Spese delle Regioni</h1>
        <p>
          Leggiamo i consuntivi 2024 di 22 amministrazioni: 15 Regioni ordinarie, 5 speciali e
          2 Province autonome. Qui mostriamo impegni, non pagamenti, e non li mescoliamo con
          Comuni, sanità, CPT o residuo fiscale.
        </p>
      </div>

      <form className={styles.selector} action="/regioni" method="get">
        <label htmlFor="ente-regionale">
          Scegli un&apos;amministrazione
          <select id="ente-regionale" name="ente" defaultValue={selected.id}>
            {istatRegionsSnapshot.entities.map((entity) => (
              <option key={entity.id} value={entity.id}>{entity.label}</option>
            ))}
          </select>
        </label>
        <button type="submit">Mostra il consuntivo</button>
      </form>

      <dl className="stat-strip">
        <div>
          <dt>Impegni 2024</dt>
          <dd>{compactEuro(euro(selected.commitmentsCents))}</dd>
          <span className="stat-note">{exactEuro(euro(selected.commitmentsCents))} esatti</span>
        </div>
        <div>
          <dt>Composizione</dt>
          <dd>{selected.titles.length}</dd>
          <span className="stat-note">Titoli riconciliati al totale</span>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{selected.status === "ordinary" ? "Ordinaria" : selected.status === "special" ? "Speciale" : "Provincia"}</dd>
          <span className="stat-note">{statusLabel[selected.status]}</span>
        </div>
      </dl>

      <div className="notice">
        <strong>Non è una classifica tra territori</strong>
        <p>
          Gli importi sono valori assoluti del bilancio di {selected.label}. Senza una popolazione
          Istat bloccata sullo stesso periodo non calcoliamo valori pro capite. Le 22 amministrazioni
          non coincidono con le 20 geometrie regionali, quindi in questa vista non usiamo la mappa.
        </p>
      </div>

      <section className="panel" aria-labelledby="composizione-regionale">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="composizione-regionale">Per cosa sono stati impegnati</h2>
            <p>
              Composizione per Titolo di {selected.label}. Il denominatore è il totale ufficiale
              degli impegni 2024 della stessa amministrazione.
            </p>
          </div>
          <span>Consuntivo definitivo</span>
        </div>
        <RegionTitleTreemap entity={selected} />
        <p className={styles.scrollHint}>Scorri la tabella verso destra per vedere importi e quote.</p>
        <div
          className={`table-scroll ${styles.titleTable}`}
          role="region"
          aria-label={`Valori esatti degli impegni 2024 di ${selected.label} per Titolo`}
          tabIndex={0}
        >
          <table className="table">
            <thead><tr><th scope="col">Titolo</th><th scope="col">Impegni 2024</th><th scope="col">Quota</th></tr></thead>
            <tbody>
              {selected.titles.map((title) => (
                <tr key={title.code}>
                  <th scope="row">{title.label}</th>
                  <td>{exactEuro(euro(title.commitmentsCents))}</td>
                  <td>{percentage.format(title.commitmentsCents / selected.commitmentsCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th scope="row">Totale ufficiale</th><td>{exactEuro(euro(selected.commitmentsCents))}</td><td>{percentage.format(1)}</td></tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="copertura-regioni">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="copertura-regioni">Tutte le amministrazioni nel file</h2>
            <p>Valori esatti per consultazione. L&apos;ordine non è una graduatoria.</p>
          </div>
          <span>22 su 22</span>
        </div>
        <p className={styles.statusNote}>
          Statuto ordinario, statuto speciale e Province autonome restano visibili perché competenze
          e assetti non sono equivalenti. Non calcoliamo una media comune.
        </p>
        <p className={styles.scrollHint}>Scorri la tabella verso destra per vedere gli importi.</p>
        <div className={`table-scroll ${styles.allEntitiesTable}`} role="region" aria-label="Impegni esatti delle 22 amministrazioni regionali" tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">Amministrazione</th><th scope="col">Tipo</th><th scope="col">Impegni 2024</th></tr></thead>
            <tbody>
              {istatRegionsSnapshot.entities.map((entity) => (
                <tr key={entity.id}>
                  <th scope="row">{entity.label}</th>
                  <td>{statusLabel[entity.status]}</td>
                  <td>{exactEuro(euro(entity.commitmentsCents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="fonte-regioni">
        <h2 className="panel-title" id="fonte-regioni">Fonte, periodo e controlli</h2>
        <div className={styles.provenance}>
          <div><span>Titolare</span><strong>{source.owner}</strong></div>
          <div><span>Pubblicato</span><strong>{longDate(source.publishedAt)}</strong></div>
          <div><span>Controllato da noi</span><strong>{longDate(source.acquiredAt)}</strong></div>
          <div><span>Copertura</span><strong>22 amministrazioni · 22 totali riconciliati</strong></div>
        </div>
        <p className={styles.statusNote}>
          Fonte {source.sourceRecordId}, foglio “{selected.sourceSheet}”. Abbiamo escluso i tre
          fogli aggregati Italia, Regioni ordinarie e Regioni speciali; per ogni amministrazione
          la somma dei sei Titoli coincide con il totale ufficiale. La pagina Istat non dichiara
          una licenza per l&apos;archivio: non ne attribuiamo una.
        </p>
        <div className={styles.sourceLinks}>
          <a href={source.landingUrl} target="_blank" rel="noreferrer">Apri la pagina Istat ↗</a>
          <a href={source.resourceUrl} target="_blank" rel="noreferrer">Scarica le tavole ufficiali ↗</a>
        </div>
      </section>
    </main>
  );
}
