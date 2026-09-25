import Link from "next/link";
import type { CSSProperties } from "react";
import { decimal, integer, percent } from "@/lib/format";
import { realEstateSource, type Communication, type MunicipalityRealEstate, type RentRatio } from "@/lib/municipality-real-estate";
import styles from "./scheda.module.css";

const USE_LABELS: Record<string, string> = {
  "Utilizzato direttamente": "Utilizzati direttamente",
  "Non utilizzato": "Non utilizzati",
  "Inutilizzabile": "Inutilizzabili",
  "In ristrutturazione/manutenzione": "In ristrutturazione o manutenzione",
  "Non indicato": "Stato non indicato",
};

function rentPerM2(ratio: RentRatio) {
  return ratio.eurPerM2Month === null ? "Non disponibile" : `${decimal(ratio.eurPerM2Month, 2)} € al m² al mese`;
}

function communicationNote(communication: Communication | null) {
  if (!communication) return "Il Comune non compare nel file di adempimento MEF 2023: non si sa se abbia comunicato i dati nel 2023.";
  if (!communication.sent) {
    return "Il Comune non ha inviato la comunicazione 2023: questi dati sono quelli della sua ultima comunicazione precedente.";
  }
  return communication.complete
    ? null
    : "Il Comune ha inviato la comunicazione 2023 senza dichiarare completi i dati: il censimento può non includere tutti i suoi beni.";
}

export function MunicipalityRealEstate({ realEstate }: { realEstate: MunicipalityRealEstate }) {
  const data = realEstate.status === "available" ? realEstate.data : null;
  const query = data ? `?q=${data.taxCode}` : "";
  const note = data ? communicationNote(realEstate.communication) : null;
  return (
    <section className={`panel ${styles.economicSection} ${styles.realEstateSection}`} id="dati-patrimonio" aria-labelledby="real-estate-title">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.sectionKicker}>MEF · censimento degli immobili pubblici</span>
          <h2 className={styles.sectionTitle} id="real-estate-title">Patrimonio immobiliare dichiarato</h2>
        </div>
        <span className="tag tag-neutral">Rilascio {realEstateSource.release}</span>
      </div>
      <p className={styles.readingGuide}>
        Beni e contratti che il Comune dichiara al Ministero dell’Economia. Lo stato d’uso è quello indicato
        dall’ente: non misura agibilità, occupazione o efficienza, e un bene vuoto non è di per sé uno spreco.
      </p>
      {note ? <p className="notice" data-real-estate-coverage>{note}</p> : null}
      {data ? (
        <>
          <dl className={styles.metricGrid}>
            <div>
              <dt>Beni posseduti</dt>
              <dd data-real-estate-owned>{integer(data.owned.total)}</dd>
              <small>Proprietà e altri diritti reali; {integer(data.heldFromOthers)} beni sono invece avuti da terzi.</small>
            </div>
            <div>
              <dt>Dichiarati non utilizzati</dt>
              <dd>{integer(data.owned.byUse.find((use) => use.label === "Non utilizzato")?.count ?? 0)}</dd>
              <small>Terreni compresi: tipologie diverse non vanno confrontate tra loro.</small>
            </div>
            <div>
              <dt>Fuori dal territorio comunale</dt>
              <dd>{integer(data.owned.elsewhere)}</dd>
              <small>{data.owned.elsewhere ? `In ${integer(data.owned.elsewhereMunicipalities)} altri Comuni.` : "Tutti i beni posseduti sono nel Comune."}</small>
            </div>
            <div>
              <dt>Contratti con terzi</dt>
              <dd>{integer(data.contracts.total)}</dd>
              <small>Locazioni, concessioni, usi gratuiti e gestioni: non sono sommabili come entrate.</small>
            </div>
          </dl>

          {data.owned.total > 0 ? (
            <>
              <h3>Stato d’uso dei beni posseduti</h3>
              <ul className={styles.benchmarkChart} data-real-estate-use aria-label="Beni posseduti per stato d’uso dichiarato">
                {data.owned.byUse.map((use) => (
                  <li key={use.label}>
                    <strong>{USE_LABELS[use.label] ?? use.label}</strong>
                    <span className={styles.benchmarkTrack} aria-hidden="true">
                      <span
                        className={styles.realEstateBar}
                        style={{ "--share": `${use.count / data.owned.total * 100}%` } as CSSProperties}
                      />
                    </span>
                    <b>{integer(use.count)} <small>({percent(use.count / data.owned.total * 100)})</small></b>
                    {use.label === "Non indicato" && data.owned.unstatedGivenToThirdParties ? (
                      <small className={styles.realEstateNote}>
                        Di cui {integer(data.owned.unstatedGivenToThirdParties)} dati in tutto o in parte a terzi: la fonte non indica l’uso dei beni ceduti.
                      </small>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {data.owned.unusedByType.length ? (
            <div className="table-scroll">
              <table className="table">
                <caption>Beni non utilizzati: tipologie più frequenti</caption>
                <thead><tr><th scope="col">Tipologia</th><th scope="col" className="num">Beni</th></tr></thead>
                <tbody>
                  {data.owned.unusedByType.map((type) => (
                    <tr key={type.label}><th scope="row">{type.label}</th><td className="num">{integer(type.count)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {data.owned.locations.length ? (
            <div className="table-scroll">
              <table className="table">
                <caption>Dove si trovano i beni fuori dal Comune</caption>
                <thead><tr><th scope="col">Comune del bene</th><th scope="col" className="num">Beni</th></tr></thead>
                <tbody>
                  {data.owned.locations.map((place) => (
                    <tr key={place.cadastralCode}><th scope="row">{place.municipality}</th><td className="num">{integer(place.count)}</td></tr>
                  ))}
                </tbody>
              </table>
              {data.owned.elsewhereMunicipalities > data.owned.locations.length ? (
                <p className={styles.sourceNote}>
                  Altri {integer(data.owned.elsewhereMunicipalities - data.owned.locations.length)} Comuni nel dataset completo.
                </p>
              ) : null}
            </div>
          ) : null}

          {data.contracts.total > 0 ? (
            <>
              <h3>Canoni dichiarati nelle locazioni</h3>
              <dl className={styles.metricGrid}>
                <div>
                  <dt>Locazioni ordinarie</dt>
                  <dd>{rentPerM2(data.contracts.leasedNonErp)}</dd>
                  <small>
                    Su {integer(data.contracts.leasedNonErp.ratioContracts)} di {integer(data.contracts.leasedNonErp.contracts)} contratti:
                    intera unità, canone positivo e superficie dichiarata.
                  </small>
                </div>
                <div>
                  <dt>Edilizia residenziale pubblica</dt>
                  <dd>{rentPerM2(data.contracts.leasedErp)}</dd>
                  <small>
                    {integer(data.contracts.leasedErp.contracts)} alloggi locati, solo in forma aggregata. Il canone è fissato
                    per legge in base al reddito: non si confronta con il mercato.
                  </small>
                </div>
              </dl>
              {data.contracts.zeroRent ? (
                <p className={styles.sourceNote}>
                  {integer(data.contracts.zeroRent)} contratti riportano un canone pari a zero: può essere un errore di compilazione o un caso reale.
                </p>
              ) : null}
            </>
          ) : null}

          <details className={styles.methodDetails}>
            <summary className={styles.schoolNotesSummary}>Come leggere questi dati</summary>
            <p className={styles.readingGuide}>
              I canoni sono quelli contrattuali dichiarati: non misurano incassi o morosità. Il valore al metro quadro è
              il rapporto tra la somma dei canoni e la somma delle superfici, non una media dei contratti.
            </p>
            <p className={styles.readingGuide}>
              «Non utilizzato» non dice se il bene sia agibile, affittabile o occupato. I tipi di contratto restano distinti:
              «in gestione per conto di» non è una locazione.
            </p>
          </details>
        </>
      ) : (
        <p className={styles.emptyState}>{realEstate.status !== "available" ? realEstate.message : null}</p>
      )}
      <p className={styles.sourceNote}>
        Fonte: <a href={realEstateSource.landingUrl} target="_blank" rel="noreferrer">MEF · censimento degli immobili pubblici ↗</a>
        {" "}(CC BY 4.0). Dati per ente:{" "}
        <Link href={`/dati/${realEstateSource.beniDatasetId}${query}`}>beni</Link>,{" "}
        <Link href={`/dati/${realEstateSource.contrattiDatasetId}${query}`}>contratti</Link> e{" "}
        <Link href={`/dati/${realEstateSource.adempimentoDatasetId}${query}`}>adempimento</Link>.
      </p>
    </section>
  );
}
