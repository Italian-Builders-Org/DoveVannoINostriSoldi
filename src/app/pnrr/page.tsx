import type { Metadata } from "next";
import Link from "next/link";
import { IntegratedQueryError, selectPnrrProjects } from "@/lib/integrated-public-view";
import { pnrrProjectMetadata, pnrrFilterNames, type PnrrFilter } from "@/lib/pnrr-projects-index";
import { pnrrFunding, pnrrLocations } from "@/lib/pnrr-projects-view";
import { integer } from "@/lib/format";
import styles from "./pnrr.module.css";

export const metadata: Metadata = {
  title: "PNRR · cerca i progetti in tutta Italia",
  description: "291.398 registrazioni ReGiS del 13 giugno 2026: progetti, finanziamenti e territori di tutte le missioni PNRR, con fonte Italia Domani.",
};

type Params = Record<string, string | string[] | undefined>;
const labels: Record<PnrrFilter, string> = {
  cup: "CUP", mission: "Missione", component: "Componente", measure: "Misura",
  submeasure: "Submisura", code: "Codice fiscale attuatore", region: "Regione",
  province: "Codice provincia", territory: "Codice comune ISTAT",
};
const options = pnrrProjectMetadata.options;

function queryLink(filters: Partial<Record<PnrrFilter, string>>, cursor?: string | null) {
  const params = new URLSearchParams(filters);
  if (cursor) params.set("cursor", cursor);
  return `/pnrr${params.size ? `?${params}` : ""}`;
}

export default async function PnrrPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  let result: Awaited<ReturnType<typeof selectPnrrProjects>> | undefined;
  let error: string | undefined;
  try {
    for (const key of Object.keys(params)) {
      if (![...pnrrFilterNames, "cursor"].includes(key)) throw new IntegratedQueryError(`Parametro non supportato: ${key}.`);
    }
    result = await selectPnrrProjects({ ...params, limit: 25 });
  } catch (caught) {
    if (!(caught instanceof IntegratedQueryError)) throw caught;
    error = caught.message;
  }
  const value = (field: PnrrFilter) => typeof params[field] === "string" ? params[field] : "";
  const select = (field: keyof typeof options) => (
    <label className={styles.field} key={field}>
      <span>{labels[field]}</span>
      <select name={field} defaultValue={value(field)}>
        <option value="">Tutte</option>
        {options[field].map((option) => <option value={option.code} key={option.code}>{option.code} · {option.label}</option>)}
      </select>
    </label>
  );
  return (
    <main className={`shell page ${styles.page}`}>
      <nav className={styles.links} aria-label="Percorso"><Link href="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">PNRR</span></nav>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>ITALIA DOMANI · REGIS</p>
        <h1>Dove sono i progetti del PNRR</h1>
        <p>Cerca per missione, territorio o codice progetto. Leggi chi lo attua e quale finanziamento è registrato nella fonte ufficiale.</p>
        <p className={styles.scope}>Dati al <strong>13 giugno 2026</strong> · acquisiti il 7 settembre 2026</p>
      </header>
      <section className="stat-strip" aria-label="Copertura nazionale PNRR">
        <div><span className="stat-label">Registrazioni ReGiS</span><span className="stat-value">291.398</span><span className="stat-note">CUP, codice locale e submisura</span></div>
        <div><span className="stat-label">CUP validi distinti</span><span className="stat-value">285.992</span><span className="stat-note">Più registrazioni possono avere lo stesso CUP</span></div>
        <div><span className="stat-label">Missioni</span><span className="stat-value">7</span><span className="stat-note">Tutto il catalogo progetti del rilascio</span></div>
      </section>
      <aside className={styles.note}><strong>Finanziamento non significa pagamento.</strong> Qui trovi importi assegnati al progetto, anche se non ancora validato. La localizzazione indica dove si realizza; il soggetto attuatore è chi lo gestisce. Non ricaviamo graduatorie di ritardo o spreco.</aside>
      <section className={`panel ${styles.filters}`} aria-labelledby="filters-title">
        <h2 id="filters-title">Trova un progetto</h2>
        <form action="/pnrr">
          <div className={styles.filterGrid}>
            <label className={styles.field}><span>CUP</span><input name="cup" defaultValue={value("cup")} maxLength={15} placeholder="Es. F81C23001370006" autoCapitalize="characters" spellCheck={false} /></label>
            {select("mission")}{select("region")}{select("measure")}
          </div>
          <details className={styles.advanced} open={Boolean(value("component") || value("submeasure") || value("code") || value("province") || value("territory"))}>
            <summary>Altri filtri: componente, submisura, attuatore e comune</summary>
            <div className={styles.filterGrid}>
              {select("component")}{select("submeasure")}
              <label className={styles.field}><span>Codice fiscale attuatore</span><input name="code" defaultValue={value("code")} maxLength={13} placeholder="Es. 97832870584" spellCheck={false} /></label>
              <label className={styles.field}><span>Codice provincia</span><input name="province" defaultValue={value("province")} inputMode="numeric" maxLength={3} placeholder="Es. 058" /></label>
              <label className={styles.field}><span>Codice comune ISTAT</span><input name="territory" defaultValue={value("territory")} inputMode="numeric" maxLength={6} placeholder="Es. 058091 per Roma" /></label>
            </div>
            <p>Codici territoriali a tre o sei cifre, come nella fonte. Il codice del comune unisce provincia e comune. I codici fiscali oscurati non sono ricercabili.</p>
          </details>
          <div className={styles.actions}><button type="submit">Filtra progetti</button><Link href="/pnrr">Azzera filtri</Link></div>
        </form>
      </section>
      {error && <p className={styles.error} role="alert">{error} <Link href="/pnrr">Riparti dal catalogo</Link></p>}
      {result && <section aria-labelledby="results-title" className={styles.results}>
        <div className={styles.resultHeading}><div><h2 id="results-title">{integer(result.matchedRows)} registrazioni trovate</h2><p>{result.rows.length > 0 ? `Mostrate ${integer(result.pagination.start + 1)} a ${integer(result.pagination.start + result.rows.length)}. Ordine per CUP, codice locale e submisura.` : "Nessuna registrazione corrisponde a tutti i filtri. Prova ad azzerarne uno."}</p></div><a href={`/api/pnrr/progetti?${new URLSearchParams({ ...result.filters, limit: "25", ...(typeof params.cursor === "string" ? { cursor: params.cursor } : {}) })}`}>Dati JSON</a></div>
        <div className={styles.projectList}>{result.rows.map((row) => {
          const cells = row.cells;
          const locations = pnrrLocations(cells.Localizzazioni);
          const regions = [...new Set(locations.map((location) => location[1]).filter(Boolean))];
          const validCup = /^[A-Z0-9]{15}$/.test(cells.CUP ?? "");
          return <article className={styles.project} key={row.id}>
            <p className={styles.projectMeta}><span>{cells.Missione} · {cells.Componente}</span><span>{cells["Stato Avanzamento Progetto"] || "Stato non disponibile"}</span></p>
            <h3>{cells["Titolo Progetto"] || "Titolo non disponibile"}</h3>
            <p className={styles.measure}>{cells["Codice Univoco Submisura"]} · {cells["Descrizione Submisura"]}</p>
            <dl className={styles.facts}>
              <div><dt>CUP</dt><dd>{validCup ? <Link href={queryLink({ cup: cells.CUP! })}>{cells.CUP}</Link> : "Non disponibile (segnaposto della fonte)"}</dd></div>
              <div><dt>Soggetto attuatore</dt><dd>{cells["Soggetto Attuatore"] || "Non disponibile"}</dd></div>
              <div><dt>Finanziamento PNRR</dt><dd>{pnrrFunding(cells["Finanziamento PNRR"])}</dd></div>
              <div><dt>Localizzazione</dt><dd>{regions.length ? regions.join(" · ") : "Non disponibile"}</dd></div>
            </dl>
            <details className={styles.detail}><summary>Dettagli della registrazione</summary>
              <dl className={styles.facts}>
                <div><dt>Codice locale progetto</dt><dd>{cells["Codice Locale Progetto"]}</dd></div>
                <div><dt>Finanziamento totale del progetto</dt><dd>{pnrrFunding(cells["Finanziamento Totale"])}</dd></div>
                <div><dt>Codice fiscale attuatore</dt><dd>{cells["Codice Fiscale Soggetto Attuatore"] === "****************" ? "Oscurato dalla fonte" : cells["Codice Fiscale Soggetto Attuatore"] || "Non disponibile"}</dd></div>
                <div><dt>Esito ultima validazione</dt><dd>{cells["Esito Ultima Validazione"] || "Non disponibile"}</dd></div>
              </dl>
              <h4>Localizzazioni dichiarate ({integer(locations.length)})</h4>
              {locations.length === 0 ? <p>La fonte non collega localizzazioni a questa registrazione.</p> : <ul className={styles.locations}>{locations.map((location, index) => <li key={index}>{location[1] || "Regione non disponibile"}{location[3] ? ` · ${location[3]}` : ""}{location[5] ? ` · ${location[5]}` : ""} · quota dichiarata {location[6] ? `${location[6]}%` : "non disponibile"}{location[2] !== "000" && location[4] !== "000" ? ` · codice ${location[2]}${location[4]}` : " · ambito sovracomunale/nazionale"}</li>)}</ul>}
              <p>Le quote territoriali sono quelle pubblicate, senza ripartire gli importi o correggerle. Non sommare il finanziamento per ogni localizzazione.</p>
            </details>
          </article>;
        })}</div>
        {result.pagination.nextCursor && <nav className={styles.pagination} aria-label="Pagine risultati PNRR"><Link href={queryLink(result.filters, result.pagination.nextCursor)}>Registrazioni successive →</Link><span>La ricerca prosegue con gli stessi filtri.</span></nav>}
      </section>}
      <section className={`panel ${styles.sources}`} aria-labelledby="sources-title">
        <h2 id="sources-title">Fonte, copertura e limiti</h2>
        <p>MEF · Ragioneria Generale dello Stato, Italia Domani, versione 13.0, licenza CC BY 4.0. Il catalogo include anche registrazioni non validate. Due righe hanno CUP segnaposto, 40 non hanno localizzazione, 94 codici fiscali sono oscurati e due sono mancanti. Otto righe non hanno codice misura: la submisura resta disponibile.</p>
        <p>I file ufficiali sono Progetti e Localizzazione del 13 giugno 2026. Gare, aggiudicatari e pagamenti ReGiS non fanno parte di questa vista. Il verticale asili mantiene il proprio rilascio verificato e le proprie definizioni.</p>
        <div className={styles.links}><a href="https://www.italiadomani.gov.it/content/sogei-ng/it/it/catalogo-open-data/Progetti_del_PNRR.html">Catalogo ufficiale Italia Domani</a><Link href="/dati/pnrr-progetti">Tabella completa e provenienza</Link><Link href="/fonti/copertura#dataset-pnrr-progetti">Ricevuta di copertura</Link><Link href="/mcp">Accesso MCP · pnrr_progetti</Link></div>
      </section>
      <nav className={styles.verticals} aria-label="Approfondimenti PNRR"><Link href="/coesione/asili"><strong>Asili e prima infanzia →</strong><span>Il verticale curato: progetti, gare e aggiudicatari.</span></Link><Link href="/pnrr/incarichi"><strong>Incarichi INDIRE →</strong><span>Incarichi esterni e compensi contrattuali dichiarati.</span></Link></nav>
    </main>
  );
}
