import Link from "next/link";
import { integer, longDate } from "@/lib/format";
import { getHospitalBeds } from "@/lib/salute-hospital-beds";
import { getEditorialSurfacePreview } from "@/lib/integrated-editorial";
import styles from "./sanita.module.css";

export default async function HospitalBeds() {
  const { dataset, regions } = await getHospitalBeds();
  const total = regions.reduce((sum, region) => sum + region.total, 0);
  const landing = dataset.sourceMetadata.canonicalUrls.find((url) => url.includes("/it/dataset/"));
  return (
    <section className="panel" aria-labelledby="hospital-beds-title" id="posti-letto">
      <div className={styles.sectionHead}>
        <div>
          <h2 className="panel-title" id="hospital-beds-title">{getEditorialSurfacePreview("/spese/sanita")!.title}</h2>
          <p>
            <strong>{integer(total)} posti letto</strong> nelle righe pubblicate dal Ministero
            della Salute, al <strong>1° gennaio 2023</strong>. Somma delle dotazioni di Regioni
            e Province autonome, per acuti, riabilitazione e lungodegenza.
          </p>
        </div>
        <span className="tag tag-neutral">2023 · posti letto</span>
      </div>
      <p>
        Sono posti letto delle strutture pubbliche ed equiparate e dell’attività accreditata
        delle case di cura private. Il dato descrive la capacità dichiarata, non i pazienti
        curati, i tempi di attesa o la qualità delle cure. I costi CE in questa pagina si
        riferiscono invece al 2024: i due perimetri restano separati, senza calcolare un costo
        per posto letto.
      </p>
      <details className={styles.bedsDetail}>
        <summary>Posti letto per Regione e Provincia autonoma · 2023</summary>
        <div className="table-scroll" role="region" aria-label="Posti letto per territorio al 1° gennaio 2023" tabIndex={0}>
          <table className="table">
            <caption>Somma delle discipline pubblicate, in ordine di codice del Ministero</caption>
            <thead>
              <tr>
                <th scope="col">Territorio</th>
                <th scope="col" className="num">Acuti</th>
                <th scope="col" className="num">Riabilitazione</th>
                <th scope="col" className="num">Lungodegenza</th>
                <th scope="col" className="num">Totale posti letto</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((region) => (
                <tr key={region.code}>
                  <th scope="row">{region.name}<small>codice {region.code}</small></th>
                  <td className="num">{integer(region.acute)}</td>
                  <td className="num">{integer(region.rehabilitation)}</td>
                  <td className="num">{integer(region.longTerm)}</td>
                  <td className="num">{integer(region.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className={styles.note}>
        Comprende degenza ordinaria, a pagamento, day hospital e day surgery. Nido escluso
        dal perimetro delle discipline. Eventuali modelli HSP12/HSP13 non trasmessi dalle
        strutture limitano la completezza del dato: la somma non stima i posti mancanti.
      </p>
      <p className={styles.note}>
        Fonte: <a href={landing}>Ministero della Salute</a> ·
        Pubblicazione {dataset.sourceMetadata.publicationDate ? longDate(dataset.sourceMetadata.publicationDate) : "non dichiarata"} ·
        Acquisizione {dataset.sourceMetadata.acquisitionDate ? longDate(dataset.sourceMetadata.acquisitionDate) : "non dichiarata"} · IODL 2.0.
        {" "}<Link href={`/dati/${dataset.id}`}>Esplora le {integer(dataset.publicRows)} righe per disciplina</Link>
        {" · "}<Link href={dataset.provenanceHref}>Provenienza e verifica</Link>
      </p>
    </section>
  );
}
