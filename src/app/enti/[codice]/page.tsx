import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getIpaEntityByCode,
  IPA_ENTI_DATASET_URL,
  IPA_LICENSE,
  type IpaEntity,
} from "@/lib/ipa";
import {
  getIpaOrganizationStructure,
  IPA_AOO_DATASET_URL,
  IPA_UO_DATASET_URL,
  type IpaOrganizationStructure,
} from "@/lib/ipa-structure";
import { longDate } from "@/lib/format";
import {
  decodeEntityProcurementRouteCode,
  getEntityProcurementPage,
} from "@/lib/data/anac-entity-procurement-page";
import { getMunicipalityProfile } from "@/lib/municipality-profile";
import { municipalitySnapshotEntity } from "@/lib/municipality-snapshot-entity";
import { getSiopeMunicipalityDetailByIpaCode } from "@/lib/siope-municipality-detail";
import { MunicipalityEconomics } from "./municipality-economics";
import { MunicipalityInformation } from "./municipality-information";
import { EntityProcurementSection } from "./entity-procurement-section";
import styles from "./scheda.module.css";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const entityRobots = { index: false, follow: false } as const;

type PageProps = {
  params: Promise<{ codice: string }>;
};

function show(value: string | null): string {
  return value ?? "Non indicato";
}

function responsibleLabel(
  titolo: string | null,
  nome: string | null,
  cognome: string | null,
): string {
  const identity = [nome, cognome].filter(Boolean).join(" ");
  return [titolo, identity].filter(Boolean).join(", ") || "Non indicato da IPA";
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { codice } = await params;
  const normalizedCode = decodeEntityProcurementRouteCode(codice);
  if (!normalizedCode) return { title: "Ente non trovato", robots: entityRobots };
  const municipality = getSiopeMunicipalityDetailByIpaCode(normalizedCode);
  if (municipality) {
    return {
      title: municipality.name,
      description: `Scheda pubblica del Comune ${municipality.name}, Codice IPA ${normalizedCode}.`,
      robots: entityRobots,
    };
  }

  try {
    const entity = await getIpaEntityByCode(normalizedCode);
    if (!entity) return { title: "Ente non trovato" };

    return {
      title: entity.denominazione,
      description: `Scheda pubblica dell'ente ${entity.denominazione}, Codice IPA ${entity.codiceIpa}.`,
      robots: entityRobots,
    };
  } catch {
    return { title: "Ente", robots: entityRobots };
  }
}

export default async function EntityPage({ params }: PageProps) {
  const { codice } = await params;
  const normalizedCode = decodeEntityProcurementRouteCode(codice);
  if (!normalizedCode) notFound();

  const municipalitySnapshot = getSiopeMunicipalityDetailByIpaCode(normalizedCode);
  let entity: IpaEntity | null = municipalitySnapshot
    ? municipalitySnapshotEntity(municipalitySnapshot)
    : null;
  const snapshotOnly = entity !== null;
  let structure: IpaOrganizationStructure | null = null;
  if (!entity) {
    try {
      entity = await getIpaEntityByCode(normalizedCode);
    } catch {
      return (
        <main className="shell page">
          <div className="page-intro">
            <h1>Anagrafica IPA non disponibile</h1>
            <p>
              Indice PA non risponde. I dati della scheda non sono cancellati: manca solo
              l&apos;anagrafe live in questo momento.
            </p>
          </div>
          <div className="notice warning-notice">
            <strong>Codice richiesto</strong>
            <p>{normalizedCode}</p>
          </div>
        </main>
      );
    }
  }

  if (!entity) notFound();
  if (!snapshotOnly) {
    try {
      structure = await getIpaOrganizationStructure(normalizedCode);
    } catch {
      structure = null;
    }
  }
  const [municipalityProfile, procurementState] = await Promise.all([
    getMunicipalityProfile(entity, { allowCommittedIstatIdentity: snapshotOnly }),
    getEntityProcurementPage(entity),
  ]);

  const responsible = responsibleLabel(
    entity.responsabile.titolo,
    entity.responsabile.nome,
    entity.responsabile.cognome,
  );

  return (
    <main className="shell page">
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/enti">Enti e società</Link>
        <span aria-hidden="true">/</span>
        <span>{municipalityProfile ? "Scheda comunale" : entity.codiceIpa}</span>
      </nav>

      <div className={`${styles.head} ${municipalityProfile ? styles.municipalityHead : ""}`}>
        <div className="page-intro">
          <h1>{entity.denominazione}</h1>
          {municipalityProfile ? (
            entity.dataAggiornamento ? <p>Informazioni sul Comune aggiornate al {longDate(entity.dataAggiornamento)}</p> : null
          ) : (
            <p>
              Codice IPA <strong>{entity.codiceIpa}</strong>
              {entity.acronimo ? `, ${entity.acronimo}` : ""}
              {entity.dataAggiornamento ? `, aggiornato ${entity.dataAggiornamento}` : ""}
            </p>
          )}
          {(!municipalityProfile && entity.tipologia) || entity.inLiquidazione ? (
            <div className={styles.badges}>
              {!municipalityProfile && entity.tipologia ? <span className="tag tag-neutral">{entity.tipologia}</span> : null}
              {entity.inLiquidazione ? <span className="tag tag-accent">ente in liquidazione</span> : null}
            </div>
          ) : null}
        </div>

        {entity.sitoIstituzionale && (
          <a
            className={municipalityProfile ? styles.institutionalLink : "btn btn-secondary"}
            href={entity.sitoIstituzionale}
            target="_blank"
            rel="noreferrer"
          >
            Sito istituzionale ↗
          </a>
        )}
      </div>

      {snapshotOnly ? (
        <div className="notice">
          <strong>Profilo servito da snapshot verificati</strong>
          <p>Questa visita non interroga Indice PA live; contatti e uffici correnti restano consultabili nella fonte ufficiale.</p>
        </div>
      ) : null}

      <div className={municipalityProfile ? styles.municipalityLayout : styles.split}>
        <div className={styles.main}>
          {municipalityProfile ? <MunicipalityEconomics profile={municipalityProfile} /> : null}
          {municipalityProfile ? (
            <EntityProcurementSection state={procurementState} />
          ) : null}

          {!municipalityProfile ? <section className="panel">
            <h2 className="panel-title">Identità amministrativa</h2>
            <dl className={styles.definitions}>
              <div>
                <dt>Codice fiscale</dt>
                <dd>{show(entity.codiceFiscale)}</dd>
              </div>
              <div>
                <dt>Tipologia</dt>
                <dd>{show(entity.tipologia)}</dd>
              </div>
              <div>
                <dt>Responsabile</dt>
                <dd>{responsible}</dd>
              </div>
            </dl>
            <details className={styles.technicalDetails}>
              <summary>Mostra identificativi tecnici</summary>
              <dl className={styles.definitions}>
                <div><dt>Codice IPA</dt><dd>{entity.codiceIpa}</dd></div>
                <div><dt>Codice ISTAT ente</dt><dd>{show(entity.codiceIstat)}</dd></div>
                <div><dt>Categoria IPA</dt><dd>{show(entity.codiceCategoria)}</dd></div>
                <div><dt>Natura giuridica</dt><dd>{show(entity.codiceNatura)}</dd></div>
                <div><dt>Codice ATECO</dt><dd>{show(entity.codiceAteco)}</dd></div>
              </dl>
            </details>
          </section> : null}

          {!municipalityProfile ? <section className="panel" id="struttura-ipa">
            <h2 className="panel-title">Struttura dichiarata in IPA · UO e AOO</h2>

            {structure ? (
              <>
                <dl className={styles.structureSummary}>
                  <div>
                    <dt>Unità organizzative</dt>
                    <dd>{structure.unitaOrganizzative.total}</dd>
                  </div>
                  <div>
                    <dt>Aree di protocollo</dt>
                    <dd>{structure.areeOrganizzativeOmogenee.total}</dd>
                  </div>
                  <div>
                    <dt>Cadenza dichiarata</dt>
                    <dd>giornaliera</dd>
                  </div>
                </dl>

                {structure.unitaOrganizzative.records.length > 0 ? (
                  <div className="table-scroll" role="region" aria-label="Unità organizzative dell’ente" tabIndex={0}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">Unità organizzativa</th>
                          <th scope="col">Codice UO</th>
                          <th scope="col">AOO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {structure.unitaOrganizzative.records.slice(0, 6).map((unit) => (
                          <tr key={unit.codice}>
                            <th scope="row">
                              {unit.denominazione}
                              <small>
                                {unit.codicePadre
                                  ? `dipende dalla UO ${unit.codicePadre}`
                                  : "livello padre non indicato"}
                              </small>
                            </th>
                            <td>
                              <code>{unit.codice}</code>
                            </td>
                            <td>{unit.codiceAoo ? <code>{unit.codiceAoo}</code> : "non indicata"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={styles.note}>
                    IPA non pubblica Unità Organizzative per questo ente.
                  </p>
                )}

                {structure.unitaOrganizzative.records.length > 6 ? (
                  <details className={styles.structureDetails} data-structure-details>
                    <summary>
                      Mostra altre {Math.min(structure.unitaOrganizzative.records.length, 24) - 6} unità organizzative
                    </summary>
                    <div className="table-scroll" role="region" aria-label="Altre unità organizzative dell’ente" tabIndex={0}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th scope="col">Unità organizzativa</th>
                            <th scope="col">Codice UO</th>
                            <th scope="col">AOO</th>
                          </tr>
                        </thead>
                        <tbody>
                          {structure.unitaOrganizzative.records.slice(6, 24).map((unit) => (
                            <tr key={unit.codice}>
                              <th scope="row">
                                {unit.denominazione}
                                <small>
                                  {unit.codicePadre
                                    ? `dipende dalla UO ${unit.codicePadre}`
                                    : "livello padre non indicato"}
                                </small>
                              </th>
                              <td><code>{unit.codice}</code></td>
                              <td>{unit.codiceAoo ? <code>{unit.codiceAoo}</code> : "non indicata"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ) : null}

                {structure.unitaOrganizzative.total > 24 && (
                  <p className={styles.note}>
                    La scheda include le prime 24 unità in ordine alfabetico. L&apos;API espone pagine fino a
                    500 record tramite <code>limit</code> e <code>offset</code>.
                  </p>
                )}

                <div className={styles.actions}>
                  <a className="btn btn-secondary" href={IPA_UO_DATASET_URL} target="_blank" rel="noreferrer">
                    Dataset UO ↗
                  </a>
                  <a className="btn btn-secondary" href={IPA_AOO_DATASET_URL} target="_blank" rel="noreferrer">
                    Dataset AOO ↗
                  </a>
                  <Link
                    className="btn btn-secondary"
                    href={`/api/enti/${encodeURIComponent(entity.codiceIpa)}/struttura`}
                  >
                    API struttura →
                  </Link>
                </div>
              </>
            ) : (
              <div className="notice warning-notice">
                <strong>La struttura IPA non risponde in questo momento</strong>
                <p>
                  La scheda anagrafica resta valida; non sostituiamo UO e AOO con una gerarchia
                  inferita dai nomi.
                </p>
              </div>
            )}

            <p className={styles.note}>
              IPA descrive unità organizzative, uffici e relazioni dichiarate dall&apos;ente. Per
              direzioni generali e strutture giuridiche fanno fede anche regolamenti e pagine di
              Amministrazione trasparente.
            </p>
          </section> : null}

          {!municipalityProfile ? <section className="panel">
            <h2 className="panel-title">Sede e contatti pubblicati</h2>
            <dl className={styles.definitions}>
              <div>
                <dt>Indirizzo</dt>
                <dd>{show(entity.sede.indirizzo)}</dd>
              </div>
              <div>
                <dt>CAP</dt>
                <dd>{show(entity.sede.cap)}</dd>
              </div>
              <div>
                <dt>Comune ISTAT</dt>
                <dd>{show(entity.sede.codiceComuneIstat)}</dd>
              </div>
              {entity.email.map((mail) => (
                <div key={`${mail.indirizzo}-${mail.tipo ?? "mail"}`}>
                  <dt>{mail.tipo ?? "email"}</dt>
                  <dd>
                    <a href={`mailto:${mail.indirizzo}`}>{mail.indirizzo}</a>
                  </dd>
                </div>
              ))}
            </dl>
          </section> : null}

          {!municipalityProfile ? (
            <>
              <EntityProcurementSection state={procurementState} />
              <section className="panel">
                <h2 className="panel-title">Altri dati economici · collegamenti in corso</h2>
                <dl className={styles.definitions}>
                  <div><dt>Pagamenti e serie storiche</dt><dd>SIOPE / OpenBDAP</dd></div>
                  <div><dt>Progetti, opere e PNRR</dt><dd>CUP / ReGiS / OpenCoesione</dd></div>
                  <div><dt>Consulenze e incarichi</dt><dd>Funzione Pubblica</dd></div>
                </dl>
                <p className={styles.note}>
                  Non pubblichiamo dati economici senza un collegamento esatto a una fonte ufficiale.
                </p>
              </section>
            </>
          ) : null}

          {municipalityProfile ? (
            <MunicipalityInformation
              entity={entity}
              responsible={responsible}
              structure={structure}
              snapshotOnly={snapshotOnly}
              snapshotObservedAt={municipalitySnapshot?.years[0]?.observedAt ?? null}
            />
          ) : null}
        </div>

        {!municipalityProfile ? <aside className={styles.side}>
          <section className="panel">
            <h2 className="panel-title">Da dove arrivano i dati</h2>
            <dl className={styles.sideList}>
              <div>
                <dt>Fonte</dt>
                <dd>
                  <a href={IPA_ENTI_DATASET_URL} target="_blank" rel="noreferrer">
                    Indice PA · Enti ↗
                  </a>
                </dd>
              </div>
              <div>
                <dt>Licenza</dt>
                <dd>{IPA_LICENSE}</dd>
              </div>
              <div>
                <dt>Frequenza</dt>
                <dd>giornaliera</dd>
              </div>
              <div>
                <dt>Data del dato</dt>
                <dd>{show(entity.dataAggiornamento)}</dd>
              </div>
              <div>
                <dt>Formato JSON</dt>
                <dd>
                  <Link href={`/api/enti/${encodeURIComponent(entity.codiceIpa)}`}>
                    Apri API →
                  </Link>
                </dd>
              </div>
            </dl>
          </section>
        </aside> : null}
      </div>
    </main>
  );
}
