import type { Metadata } from "next";
import Link from "next/link";

import { ShareFactButton } from "@/components/share-fact/ShareFactButton";
import { PUBLIC_SITE_URL } from "@/lib/site";
import styles from "./programmi.module.css";

const title = "Programmi elettorali 2027";
const description =
  "In arrivo: confronti oggettivi tra promesse di campagna e numeri ufficiali. I programmi entreranno nel catalogo; l’AI aiuterà a strutturarli, i dati pubblici a verificarli.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${PUBLIC_SITE_URL}/programmi` },
  openGraph: {
    type: "website",
    title: `${title} · DoveVannoINostriSoldi`,
    description,
    url: `${PUBLIC_SITE_URL}/programmi`,
    locale: "it_IT",
    siteName: "DoveVannoINostriSoldi",
  },
  twitter: {
    card: "summary_large_image",
    title: `${title} · DoveVannoINostriSoldi`,
    description,
  },
};

export default function ProgrammiElettoraliPage() {
  return (
    <main className={`shell page ${styles.page}`}>
      <section className={styles.hero} aria-labelledby="programmi-title">
        <p className={styles.brand}>DoveVannoINostriSoldi</p>
        <p className={styles.eyebrow}>
          <span className={styles.pulse} aria-hidden="true" />
          In arrivo · Campagne 2027
        </p>
        <h1 id="programmi-title">Le promesse, messe di fronte ai numeri</h1>
        <p className={styles.lead}>
          Una nuova sezione per leggere i programmi elettorali in arrivo, confrontarli tra loro e
          verificarli sulle fonti ufficiali già sul sito: spesa, debito, posti di lavoro, scuola,
          sanità. L’AI aiuta a ordinare i testi; i dati pubblici decidono cosa regge.
        </p>
        <div className={styles.actions}>
          <ShareFactButton
            label="Condividi l’anteprima"
            title="Programmi elettorali 2027"
            value="In arrivo"
            detail="Promesse di campagna confrontate con i numeri ufficiali"
            source="DoveVannoINostriSoldi · sezione in preparazione"
            path="/programmi"
          />
          <Link href="/governi" className="btn">
            Pagella dei governi
          </Link>
          <Link href="/assistente">Prova l’assistente sui dati →</Link>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="come-funziona">
        <h2 id="come-funziona">Cosa arriverà</h2>
        <p>
          Non un debate generato a macchina. Un percorso trasparente: testo del programma, claim
          espliciti, serie ufficiali collegate e un esito leggibile: confermato, incompleto o non
          verificabile con le fonti disponibili.
        </p>
        <div className={styles.grid}>
          <article className={styles.step}>
            <span>01 · Catalogo</span>
            <h3>Programmi ufficiali</h3>
            <p>
              Solo documenti pubblicati da partiti, coalizioni o candidati, con URL, data e hash
              quando disponibili. Niente sintesi inventate al posto del testo.
            </p>
          </article>
          <article className={styles.step}>
            <span>02 · AI assistita</span>
            <h3>Claim strutturati</h3>
            <p>
              L’AI estrae promesse misurabili (importi, tempi, target) e le lascia revisionabili.
              Non assegna voti politici e non riempie i buchi con stime.
            </p>
          </article>
          <article className={styles.step}>
            <span>03 · Numeri</span>
            <h3>Confronto fail-closed</h3>
            <p>
              Ogni claim punta a serie già in catalogo (SIOPE, MEF, ISTAT, Eurostat, OpenBDAP…). Se
              manca la fonte, lo diciamo: non forziamo una conferma.
            </p>
          </article>
        </div>
      </section>

      <section className={styles.promise} aria-labelledby="perimetro">
        <div>
          <h2 id="perimetro">Perimetro onesto</h2>
          <dl>
            <div>
              <dt>Cosa verifichiamo</dt>
              <dd>
                Affermazioni su livelli di spesa, entrate, debiti, posti, servizi e indicatori già
                presenti nelle fonti ufficiali del portale.
              </dd>
            </div>
            <div>
              <dt>Cosa non facciamo</dt>
              <dd>
                Non prevediamo chi vincerà, non attribuiamo intenzioni e non trasformiamo uno slogan
                qualitativo in un numero inventato.
              </dd>
            </div>
            <div>
              <dt>Quando apre</dt>
              <dd>
                Con le campagne del 2027, man mano che i programmi ufficiali saranno pubblicati.
                Questa pagina resta il punto di condivisione finché il catalogo non è pronto.
              </dd>
            </div>
          </dl>
        </div>
        <aside className={styles.note}>
          <strong>Perché adesso.</strong> La pagella dei governi guarda i risultati osservati. I
          programmi guardano alle promesse future. Metterle sullo stesso tavolo dei dati evita che
          restino soltanto narrativa.
        </aside>
      </section>

      <section className={styles.section} aria-labelledby="mentre-aspetti">
        <h2 id="mentre-aspetti">Nel frattempo</h2>
        <p>
          Puoi già leggere i governi con indicatori europei, la mappa della politica e chiedere
          all’assistente percorsi sui dataset pubblicati.
        </p>
        <div className={styles.links}>
          <Link href="/governi">Pagella politico-economica</Link>
          <Link href="/politici">Mappa della politica</Link>
          <Link href="/fonti">Fonti e copertura</Link>
          <Link href="/istituzioni">Tutte le istituzioni</Link>
        </div>
      </section>
    </main>
  );
}
