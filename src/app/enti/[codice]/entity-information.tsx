import Link from "next/link";
import type { IpaEntity } from "@/lib/ipa";
import { IPA_ENTI_DATASET_URL, IPA_LICENSE } from "@/lib/ipa";
import type { IpaOrganizationStructure } from "@/lib/ipa-structure";
import { IPA_AOO_DATASET_URL, IPA_UO_DATASET_URL } from "@/lib/ipa-structure";
import { longDate } from "@/lib/format";
import styles from "./scheda.module.css";

function show(value: string | null): string {
  return value ?? "Non indicato";
}

type EntityInformationProps = Readonly<{
  entity: IpaEntity;
  responsible: string;
  structure: IpaOrganizationStructure | null;
  snapshotOnly?: boolean;
  snapshotObservedAt?: string | null;
  /** Municipal pages use Comune-specific copy; other public bodies use ente. */
  variant?: "municipality" | "organization";
}>;

export function EntityInformation({
  entity,
  responsible,
  structure,
  snapshotOnly = false,
  snapshotObservedAt = null,
  variant = "organization",
}: EntityInformationProps) {
  const isMunicipality = variant === "municipality";
  const visibleUnits = structure?.unitaOrganizzative.records.slice(0, 24) ?? [];
  const structureLabel = isMunicipality ? "Unità organizzative del Comune" : "Unità organizzative dell'ente";

  return (
    <details
      className={`panel ${styles.municipalityInformation}`}
      data-entity-information
      {...(isMunicipality ? { "data-municipality-information": true } : {})}
    >
      <summary>
        <span>{isMunicipality ? "Informazioni sul Comune e fonti" : "Informazioni sull'ente e fonti"}</span>
        <small>Contatti, uffici, identificativi e provenienza dei dati</small>
      </summary>

      <div className={styles.informationContent}>
        <section aria-labelledby="entity-contacts-title">
          <h2 id="entity-contacts-title">Contatti</h2>
          {snapshotOnly ? (
            <p>
              Contatti e responsabile non sono inclusi nello snapshot locale. Per i recapiti correnti fa
              fede Indice PA.
            </p>
          ) : (
            <dl className={styles.definitions}>
              <div><dt>Responsabile</dt><dd>{responsible}</dd></div>
              <div><dt>Indirizzo</dt><dd>{show(entity.sede.indirizzo)}</dd></div>
              <div><dt>CAP</dt><dd>{show(entity.sede.cap)}</dd></div>
              {!isMunicipality ? (
                <div>
                  <dt>Comune ISTAT</dt>
                  <dd>{show(entity.sede.codiceComuneIstat)}</dd>
                </div>
              ) : null}
              {entity.email.map((mail) => (
                <div key={`${mail.indirizzo}-${mail.tipo ?? "mail"}`}>
                  <dt>{mail.tipo ?? "email"}</dt>
                  <dd><a href={`mailto:${mail.indirizzo}`}>{mail.indirizzo}</a></dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section aria-labelledby="entity-identifiers-title">
          <h2 id="entity-identifiers-title">Identificativi ufficiali</h2>
          <dl className={styles.definitions}>
            <div><dt>Tipologia</dt><dd>{show(entity.tipologia)}</dd></div>
            <div><dt>Codice fiscale</dt><dd>{show(entity.codiceFiscale)}</dd></div>
            <div><dt>Codice IPA</dt><dd>{entity.codiceIpa}</dd></div>
            {isMunicipality ? (
              <div><dt>Codice ISTAT Comune</dt><dd>{show(entity.sede.codiceComuneIstat)}</dd></div>
            ) : null}
            <div><dt>Codice ISTAT ente</dt><dd>{show(entity.codiceIstat)}</dd></div>
            <div><dt>Categoria IPA</dt><dd>{show(entity.codiceCategoria)}</dd></div>
            <div><dt>Natura giuridica</dt><dd>{show(entity.codiceNatura)}</dd></div>
            <div><dt>Codice ATECO</dt><dd>{show(entity.codiceAteco)}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="entity-source-title">
          <h2 id="entity-source-title">Fonte anagrafica</h2>
          <dl className={styles.definitions}>
            <div>
              <dt>Fonte</dt>
              <dd><a href={IPA_ENTI_DATASET_URL} target="_blank" rel="noreferrer">Indice PA · Enti ↗</a></dd>
            </div>
            <div><dt>Licenza</dt><dd>{IPA_LICENSE}</dd></div>
            {snapshotOnly ? (
              <>
                <div><dt>Modalità</dt><dd>Snapshot verificato durante l&apos;ETL; nessuna chiamata IPA durante la visita</dd></div>
                <div><dt>Snapshot osservato</dt><dd>{snapshotObservedAt ? longDate(snapshotObservedAt) : "Non indicato"}</dd></div>
              </>
            ) : (
              <>
                <div><dt>Aggiornamento dichiarato</dt><dd>{show(entity.dataAggiornamento)}</dd></div>
                <div><dt>Frequenza</dt><dd>giornaliera</dd></div>
                <div>
                  <dt>Formato JSON</dt>
                  <dd>
                    <Link href={`/api/enti/${encodeURIComponent(entity.codiceIpa)}`}>
                      Apri API →
                    </Link>
                  </dd>
                </div>
              </>
            )}
          </dl>
        </section>

        <section aria-labelledby="entity-structure-title">
          <h2 id="entity-structure-title">Uffici dichiarati in IPA</h2>
          {snapshotOnly ? (
            <div className="notice">
              <strong>Uffici non inclusi nello snapshot locale</strong>
              <p>La visita non interroga IPA live; per UO e AOO correnti consulta direttamente la fonte ufficiale.</p>
            </div>
          ) : structure ? (
            <>
              <dl className={styles.structureSummary}>
                <div><dt>Unità organizzative</dt><dd>{structure.unitaOrganizzative.total}</dd></div>
                <div><dt>Aree di protocollo</dt><dd>{structure.areeOrganizzativeOmogenee.total}</dd></div>
              </dl>
              {visibleUnits.length > 0 ? (
                <details className={styles.structureDetails} data-structure-details>
                  <summary>Vedi le unità organizzative pubblicate</summary>
                  <div className="table-scroll" role="region" aria-label={structureLabel} tabIndex={0}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">Unità organizzativa</th>
                          <th scope="col">Codice UO</th>
                          <th scope="col">AOO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleUnits.map((unit) => (
                          <tr key={unit.codice}>
                            <th scope="row">
                              {unit.denominazione}
                              <small>{unit.codicePadre ? `dipende dalla UO ${unit.codicePadre}` : "livello padre non indicato"}</small>
                            </th>
                            <td><code>{unit.codice}</code></td>
                            <td>{unit.codiceAoo ? <code>{unit.codiceAoo}</code> : "non indicata"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {structure.unitaOrganizzative.total > visibleUnits.length ? (
                    <p className={styles.note}>
                      Sono elencate le prime {visibleUnits.length} unità in ordine alfabetico.
                    </p>
                  ) : null}
                </details>
              ) : (
                <p className={styles.note}>IPA non pubblica unità organizzative per questo ente.</p>
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
              <p className={styles.note}>
                IPA descrive unità organizzative, uffici e relazioni dichiarate dall&apos;ente. Per
                direzioni generali e strutture giuridiche fanno fede anche regolamenti e pagine di
                Amministrazione trasparente.
              </p>
            </>
          ) : (
            <div className="notice warning-notice">
              <strong>Gli uffici non sono disponibili in questo momento</strong>
              <p>La scheda anagrafica resta consultabile senza ricostruire la struttura dai nomi.</p>
            </div>
          )}
        </section>

        {!isMunicipality ? (
          <section aria-labelledby="entity-future-data-title">
            <h2 id="entity-future-data-title">Altri collegamenti economici</h2>
            <p className={styles.note}>
              Per questo tipo di ente pubblichiamo già contratti e aggiudicazioni ANAC quando
              disponibili. Pagamenti SIOPE, progetti PNRR e consulenze verranno collegati solo con
              join esatti verso fonti ufficiali.
            </p>
          </section>
        ) : null}
      </div>
    </details>
  );
}

/** @deprecated Use EntityInformation */
export const MunicipalityInformation = EntityInformation;
