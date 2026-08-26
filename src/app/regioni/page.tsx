import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { compactEuro, exactEuro, longDate } from "@/lib/format";
import { istatRegionsMetadata, istatRegionsSnapshot } from "@/lib/istat-regions-snapshot";
import { siopeTitleCopy } from "@/lib/siope-titles";
import { RegionTitleTreemap } from "./region-title-treemap";
import styles from "./regioni.module.css";

export const metadata: Metadata = {
  title: "Spese delle Regioni, consuntivi 2024",
  description:
    "Composizione degli impegni 2024 di Regioni e Province autonome, con voci leggibili e importi esatti.",
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
          Composizione degli impegni 2024 di {selected.label}: voci di bilancio, importi e quote
          sul totale ufficiale. La fonte è il consuntivo Istat delle amministrazioni regionali.
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
          <dt>Voci nel bilancio</dt>
          <dd>{selected.titles.length}</dd>
          <span className="stat-note">Somma uguale al totale ufficiale</span>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{selected.status === "ordinary" ? "Ordinaria" : selected.status === "special" ? "Speciale" : "Provincia"}</dd>
          <span className="stat-note">{statusLabel[selected.status]}</span>
        </div>
      </dl>

      <div className="notice">
        <strong>Perimetro di lettura</strong>
        <p>
          Sono gli impegni assoluti di {selected.label}. Senza popolazione Istat dello stesso anno
          non calcoliamo il pro capite e non usiamo la mappa.
        </p>
      </div>

      <section className="panel" aria-labelledby="composizione-regionale">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="composizione-regionale">Composizione degli impegni</h2>
            <p>
              Voci del bilancio di {selected.label}. Il totale coincide con il consuntivo ufficiale
              2024.
            </p>
          </div>
          <span>Consuntivo definitivo</span>
        </div>
        <RegionTitleTreemap entity={selected} />
        <p className={styles.scrollHint}>Scorri la tabella verso destra per vedere importi e quote.</p>
        <div
          className={`table-scroll ${styles.titleTable}`}
          role="region"
          aria-label={`Valori esatti dei soldi impegnati nel 2024 da ${selected.label}`}
          tabIndex={0}
        >
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Voce</th>
                <th scope="col">Impegnato 2024</th>
                <th scope="col">Quota</th>
              </tr>
            </thead>
            <tbody>
              {selected.titles.map((title) => {
                const copy = siopeTitleCopy(title.code, "regione");
                return (
                  <tr key={title.code}>
                    <th scope="row">
                      {copy.name}
                      <small>{copy.explanation}</small>
                    </th>
                    <td>{exactEuro(euro(title.commitmentsCents))}</td>
                    <td>{percentage.format(title.commitmentsCents / selected.commitmentsCents)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Totale ufficiale</th>
                <td>{exactEuro(euro(selected.commitmentsCents))}</td>
                <td>{percentage.format(1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="copertura-regioni">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="copertura-regioni">Amministrazioni nel file</h2>
            <p>Importi ufficiali in ordine di consultazione.</p>
          </div>
          <span>22 su 22</span>
        </div>
        <p className={styles.statusNote}>
          Regioni a statuto ordinario, speciali e Province autonome restano distinte: hanno
          assetti e competenze diversi.
        </p>
        <p className={styles.scrollHint}>Scorri la tabella verso destra per vedere gli importi.</p>
        <div className={`table-scroll ${styles.allEntitiesTable}`} role="region" aria-label="Impegni esatti delle 22 amministrazioni regionali" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Territorio</th>
                <th scope="col">Tipo</th>
                <th scope="col">Impegnato 2024</th>
              </tr>
            </thead>
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
        <h2 className="panel-title" id="fonte-regioni">Fonte e controlli</h2>
        <div className={styles.provenance}>
          <div><span>Titolare</span><strong>{source.owner}</strong></div>
          <div><span>Pubblicato</span><strong>{longDate(source.publishedAt)}</strong></div>
          <div><span>Controllato da noi</span><strong>{longDate(source.acquiredAt)}</strong></div>
          <div><span>Copertura</span><strong>22 territori · 22 totali riconciliati</strong></div>
        </div>
        <p className={styles.statusNote}>
          Fonte {source.sourceRecordId}, foglio “{selected.sourceSheet}”. Abbiamo escluso i tre
          fogli aggregati Italia, Regioni ordinarie e Regioni speciali. Per ogni territorio la
          somma delle voci coincide con il totale ufficiale. La pagina Istat non dichiara una
          licenza: non ne inventiamo una.
        </p>
        <div className={styles.sourceLinks}>
          <a href={source.landingUrl} target="_blank" rel="noreferrer">Apri la pagina Istat ↗</a>
          <a href={source.resourceUrl} target="_blank" rel="noreferrer">Scarica le tavole ufficiali ↗</a>
        </div>
      </section>
    </main>
  );
}
