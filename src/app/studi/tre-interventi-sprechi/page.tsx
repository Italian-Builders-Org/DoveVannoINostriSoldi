import type { Metadata } from "next";
import Link from "next/link";
import { wasteInterventionsStudy as study } from "@/lib/studies";
import { PUBLIC_SITE_URL } from "@/lib/site";
import styles from "../studies.module.css";

const money = (n: number, digits = 1) =>
  new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const pdfHref = `${study.assetPath}/tre-interventi-sprechi.pdf`;

export const metadata: Metadata = {
  title: `${study.title} · Studi`,
  description: study.description,
  alternates: { canonical: `${PUBLIC_SITE_URL}${study.path}` },
  openGraph: {
    type: "article",
    title: study.title,
    description: study.description,
    url: `${PUBLIC_SITE_URL}${study.path}`,
    modifiedTime: study.revisedAt,
  },
};

export default function WasteInterventionsStudyPage() {
  const h = study.headline;
  return (
    <main className={`shell page ${styles.page}`}>
      <Link href="/studi">← Tutti gli studi</Link>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>{study.series} · Versione {study.version}</p>
        <h1>{study.title}</h1>
        <p>{study.subtitle}</p>
        <p className={styles.meta}>
          DoveVannoINostriSoldi · Pubblicato il{" "}
          <time dateTime={study.publishedOn}>22 settembre 2026</time>
          <br />
          Fonti consultate il <time dateTime={study.sourcesConsultedOn}>22 settembre 2026</time>
        </p>
        <div className={styles.actions}>
          <a href={pdfHref} className="btn btn-primary" download>
            Scarica il paper PDF
          </a>
          <a href="#materiali">Fonti e materiali</a>
        </div>
      </header>

      <aside className={styles.note}>
        <strong>Come leggere le cifre.</strong> I tre casi hanno significati diversi e non si
        sommano. Il rapporto distingue sempre i dati delle fonti dalle proposte DVNS. Un margine
        teorico non coincide con un taglio di bilancio fino a quando non sono noti contratti,
        quantità, data di efficacia e costi di attuazione.
      </aside>

      <dl className={styles.stats}>
        <div>
          <dt>Scenari AIFA 2025 (mln €)</dt>
          <dd>
            {money(h.pharma_scenarios_mln[0])} a {money(h.pharma_scenarios_mln[3])}
          </dd>
        </div>
        <div>
          <dt>Pagamenti Pinto 2025</dt>
          <dd>{money(h.pinto_paid_2025_mln)} mln €</dd>
        </div>
        <div>
          <dt>Investimenti non aggiuntivi stimati</dt>
          <dd>oltre {h.building_non_additional_bln} mld €</dd>
        </div>
      </dl>

      <section className={styles.section}>
        <h2>La domanda: quali spese verificare per prime?</h2>
        <p>
          Questo quaderno individua tre spese da sottoporre a verifica: i prezzi dei farmaci
          biologici acquistati dal servizio sanitario; gli indennizzi e gli oneri generati dai
          ritardi dei processi; i contributi edilizi concessi per lavori che partirebbero anche
          senza aiuto pubblico.
        </p>
        <p>
          Per ciascun caso indichiamo la voce da ridurre, il motivo economico, la decisione da
          prendere e la prova necessaria per contabilizzare un risparmio. L&apos;analisi parte dai
          temi raccolti su DVNS e utilizza fonti di AIFA, Ministero della Giustizia e Banca
          d&apos;Italia.
        </p>
      </section>

      <section className={styles.section}>
        <h2>01 · Farmaci: ridurre i sovrapprezzi evitabili</h2>
        <p>
          <strong>Spesa da rivedere.</strong> Acquisti pubblici di farmaci biologici a brevetto
          scaduto, quando una terapia appropriata e comparabile può essere acquistata a minor
          costo. Il taglio riguarda il costo di acquisto a parità di cure.
        </p>
        <p>
          AIFA simula quattro alternative sui consumi del 2025: {money(h.pharma_scenarios_mln[0])},{" "}
          {money(h.pharma_scenarios_mln[1])}, {money(h.pharma_scenarios_mln[2])} e{" "}
          {money(h.pharma_scenarios_mln[3])} milioni di euro. Ogni riga è un&apos;alternativa
          completa: gli importi non si sommano.
        </p>
        <figure>
          <div className={styles.bars}>
            {[
              ["S1 · Prezzo medio nazionale", h.pharma_scenarios_mln[0]],
              ["S2 · Prezzo medio più basso nella regione", h.pharma_scenarios_mln[1]],
              ["S3 · Minimo delle medie regionali", h.pharma_scenarios_mln[2]],
              ["S4 · Prezzo medio minimo tra le regioni", h.pharma_scenarios_mln[3]],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <div className={styles.barLabel}>
                  <span>{label}</span>
                  <span>{money(Number(value))} mln €</span>
                </div>
                <div className={styles.track} aria-hidden="true">
                  <div
                    className={styles.fill}
                    style={{ width: `${(Number(value) / h.pharma_scenarios_mln[3]) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <figcaption className={styles.meta}>
            Fonte: AIFA, stima del risparmio sui biosimilari (dati a dicembre 2025). Priorità
            operative nello scenario S3: epoetine ({money(h.pharma_priority_mln_s3.epoetine)} mln),
            eparine a basso peso molecolare ({money(h.pharma_priority_mln_s3.eparine)} mln) e
            ustekinumab ({money(h.pharma_priority_mln_s3.ustekinumab)} mln).
          </figcaption>
        </figure>
        <p>
          <strong>Atto proposto.</strong> Un elenco di contratti da modificare o rinnovare, con
          prezzo attuale, prezzo ottenibile, quantità, data di efficacia e risparmio netto per
          anno. La scelta clinica resta affidata ai clinici; AIFA considera intercambiabili
          biosimilare e biologico di riferimento.
        </p>
      </section>

      <section className={styles.section}>
        <h2>02 · Giustizia: evitare nuovi costi da ritardo</h2>
        <p>
          <strong>Spesa da rivedere.</strong> Nuovi indennizzi per processi troppo lunghi, interessi
          e spese aggiuntive causate dal ritardo nel pagarli. L&apos;obiettivo è ridurre la
          formazione di nuovi debiti e gli oneri da pagamenti tardivi.
        </p>
        <p>
          Nel 2025 sono stati pagati {money(h.pinto_paid_2025_mln)} milioni di euro:{" "}
          {money(h.pinto_central_arrears_mln)} mln dalla sede centrale (arretrato 2015-2022) e{" "}
          {money(h.pinto_appeals_from_2023_mln)} mln dalle Corti d&apos;appello (decreti dal 2023).
          Il totale misura i pagamenti effettuati, non i nuovi ritardi prodotti in dodici mesi.
        </p>
        <p>
          <strong>Atto proposto.</strong> Un programma per gli uffici selezionati: causa del
          ritardo, intervento, personale necessario, costo, scadenza e indicatore di risultato.
          Le decisioni sul merito dei processi restano autonome. Le fonti consultate non
          identificano quali uffici abbiano oggi il maggiore costo evitabile: occorre
          ricostruirlo sui dati individuali.
        </p>
      </section>

      <section className={styles.section}>
        <h2>03 · Edilizia: selezionare meglio i contributi</h2>
        <p>
          <strong>Spesa da rivedere.</strong> Nei nuovi programmi, aiuti a lavori che sarebbero
          eseguiti comunque con risultati analoghi. Lo studio della Banca d&apos;Italia stima che
          circa il {Math.round(h.building_non_additional_share * 100)}% del valore degli
          investimenti agevolati da Superbonus e Bonus facciate nel 2021-2023 sarebbe stato
          realizzato anche senza incentivo: oltre {h.building_non_additional_bln} miliardi di euro.
        </p>
        <p>
          Quei miliardi sono investimenti storici stimati come non aggiuntivi. Non coincidono con
          contributi oggi recuperabili. Il dato serve a progettare meglio i futuri finanziamenti:
          graduare il contributo per necessità economica e beneficio pubblico, fissare costi
          ammissibili e un tetto agli impegni.
        </p>
        <p>
          <strong>Atto proposto.</strong> Una norma o un programma con platea, aliquote, costi
          massimi, budget e controllo dei risultati, applicato ai nuovi impegni e rispettoso dei
          diritti già maturati.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Dal potenziale al risparmio netto</h2>
        <p>
          Una simulazione DVNS sui farmaci mostra perché un margine teorico non coincide con il
          taglio da scrivere in bilancio. Se si realizzasse il 50% dello scenario AIFA da{" "}
          {money(h.pharma_scenarios_mln[2])} milioni su dodici mesi, con 10 milioni di costi
          aggiuntivi, il risparmio netto nell&apos;esempio sarebbe di 164,2 milioni. Con soli sei
          mesi di applicazione scenderebbe a 77,1 milioni: la data di efficacia fa parte del conto.
        </p>
        <p>
          Per giustizia ed edilizia manca ancora una base per il netto: servono i nuovi debiti
          evitabili e i costi degli interventi, oppure un programma futuro identificato con i
          contributi realmente escludibili. Non sommiamo le cifre dei tre casi.
        </p>
      </section>

      <section className={styles.section} id="materiali">
        <h2>Materiali, versione e verificabilità</h2>
        <ul>
          <li>
            <a href={pdfHref} download>
              Paper completo · PDF v{study.version}
            </a>
          </li>
          <li>
            <a href={study.reproducibilityUrl}>Note di fonte, PDF di ricerca e limiti</a>
          </li>
          <li>
            <Link href="/metodologia">Come leggiamo i dati</Link>
          </li>
        </ul>
        <p className={styles.meta}>
          Versione {study.version} del {study.revisedAt}. Studio e proposte di DVNS; non sottoposto
          a peer review esterna. I titoli e gli importi riproducono il quaderno PDF; le serie hanno
          periodi diversi, indicati nelle fonti.
        </p>
        <details>
          <summary>Impronta SHA-256 del PDF</summary>
          <p className={styles.hash}>
            PDF v{study.version}: <code>{study.assets["tre-interventi-sprechi.pdf"].sha256}</code>
          </p>
        </details>
      </section>
    </main>
  );
}
