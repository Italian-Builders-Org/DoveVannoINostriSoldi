import type { IpaEntity } from "@/lib/ipa";
import { IPA_ENTI_DATASET_URL, IPA_LICENSE } from "@/lib/ipa";
import type { IpaOrganizationStructure } from "@/lib/ipa-structure";
import { longDate } from "@/lib/format";
import styles from "./scheda.module.css";

function show(value: string | null): string {
  return value ?? "Non indicato";
}

export function MunicipalityInformation({
  entity,
  responsible,
  structure,
  snapshotOnly = false,
  snapshotObservedAt = null,
}: {
  entity: IpaEntity;
  responsible: string;
  structure: IpaOrganizationStructure | null;
  snapshotOnly?: boolean;
  snapshotObservedAt?: string | null;
}) {
  const visibleUnits = structure?.unitaOrganizzative.records.slice(0, 24) ?? [];

  return (
    <details className={`panel ${styles.municipalityInformation}`} data-municipality-information>
      <summary>
        <span>Informazioni sul Comune e fonti</span>
        <small>Contatti, uffici, identificativi e provenienza dei dati</small>
      </summary>

      <div className={styles.informationContent}>
        <section aria-labelledby="municipality-contacts-title">
          <h2 id="municipality-contacts-title">Contatti</h2>
          {snapshotOnly ? (
            <p>Contatti e responsabile non sono inclusi nello snapshot locale. Per i recapiti correnti fa fede Indice PA.</p>
          ) : (
            <dl className={styles.definitions}>
              <div><dt>Responsabile</dt><dd>{responsible}</dd></div>
              <div><dt>Indirizzo</dt><dd>{show(entity.sede.indirizzo)}</dd></div>
              <div><dt>CAP</dt><dd>{show(entity.sede.cap)}</dd></div>
              {entity.email.map((mail) => (
                <div key={`${mail.indirizzo}-${mail.tipo ?? "mail"}`}>
                  <dt>{mail.tipo ?? "email"}</dt>
                  <dd><a href={`mailto:${mail.indirizzo}`}>{mail.indirizzo}</a></dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section aria-labelledby="municipality-identifiers-title">
          <h2 id="municipality-identifiers-title">Identificativi ufficiali</h2>
          <dl className={styles.definitions}>
            <div><dt>Codice fiscale</dt><dd>{show(entity.codiceFiscale)}</dd></div>
            <div><dt>Codice IPA</dt><dd>{entity.codiceIpa}</dd></div>
            <div><dt>Codice ISTAT Comune</dt><dd>{show(entity.sede.codiceComuneIstat)}</dd></div>
            <div><dt>Codice ISTAT ente</dt><dd>{show(entity.codiceIstat)}</dd></div>
            <div><dt>Categoria IPA</dt><dd>{show(entity.codiceCategoria)}</dd></div>
            <div><dt>Natura giuridica</dt><dd>{show(entity.codiceNatura)}</dd></div>
            <div><dt>Codice ATECO</dt><dd>{show(entity.codiceAteco)}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="municipality-source-title">
          <h2 id="municipality-source-title">Fonte anagrafica</h2>
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
              </>
            )}
          </dl>
        </section>

        <section aria-labelledby="municipality-structure-title">
          <h2 id="municipality-structure-title">Uffici dichiarati in IPA</h2>
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
                  <div className="table-scroll" role="region" aria-label="Unità organizzative del Comune" tabIndex={0}>
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
              ) : <p className={styles.note}>IPA non pubblica unità organizzative per questo Comune.</p>}
            </>
          ) : (
            <div className="notice warning-notice">
              <strong>Gli uffici non sono disponibili in questo momento</strong>
              <p>La scheda anagrafica resta consultabile senza ricostruire la struttura dai nomi.</p>
            </div>
          )}
        </section>
      </div>
    </details>
  );
}
