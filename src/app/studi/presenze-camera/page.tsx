import type { Metadata } from "next";
import Link from "next/link";
import { cameraPresenzeStudy as study } from "@/lib/studies";
import { PUBLIC_SITE_URL } from "@/lib/site";
import deputiesFile from "@/content/studies/camera-presenze-deputati.json";
import styles from "../studies.module.css";
import chartStyles from "./presenze-charts.module.css";
import {
  DeputiesTable,
  MissionsScatter,
  PresenceVotesHistogram,
  ShareStack,
  type DeputyRow,
} from "./presenze-charts";

const pct = (n: number) =>
  `${n.toLocaleString("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
const count = (n: number) => n.toLocaleString("it-IT");
const pdfHref = `${study.assetPath}/presenze-camera.pdf`;
const date = new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "UTC" });
const longDate = (iso: string) => date.format(new Date(`${iso}T00:00:00Z`));

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

function RankTable({ caption, rows }: { caption: string; rows: readonly DeputyRow[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Deputato</th>
            <th scope="col" className={chartStyles.left}>Gruppo</th>
            <th scope="col">Presenza</th>
            <th scope="col">Voti espressi</th>
            <th scope="col">Missioni</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.name}>
              <td>{d.name}</td>
              <td className={chartStyles.left}>{d.group}</td>
              <td>{pct(d.presence)}</td>
              <td>{pct(d.votes)}</td>
              <td>{pct(d.missions)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CameraPresenzeStudyPage() {
  const h = study.headline;
  const deputies: DeputyRow[] = deputiesFile.deputies;
  const fullTerm = deputies.filter((d) => d.votable === h.totalVotes);
  const lowest = [...fullTerm].sort((a, b) => a.presence - b.presence).slice(0, 10);
  const mostVotes = [...fullTerm].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "it")).slice(0, 10);
  const government = deputies.filter((d) => d.government).sort((a, b) => a.votes - b.votes);
  const groupOrder = study.groups.map((g) => g.short);
  const roles = study.profiles.roles;
  const [, presidencyRole, otherRole] = roles;
  const majority = study.blocs.find((b) => b.key === "maggioranza")!;
  const opposition = study.blocs.find((b) => b.key === "opposizione")!;
  const foreign = study.profiles.elected.find((p) => p.label === "Circoscrizione Estero");
  const [women, men] = study.profiles.gender;
  const topGroup = study.groups[0];
  const lastGroup = study.groups.at(-1)!;
  const a = h.aggregate;
  const majorityGroups = study.groups.filter((g) => g.bloc === "maggioranza");
  const pd = study.groups.find((g) => g.short === "PD")!;

  return (
    <main className={`shell page ${styles.page}`}>
      <Link href="/studi">← Tutti gli studi</Link>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>{study.series} · Versione {study.version}</p>
        <h1>{study.title}</h1>
        <p>{study.subtitle}.</p>
        <p className={styles.meta}>
          DoveVannoINostriSoldi · Pubblicato il <time dateTime={study.publishedOn}>{longDate(study.publishedOn)}</time>
          <br />
          Fonte: {study.source.owner}, dati fino al <time dateTime={study.period.observedDate}>{longDate(study.period.observedDate)}</time>
        </p>
        <div className={styles.actions}>
          <a href={pdfHref} className="btn btn-primary" download>
            Scarica il paper PDF
          </a>
          <a href="#deputati">Cerca un deputato</a>
          <Link href="/politici?vista=presenze">Vista interattiva</Link>
          <a href="#materiali">Fonti e materiali</a>
        </div>
      </header>

      <aside className={styles.note}>
        <strong>Cosa misura.</strong> La Camera considera presente un deputato quando vota oppure
        quando è in missione, cioè assente per un incarico istituzionale. La percentuale è calcolata
        sulle votazioni elettroniche in Aula. Non misura la presenza fisica continua né il lavoro in
        commissione.
      </aside>

      <dl className={styles.stats}>
        <div>
          <dt>Votazioni elettroniche</dt>
          <dd>{count(h.totalVotes)}</dd>
        </div>
        <div>
          <dt>Presenza ufficiale, mediana</dt>
          <dd>{pct(h.presence.median)}</dd>
        </div>
        <div>
          <dt>Voti espressi, mediana</dt>
          <dd>{pct(h.votes.median)}</dd>
        </div>
      </dl>

      <section className={styles.section} aria-labelledby="in-breve">
        <h2 id="in-breve">In breve</h2>
        <ul>
          <li>
            Dall&apos;inizio della {study.period.legislature} a {study.period.monthLabel.toLowerCase()} la Camera ha
            svolto {count(h.totalVotes)} votazioni elettroniche. Sul totale dei posti a disposizione, i
            deputati hanno votato nel {pct(a.votesShare)} dei casi, erano in missione nel {pct(a.missionsShare)}
            {" "}e assenti nel {pct(a.absencesShare)}.
          </li>
          <li>
            La presenza ufficiale ha una mediana dell&apos;{pct(h.presence.median)}. Se si contano solo i voti
            espressi la mediana scende al {pct(h.votes.median)} e i deputati sotto il 50% passano
            da {h.presenceBelow50} a {h.votesBelow50}.
          </li>
          <li>
            I {h.governmentCount} deputati con un incarico di governo hanno una presenza mediana
            del {pct(h.governmentMedianPresence)} ma votano, in mediana, nel {pct(h.governmentMedianVotes)} delle
            votazioni. Il resto della Camera vota nel {pct(h.nonGovernmentMedianVotes)}.
          </li>
          <li>
            Le assenze sono concentrate: i {h.lowestDecileCount} deputati con la presenza più bassa, un
            decimo della Camera, accumulano il {pct(h.lowestDecileAbsenceShare)} di tutte le assenze.
          </li>
          <li>
            La Camera classifica come giustificate il {pct(a.justifiedOfAbsences)} delle assenze. Le
            assenze senza giustificazione hanno una mediana del {pct(study.absences.unjustified.median)} delle
            votazioni per deputato.
          </li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="presenza-voto">
        <h2 id="presenza-voto">1. Presenza e voto non sono la stessa cosa</h2>
        <p>
          La percentuale che la Camera pubblica come presenza somma due voci diverse: i voti espressi
          (favorevole, contrario o astenuto) e le missioni. Per la maggior parte dei deputati le
          missioni pesano poco, per alcuni sono quasi tutto. Per questo nel grafico la distribuzione
          grigia, la presenza ufficiale, è schiacciata verso l&apos;alto, mentre quella rossa dei voti
          espressi è più larga e ha una coda lunga verso sinistra.
        </p>
        <p>
          Sulla presenza ufficiale il 10% dei deputati sta sotto il {pct(h.presence.p10)} e il 10% sopra
          il {pct(h.presence.p90)}; {h.presenceAtLeast95} deputati superano il 95%. Sui soli voti espressi
          il decimo più basso sta sotto il {pct(h.votes.p10)}. Per {h.gapOver20} deputati la differenza tra
          presenza ufficiale e voti espressi supera i 20 punti.
        </p>
        <PresenceVotesHistogram presence={study.presenceBins} votes={study.votesBins} />
      </section>

      <section className={styles.section} aria-labelledby="missioni">
        <h2 id="missioni">2. Chi è in missione</h2>
        <p>
          Il Regolamento della Camera considera presenti, ai fini del numero legale, i deputati
          impegnati fuori sede per un incarico della Camera e i membri del Governo per ragioni del loro
          ufficio. La statistica ufficiale li conta presenti anche quando non votano.
          {" "}{h.missionsOver20} deputati sono in missione in più di una votazione su cinque, {h.missionsOver50} in
          più della metà.
        </p>
        <p>
          Il grafico mette ogni deputato su due assi: in orizzontale la quota di missioni, in verticale
          quella di voti espressi. I membri del Governo si raccolgono in basso a destra. L&apos;Ufficio di
          Presidenza della Camera (vicepresidenti, questori e segretari) sta a metà strada: presenza
          mediana del {pct(presidencyRole.presence)}, voti espressi al {pct(presidencyRole.votes)}. Gli
          altri {otherRole.count} deputati votano in mediana nel {pct(otherRole.votes)} dei casi.
        </p>
        <MissionsScatter deputies={deputies} />
        <p>
          Tra chi è molto in missione ci sono anche deputati che oggi non hanno un incarico di governo:
          ex membri del Governo, presidenti di commissione, componenti di delegazioni internazionali. La
          tabella non dice per quale incarico il deputato era in missione.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>Deputati con incarico di governo ({government.length}), dal meno votante</caption>
            <thead>
              <tr>
                <th scope="col">Deputato</th>
                <th scope="col" className={chartStyles.left}>Incarico</th>
                <th scope="col">Presenza</th>
                <th scope="col">Voti espressi</th>
                <th scope="col">Missioni</th>
              </tr>
            </thead>
            <tbody>
              {government.map((d) => (
                <tr key={d.name}>
                  <td>{d.name}</td>
                  <td className={chartStyles.left}>{d.role}</td>
                  <td>{pct(d.presence)}</td>
                  <td>{pct(d.votes)}</td>
                  <td>{pct(d.missions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.meta}>
          Incarichi in corso a settembre 2026 secondo dati.camera.it. Chi ha lasciato il Governo prima
          non compare qui ma resta nella tabella completa.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="gruppi">
        <h2 id="gruppi">3. I gruppi parlamentari</h2>
        <p>
          Ogni barra divide le votazioni del gruppo in tre parti: voti espressi, missioni e assenze,
          come media dei deputati del gruppo. La presenza mediana più alta è quella
          di {topGroup.label} ({pct(topGroup.presence)}), la più bassa quella di {lastGroup.label} ({pct(lastGroup.presence)}).
          Nei quattro gruppi di maggioranza, che esprimono ministri e sottosegretari, le missioni valgono
          in media tra il {pct(Math.min(...majorityGroups.map((g) => g.meanMissions)))} e
          il {pct(Math.max(...majorityGroups.map((g) => g.meanMissions)))} delle votazioni; nel Partito
          Democratico il {pct(pd.meanMissions)}.
        </p>
        <ShareStack rows={study.groups} label="Voti espressi, missioni e assenze per gruppo" labelWidth={110} />
        <p className={styles.meta}>
          Gruppo indicato dalla Camera per il periodo. Le componenti del Misto (+Europa, Minoranze
          linguistiche e altre) sono un unico gruppo.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="blocchi">
        <h2 id="blocchi">4. Maggioranza e opposizione</h2>
        <p>
          I deputati dei gruppi di maggioranza hanno una presenza mediana del {pct(majority.presence)},
          quelli di opposizione dell&apos;{pct(opposition.presence)}. Sui voti espressi la distanza quasi
          sparisce: {pct(majority.votes)} contro {pct(opposition.votes)}. La differenza sulla presenza
          ufficiale viene in gran parte dalle missioni, che in media valgono il {pct(majority.meanMissions)} delle
          votazioni in maggioranza e il {pct(opposition.meanMissions)} in opposizione.
        </p>
        <p>
          Un voto non espresso non è sempre disinteresse. L&apos;opposizione può uscire dall&apos;Aula per far
          mancare il numero legale; la maggioranza deve garantirlo. La tabella registra il risultato,
          non il motivo.
        </p>
        <ShareStack rows={[...study.blocs, ...roles]} label="Voti espressi, missioni e assenze per schieramento e incarico" />
      </section>

      <section className={styles.section} aria-labelledby="estremi">
        <h2 id="estremi">5. Gli estremi della distribuzione</h2>
        <p>
          Le due tabelle considerano solo i deputati in carica per tutta la legislatura. Una presenza
          bassa può avere ragioni che la tabella non registra, come una malattia: la Camera avverte che
          il sistema di voto non distingue sempre queste cause.
        </p>
        <RankTable caption="Le 10 presenze ufficiali più basse" rows={lowest} />
        <RankTable caption="I 10 deputati con più voti espressi" rows={mostVotes} />
      </section>

      <section className={styles.section} aria-labelledby="assenze">
        <h2 id="assenze">6. Assenze giustificate e no</h2>
        <p>
          Accanto alle assenze la Camera pubblica quante sono giustificate. Nel complesso lo sono
          il {pct(a.justifiedOfAbsences)}. Per il deputato tipico le assenze giustificate valgono
          il {pct(study.absences.justified.median)} delle votazioni e quelle non giustificate
          il {pct(study.absences.unjustified.median)}. {study.absences.unjustifiedOver20} deputati hanno
          assenze non giustificate sopra il 20%; {study.absences.noJustified} non hanno nessuna assenza
          giustificata.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="profili">
        <h2 id="profili">7. Genere, età, tipo di elezione</h2>
        <p>
          Le donne hanno una presenza mediana del {pct(women.presence)} e votano nel {pct(women.votes)} dei
          casi; gli uomini {pct(men.presence)} e {pct(men.votes)}. La presenza ufficiale degli uomini è
          più alta per effetto delle missioni: {men.missionsOver50} uomini su {men.count} sono in missione in
          più di metà delle votazioni, contro {women.missionsOver50} donne su {women.count}. Con l&apos;età la presenza ufficiale cresce di poco e i voti espressi
          restano simili. Gli eletti nei collegi uninominali hanno una presenza più alta di quelli
          eletti con le liste proporzionali, ma anche qui la differenza sta nelle missioni.
          {foreign ? ` Gli ${foreign.count} eletti all'estero hanno la presenza mediana più bassa (${pct(foreign.presence)}): il loro collegio è fuori dall'Italia.` : null}
        </p>
        <ShareStack
          rows={[...study.profiles.gender, ...study.profiles.age, ...study.profiles.elected]}
          label="Voti espressi, missioni e assenze per profilo"
          labelWidth={170}
        />
        <p className={styles.meta}>
          Solo i {count(h.matchedDeputies)} deputati collegati all&apos;anagrafe della Camera. Età al {longDate(study.period.observedDate)}.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="soldi">
        <h2 id="soldi">8. Le assenze e la diaria</h2>
        <p>
          Oltre all&apos;indennità, ogni deputato riceve una diaria di {study.diaria.monthlyEuro} euro al mese,
          un rimborso forfetario. La Camera la riduce di {study.diaria.dailyDeductionEuro} euro
          per ogni giorno di assenza dalle sedute dell&apos;Assemblea con votazioni elettroniche. Il
          deputato è considerato presente nella giornata se partecipa ad almeno il 30% delle votazioni
          di quel giorno. L&apos;indennità non viene toccata.
        </p>
        <p>
          La tabella che usiamo è cumulata sull&apos;intera legislatura e non riporta le giornate, quindi
          non permette di calcolare quanto sia stato trattenuto a ciascun deputato. Un deputato con
          una presenza complessiva bassa può aver superato la soglia del 30% in molte giornate.
        </p>
        <p className={styles.meta}>
          Fonte: <a href={study.diaria.pageUrl}>Camera dei deputati, trattamento economico</a>.
        </p>
      </section>

      <section className={styles.section} id="deputati" aria-labelledby="deputati-titolo">
        <h2 id="deputati-titolo">9. Tutti i deputati</h2>
        <p>
          Le {count(h.rows)} righe della tabella ufficiale, ordinabili per colonna. La presenza è la
          somma di voti espressi e missioni; le assenze completano il 100%.
        </p>
        <DeputiesTable deputies={deputies} groups={groupOrder} totalVotes={h.totalVotes} />
      </section>

      <section className={styles.section} aria-labelledby="altre">
        <h2 id="altre">Altre analisi</h2>
        <ul>
          {study.external.map((item) => (
            <li key={item.url}>
              <a href={item.url}>{item.owner}, {item.title}</a>. {item.finding}
            </li>
          ))}
        </ul>
        <p>
          Sul periodo completo fino a {study.period.monthLabel.toLowerCase()}, nei nostri calcoli le missioni
          valgono il {pct(a.missionsShare)} dei posti disponibili.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="limiti">
        <h2 id="limiti">Metodo e limiti</h2>
        <ul>
          {study.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
          <li>
            Mediane e percentili usano l&apos;interpolazione lineare. Le medie di gruppo non sono
            pesate per le votazioni di ciascun deputato.
          </li>
        </ul>
      </section>

      <section className={styles.section} id="materiali">
        <h2>Materiali</h2>
        <ul>
          <li>
            <a href={pdfHref} download>
              Paper PDF · v{study.version}
            </a>
          </li>
          <li>
            <a href={study.source.pageUrl}>{study.source.owner}, partecipazione al voto ({study.period.monthLabel})</a>
          </li>
          <li>
            <a href={study.reproducibilityUrl}>Dati, codice e versioni</a>
          </li>
          <li>
            <Link href="/politici?vista=presenze">Atlante · vista Presenze</Link>
          </li>
          <li>
            <Link href="/metodologia">Come leggiamo i dati</Link>
          </li>
          <li>
            <a href="/studi/presenze-camera/v1/presenze-camera.pdf">Versione 1 del paper (20 novembre 2026)</a>
          </li>
        </ul>
        <p className={styles.meta}>
          Versione {study.version} del {longDate(study.revisedAt)}. Studio DVNS, non sottoposto a peer
          review esterna. I valori della pagina sono congelati alla revisione e non ricalcolati dallo
          snapshot live.
        </p>
        <details>
          <summary>Impronta SHA-256 del PDF</summary>
          <p className={styles.hash}>
            PDF v{study.version}: <code>{study.assets["presenze-camera.pdf"].sha256}</code>
          </p>
        </details>
      </section>
    </main>
  );
}
