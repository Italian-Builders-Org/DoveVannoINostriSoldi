import type { OpenCivitasMunicipality } from "@/lib/data/opencivitas-contract";
import { HorizontalScrollRegion } from "@/components/horizontal-scroll-region";
import { compactEuroFromCents, exactEuro, integer } from "@/lib/format";
import {
  OPEN_CIVITAS_QUADRANT_THRESHOLD,
  summarizeOpenCivitasQuadrants,
  type OpenCivitasQuadrant,
  type OpenCivitasQuadrantKey,
} from "@/lib/opencivitas-quadrants";
import styles from "./opencivitas-quadrants.module.css";

type OpenCivitasQuadrantsProps = {
  municipalities: readonly OpenCivitasMunicipality[];
  referenceYear: number;
  territorialScope: string;
  source: Readonly<{
    owner: string;
    dataset: string;
    datasetUrl: string;
    license: string;
  }>;
};

const QUADRANT_ORDER: readonly OpenCivitasQuadrantKey[] = [
  "low-high",
  "high-high",
  "low-low",
  "high-low",
];

const QUADRANT_COPY: Record<OpenCivitasQuadrantKey, Readonly<{
  title: string;
  description: string;
}>> = {
  "low-low": {
    title: "Spesa da 0 a 5 · servizi da 0 a 5",
    description: "Entrambi i livelli pubblicati sono sotto la soglia descrittiva.",
  },
  "low-high": {
    title: "Spesa da 0 a 5 · servizi da 6 a 10",
    description: "Il livello della spesa è sotto soglia; quello dei servizi è almeno 6.",
  },
  "high-low": {
    title: "Spesa da 6 a 10 · servizi da 0 a 5",
    description: "Il livello della spesa è almeno 6; quello dei servizi è sotto soglia.",
  },
  "high-high": {
    title: "Spesa da 6 a 10 · servizi da 6 a 10",
    description: "Entrambi i livelli pubblicati sono almeno 6.",
  },
};

function signedEuro(cents: number, compact = false): string {
  const value = compact ? compactEuroFromCents(cents) : exactEuro(cents / 100);
  return cents > 0 ? `+${value}` : value;
}

function bandLabel(band: "low" | "high"): string {
  return band === "high" ? "da 6 a 10" : "da 0 a 5";
}

function quadrantLabel(quadrant: OpenCivitasQuadrant): string {
  return `${QUADRANT_COPY[quadrant.key].title}: ${integer(quadrant.municipalities)} Comuni`;
}

export function OpenCivitasQuadrants({
  municipalities,
  referenceYear,
  territorialScope,
  source,
}: OpenCivitasQuadrantsProps) {
  const summary = summarizeOpenCivitasQuadrants(municipalities);
  const quadrantsByKey = new Map(summary.quadrants.map((quadrant) => [quadrant.key, quadrant]));
  const orderedQuadrants = QUADRANT_ORDER.flatMap((key) => {
    const quadrant = quadrantsByKey.get(key);
    return quadrant ? [quadrant] : [];
  });

  return (
    <section className={`panel ${styles.module}`} aria-labelledby="opencivitas-quadrants-title">
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>OpenCivitas · lettura descrittiva</p>
          <h2 className="panel-title" id="opencivitas-quadrants-title">
            Quattro profili nel confronto comunale
          </h2>
          <p className={styles.intro}>
            Ogni Comune è collocato usando il livello della spesa e il livello dei servizi pubblicati
            dalla fonte. La soglia adottata qui è {OPEN_CIVITAS_QUADRANT_THRESHOLD}: i gruppi non sono
            una graduatoria e non spiegano da soli le differenze tra Comuni. Il riepilogo usa l’intero
            perimetro OpenCivitas: i filtri della tabella comunale successiva non modificano questi profili.
          </p>
        </div>
        <dl className={styles.coverage}>
          <div>
            <dt>Comuni coperti</dt>
            <dd>{integer(summary.coveredMunicipalities)}</dd>
          </div>
          <div>
            <dt>Livelli completi</dt>
            <dd>{integer(summary.completeMunicipalities)}</dd>
          </div>
        </dl>
      </header>

      <figure className={styles.figure} aria-labelledby="opencivitas-plot-title">
        <div className={styles.plotHeading}>
          <div>
            <h3 id="opencivitas-plot-title">Livello dei servizi e livello della spesa</h3>
            <p>
              Distribuzione dei Comuni per i quali sono disponibili entrambi i livelli da 0 a 10. I testi dentro
              ogni riquadro riportano sempre la stessa informazione del colore.
            </p>
          </div>
          <p className={styles.scaleNote}>Soglia: livello {OPEN_CIVITAS_QUADRANT_THRESHOLD}</p>
        </div>

        <div className={styles.chartFrame}>
          <p className={styles.yAxisLabel}>Livello dei servizi · da 0 a 10</p>
          <div className={styles.plotWrap}>
            <div
              className={styles.plot}
              role="group"
              aria-label={`Distribuzione dei ${integer(summary.completeMunicipalities)} Comuni con livelli completi`}
            >
              {orderedQuadrants.map((quadrant) => (
                <article
                  className={styles.quadrant}
                  data-quadrant={quadrant.key}
                  key={quadrant.key}
                  aria-label={quadrantLabel(quadrant)}
                >
                  <p className={styles.quadrantBands}>
                    Spesa {bandLabel(quadrant.spendingBand)} · servizi {bandLabel(quadrant.serviceBand)}
                  </p>
                  <h4>{QUADRANT_COPY[quadrant.key].title}</h4>
                  <p className={styles.quadrantDescription}>{QUADRANT_COPY[quadrant.key].description}</p>
                  <p className={styles.count}>
                    <strong>{integer(quadrant.municipalities)}</strong> <span>Comuni</span>
                  </p>
                  <dl className={styles.quadrantTotals}>
                    <div>
                      <dt>Spesa storica</dt>
                      <dd>{compactEuroFromCents(quadrant.historicalSpendingCents)}</dd>
                    </div>
                    <div>
                      <dt>Fabbisogno standard</dt>
                      <dd>{compactEuroFromCents(quadrant.standardSpendingCents)}</dd>
                    </div>
                    <div>
                      <dt>Differenza</dt>
                      <dd>{signedEuro(quadrant.differenceCents, true)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            <div className={styles.xAxis} aria-hidden="true">
              <span>Spesa sotto soglia</span>
              <span>Livello della spesa · da 0 a 10</span>
              <span>Spesa almeno 6</span>
            </div>
          </div>
        </div>
        <figcaption className={styles.caption}>
          La soglia divide i livelli pubblicati tra valori da 0 a 5 e valori da 6 a 10. La differenza monetaria è spesa
          storica meno fabbisogno standard: non è una misura di efficienza, spreco o risparmio.
        </figcaption>
      </figure>

      <section className={styles.detail} aria-labelledby="opencivitas-exact-title">
        <div className={styles.detailHeading}>
          <div>
            <h3 id="opencivitas-exact-title">Numeri esatti per profilo</h3>
            <p>
              Somme calcolate in centesimi sulle {integer(summary.completeMunicipalities)} osservazioni
              complete; la differenza è riconciliata come spesa storica meno fabbisogno standard.
            </p>
          </div>
          <span className={styles.completeTag}>Totale completo: {integer(summary.completeMunicipalities)}</span>
        </div>
        <p className={styles.scrollInstruction} id="opencivitas-exact-description">
          Su schermi stretti puoi scorrere la tabella orizzontalmente; quando la regione è a fuoco,
          Freccia destra/sinistra e Home/Fine spostano la vista.
        </p>
        <HorizontalScrollRegion
          ariaDescribedBy="opencivitas-exact-description"
          ariaLabel="Tabella esatta dei profili OpenCivitas. Scorri orizzontalmente per vedere tutte le colonne."
          className={styles.tableScroll}
        >
          <table className={`table ${styles.table}`}>
            <caption>
              OpenCivitas {referenceYear}: Comuni con livelli completi e importi aggregati per profilo.
            </caption>
            <thead>
              <tr>
                <th scope="col">Profilo</th>
                <th className="num" scope="col">Comuni</th>
                <th className="num" scope="col">Spesa storica</th>
                <th className="num" scope="col">Fabbisogno standard</th>
                <th className="num" scope="col">Differenza</th>
              </tr>
            </thead>
            <tbody>
              {orderedQuadrants.map((quadrant) => (
                <tr key={quadrant.key}>
                  <th scope="row">
                    {QUADRANT_COPY[quadrant.key].title}
                    <small>{QUADRANT_COPY[quadrant.key].description}</small>
                  </th>
                  <td className="num">{integer(quadrant.municipalities)}</td>
                  <td className="num">{exactEuro(quadrant.historicalSpendingCents / 100)}</td>
                  <td className="num">{exactEuro(quadrant.standardSpendingCents / 100)}</td>
                  <td className="num">{signedEuro(quadrant.differenceCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Totale osservazioni complete</th>
                <td className="num">{integer(summary.completeTotals.municipalities)}</td>
                <td className="num">{exactEuro(summary.completeTotals.historicalSpendingCents / 100)}</td>
                <td className="num">{exactEuro(summary.completeTotals.standardSpendingCents / 100)}</td>
                <td className="num">{signedEuro(summary.completeTotals.differenceCents)}</td>
              </tr>
            </tfoot>
          </table>
        </HorizontalScrollRegion>
        <p className={styles.excluded}>
          {integer(summary.excludedMunicipalities)} Comuni coperti non entrano nei quattro profili
          perché almeno uno dei due livelli non è disponibile nella fonte.
        </p>
      </section>

      <p className={styles.provenance}>
        Fonte: <a href={source.datasetUrl} rel="noreferrer" target="_blank">{source.dataset}</a> · {source.owner} ·
        periodo {referenceYear} · {territorialScope} · licenza {source.license}. La lettura è descrittiva
        e non dimostra efficienza, spreco, risparmio o qualità dei servizi.
      </p>
    </section>
  );
}
