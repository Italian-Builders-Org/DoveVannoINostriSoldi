import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PeriodSelector } from "@/components/period-selector";
import {
  MedicalDeviceQueryError,
  getMedicalDeviceProfile,
  listMedicalDeviceFacts,
  medicalDeviceRegionLabel,
} from "@/lib/medical-device-spending";
import styles from "../../dispositivi.module.css";

type RouteParams = { tipo: string; numero: string };
type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function euro(value: string): string {
  const negative = value.startsWith("-");
  const [whole, cents] = (negative ? value.slice(1) : value).split(".");
  return `${negative ? "−" : ""}${BigInt(whole).toLocaleString("it-IT")},${cents} €`;
}

function nextHref(tipo: string, numero: string, year: number, cursor: string): string {
  return `/spese/sanita/dispositivi/${tipo}/${numero}?${new URLSearchParams({ anno: String(year), cursore: cursor })}`;
}

export async function generateMetadata({ params }: { params: Promise<RouteParams> }): Promise<Metadata> {
  const { tipo, numero } = await params;
  try {
    const profile = await getMedicalDeviceProfile({ type: tipo, number: numero });
    return {
      title: profile.device.name ?? `Dispositivo ${numero}`,
      description: `Scheda e spesa rilevata del dispositivo di tipo ${tipo}, repertorio ${numero}.`,
      alternates: { canonical: `/spese/sanita/dispositivi/${tipo}/${numero}` },
    };
  } catch (error) {
    if (error instanceof MedicalDeviceQueryError) return { title: "Dispositivo non trovato" };
    throw error;
  }
}

export default async function MedicalDevicePage({ params, searchParams }: {
  params: Promise<RouteParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { tipo, numero } = await params;
  const query = await searchParams;
  let profile: Awaited<ReturnType<typeof getMedicalDeviceProfile>>;
  try {
    profile = await getMedicalDeviceProfile({ type: tipo, number: numero });
  } catch (error) {
    if (error instanceof MedicalDeviceQueryError) notFound();
    throw error;
  }
  const years = profile.years.map((item) => item.year);
  const selectedYear = Number(one(query.anno) ?? years[0]);
  if (!years.includes(selectedYear)) notFound();
  let facts: Awaited<ReturnType<typeof listMedicalDeviceFacts>>;
  try {
    facts = await listMedicalDeviceFacts({
      type: tipo,
      number: numero,
      year: String(selectedYear),
      cursor: one(query.cursore),
      limit: 50,
    });
  } catch (error) {
    if (error instanceof MedicalDeviceQueryError) notFound();
    throw error;
  }
  const annual = profile.years.find((item) => item.year === selectedYear)!;
  const device = profile.device;

  return (
    <main className="shell page">
      <header className="page-intro">
        <p className="eyebrow">Dispositivi medici · tipo {device.type}</p>
        <h1>{device.name ?? `Dispositivo ${device.number}`}</h1>
        <p>Numero di repertorio {device.number}. La scheda collega l’anagrafica corrente alle righe di spesa pubblicate dal 2018 al 2021.</p>
        <p className={styles.links}><Link href="/spese/sanita/dispositivi">← Torna alla ricerca</Link><a href={`/api/spese/sanita/dispositivi?vista=dispositivo&tipo=${device.type}&numero=${device.number}`}>Scheda in JSON</a></p>
      </header>

      <section className="panel" aria-labelledby="anagrafica-title">
        <h2 className="panel-title" id="anagrafica-title">Anagrafica BD/RDM</h2>
        <dl className={styles.definitionList}>
          <dt>Tipo e repertorio</dt><dd>Tipo {device.type} · {device.number}</dd>
          <dt>Codice catalogo</dt><dd>{device.catalog ?? "Non disponibile"}</dd>
          <dt>{device.role === "assemblatore" ? "Assemblatore" : "Fabbricante"}</dt><dd>{device.manufacturer ?? "Non collegato"}</dd>
          <dt>Classificazione CND</dt><dd>{device.classification ? `${device.classification}${device.classificationLabel ? ` · ${device.classificationLabel}` : ""}` : "Non disponibile"}</dd>
          <dt>ID anagrafica</dt><dd>{device.registryRecordId ?? "Non disponibile"}</dd>
          <dt>Anagrafica aggiornata al</dt><dd>{profile.registrySnapshotDate.split("-").reverse().join("/")}</dd>
        </dl>
        <p className={styles.note}>Questa anagrafica è successiva agli anni di spesa. Non prova quale ruolo avesse il fabbricante o assemblatore dal 2018 al 2021.</p>
      </section>

      <section className="panel" aria-labelledby="spesa-title">
        <h2 className="panel-title" id="spesa-title">Spesa rilevata</h2>
        <PeriodSelector activeYear={selectedYear} years={years} pathname={`/spese/sanita/dispositivi/${tipo}/${numero}`} />
        <div className="stat-strip">
          <div><span className="stat-label">Spesa {selectedYear}</span><span className={`stat-value ${styles.money}`}>{euro(annual.spending)}</span><span className="stat-note">somma esatta delle righe pubblicate</span></div>
          <div><span className="stat-label">Righe</span><span className="stat-value">{annual.rows.toLocaleString("it-IT")}</span><span className="stat-note">{annual.negativeRows} rettifiche negative · {annual.zeroRows} zeri</span></div>
          <div><span className="stat-label">Territori</span><span className="stat-value">{annual.regions.length.toLocaleString("it-IT")}</span><span className="stat-note">codici Regione nella fonte</span></div>
        </div>
        <div className="table-scroll" role="region" aria-label={`Spesa ${selectedYear} per Regione e azienda sanitaria`} tabIndex={0}>
          <table className="table"><caption className={styles.visuallyHidden}>Distribuzione territoriale della spesa rilevata</caption><thead><tr><th scope="col">Regione</th><th scope="col">Azienda sanitaria</th><th scope="col" className="num">Righe</th><th scope="col" className="num">Spesa</th></tr></thead><tbody>
            {annual.regions.flatMap((region) => region.companies.map((company, index) => <tr key={`${region.code}-${company.code}`}><th scope="row">{index === 0 ? medicalDeviceRegionLabel(region.code) : <span className={styles.visuallyHidden}>{medicalDeviceRegionLabel(region.code)}</span>}</th><td>{company.names.join(" / ") || company.code}<small className={styles.blockMeta}>codice {company.code}</small></td><td className="num">{company.rows.toLocaleString("it-IT")}</td><td className={`num ${styles.money}`}>{euro(company.spending)}</td></tr>))}
          </tbody></table>
        </div>
      </section>

      <section className="panel" aria-labelledby="righe-title">
        <div className={styles.summary}><div><h2 className="panel-title" id="righe-title">Righe della fonte</h2><p>{facts.matched.toLocaleString("it-IT")} righe nel {selectedYear}; {facts.pagination.returned} mostrate.</p></div><a href={`/api/spese/sanita/dispositivi?vista=dispositivo&tipo=${device.type}&numero=${device.number}&anno=${selectedYear}`}>Righe in JSON</a></div>
        <div className="table-scroll" role="region" aria-label={`Righe di spesa ${selectedYear}`} tabIndex={0}>
          <table className="table"><caption className={styles.visuallyHidden}>Righe del dataset del Ministero della Salute</caption><thead><tr><th scope="col">Azienda sanitaria</th><th scope="col">Regione</th><th scope="col">CND nella riga</th><th scope="col" className="num">Spesa</th><th scope="col">Fonte</th></tr></thead><tbody>
            {facts.rows.map((fact) => <tr key={`${fact.datasetId}-${fact.sourceRow}`}><th scope="row">{fact.companyName}<small className={styles.blockMeta}>codice {fact.company}</small></th><td>{medicalDeviceRegionLabel(fact.region)}</td><td>{fact.sourceClassification || "Non indicata"}</td><td className={`num ${styles.money}`}>{euro(fact.spending)}</td><td><Link href={fact.catalog.href}>Riga {fact.sourceRow.toLocaleString("it-IT")}</Link></td></tr>)}
          </tbody></table>
        </div>
        {facts.pagination.nextCursor ? <p><Link className="btn btn-secondary" href={nextHref(tipo, numero, selectedYear, facts.pagination.nextCursor)}>Righe successive</Link></p> : null}
      </section>

      <section className="panel" aria-labelledby="interpretazione-title">
        <h2 className="panel-title" id="interpretazione-title">Come leggere questi dati</h2>
        <p>La fonte riporta la spesa di acquisto rilevata dalle aziende sanitarie. Non riporta prezzi unitari, pagamenti al fabbricante, ricavi o fatturato. Zeri e rettifiche negative restano nel totale.</p>
      </section>
    </main>
  );
}
