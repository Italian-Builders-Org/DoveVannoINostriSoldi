import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { HierarchyIcon, LegalDocument01Icon } from "@hugeicons/core-free-icons";
import {
  getIpaEntityByCode,
  IPA_ENTI_DATASET_URL,
  IPA_ENTI_RESOURCE_ID,
  IPA_LICENSE,
} from "@/lib/ipa";
import {
  getIpaOrganizationStructure,
  IPA_AOO_DATASET_URL,
  IPA_UO_DATASET_URL,
  type IpaOrganizationStructure,
} from "@/lib/ipa-structure";
import styles from "../enti.module.css";

export const dynamic = "force-dynamic";

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
  return [titolo, identity].filter(Boolean).join(" · ") || "Non indicato nel record IPA";
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { codice } = await params;

  try {
    const entity = await getIpaEntityByCode(decodeURIComponent(codice));
    if (!entity) return { title: "Ente non trovato" };

    return {
      title: entity.denominazione,
      description: `Scheda pubblica dell'ente ${entity.denominazione}, Codice IPA ${entity.codiceIpa}.`,
    };
  } catch {
    return { title: "Ente" };
  }
}

export default async function EntityPage({ params }: PageProps) {
  const { codice } = await params;
  const normalizedCode = decodeURIComponent(codice);

  let entity;
  let structure: IpaOrganizationStructure | null = null;
  try {
    const [entityResult, structureResult] = await Promise.allSettled([
      getIpaEntityByCode(normalizedCode),
      getIpaOrganizationStructure(normalizedCode),
    ]);
    if (entityResult.status === "rejected") throw entityResult.reason;
    entity = entityResult.value;
    if (structureResult.status === "fulfilled") structure = structureResult.value;
  } catch {
    throw new Error("Impossibile interrogare la fonte IPA in questo momento.");
  }

  if (!entity) notFound();

  const responsible = responsibleLabel(
    entity.responsabile.titolo,
    entity.responsabile.nome,
    entity.responsabile.cognome,
  );

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span>→</span>
        <Link href="/enti">Enti</Link>
        <span>→</span>
        <span>{entity.codiceIpa}</span>
      </nav>

      <header className={styles.detailHeader}>
        <div>
          <span className={styles.kicker}>SCHEDA ENTE · INDICE PA</span>
          <h1 className={styles.detailTitle}>{entity.denominazione}</h1>
          <p className={styles.detailSubtitle}>
            Codice IPA <strong>{entity.codiceIpa}</strong>
            {entity.acronimo ? ` · ${entity.acronimo}` : ""}
            {entity.dataAggiornamento ? ` · record aggiornato ${entity.dataAggiornamento}` : ""}
          </p>
          <div className={styles.badges}>
            {entity.tipologia && <i className={styles.badge}>{entity.tipologia}</i>}
            {entity.inLiquidazione && (
              <i className={`${styles.badge} ${styles.badgeWarning}`}>ente in liquidazione</i>
            )}
          </div>
        </div>

        {entity.sitoIstituzionale && (
          <a
            className={styles.officialButton}
            href={entity.sitoIstituzionale}
            target="_blank"
            rel="noreferrer"
          >
            Sito istituzionale ↗
          </a>
        )}
      </header>

      <div className={styles.detailGrid}>
        <div className={styles.detailMain}>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <h2>Identità amministrativa</h2>
              <span>fonte IPA</span>
            </div>
            <dl className={styles.definitionGrid}>
              <div className={styles.definition}>
                <dt>Codice IPA</dt>
                <dd>{entity.codiceIpa}</dd>
              </div>
              <div className={styles.definition}>
                <dt>Codice fiscale</dt>
                <dd>{show(entity.codiceFiscale)}</dd>
              </div>
              <div className={styles.definition}>
                <dt>Tipologia</dt>
                <dd>{show(entity.tipologia)}</dd>
              </div>
              <div className={styles.definition}>
                <dt>Codice ISTAT ente</dt>
                <dd>{show(entity.codiceIstat)}</dd>
              </div>
              <div className={styles.definition}>
                <dt>Categoria</dt>
                <dd>{show(entity.codiceCategoria)}</dd>
              </div>
              <div className={styles.definition}>
                <dt>Natura giuridica</dt>
                <dd>{show(entity.codiceNatura)}</dd>
              </div>
              <div className={styles.definition}>
                <dt>Codice ATECO</dt>
                <dd>{show(entity.codiceAteco)}</dd>
              </div>
              <div className={styles.definition}>
                <dt>Responsabile</dt>
                <dd>{responsible}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div className={styles.headingWithIcon}>
                <HugeiconsIcon icon={HierarchyIcon} size={21} strokeWidth={1.5} aria-hidden="true" />
              <h2 id="struttura-ipa">Struttura dichiarata in IPA</h2>
              </div>
              <span>UO e AOO · fonte AgID</span>
            </div>

            {structure ? (
              <>
                <div className={styles.structureSummary}>
                  <div><strong>{structure.unitaOrganizzative.total}</strong><span>unità organizzative</span></div>
                  <div><strong>{structure.areeOrganizzativeOmogenee.total}</strong><span>aree di protocollo</span></div>
                  <div><strong>giornaliera</strong><span>cadenza dichiarata</span></div>
                </div>

                {structure.unitaOrganizzative.records.length > 0 ? (
                  <div className={styles.structureList}>
                    {structure.unitaOrganizzative.records.slice(0, 24).map((unit) => (
                      <article className={styles.structureRow} key={unit.codice}>
                        <span className={styles.structureMark} aria-hidden="true"><i /></span>
                        <div>
                          <strong>{unit.denominazione}</strong>
                          <small>
                            UO {unit.codice}
                            {unit.codicePadre ? ` · dipende dalla UO ${unit.codicePadre}` : " · livello padre non indicato"}
                          </small>
                        </div>
                        {unit.codiceAoo && <code>AOO {unit.codiceAoo}</code>}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className={styles.disclaimer}>IPA non pubblica Unità Organizzative per questo ente.</p>
                )}

                {structure.unitaOrganizzative.total > 24 && (
                  <p className={styles.structureLimit}>
                    Mostriamo le prime 24 unità in ordine alfabetico. L&apos;API espone pagine fino a 500 record tramite <code>limit</code> e <code>offset</code>.
                  </p>
                )}

                <div className={styles.structureLinks}>
                  <a href={IPA_UO_DATASET_URL} target="_blank" rel="noreferrer">Dataset UO <span>↗</span></a>
                  <a href={IPA_AOO_DATASET_URL} target="_blank" rel="noreferrer">Dataset AOO <span>↗</span></a>
                  <Link href={`/api/enti/${encodeURIComponent(entity.codiceIpa)}/struttura`}>
                    API struttura <span>→</span>
                  </Link>
                </div>
              </>
            ) : (
              <div className={styles.structureUnavailable}>
                <HugeiconsIcon icon={LegalDocument01Icon} size={22} strokeWidth={1.5} aria-hidden="true" />
                <div>
                  <strong>La struttura IPA non risponde in questo momento.</strong>
                  <p>La scheda anagrafica resta valida; non sostituiamo UO e AOO con una gerarchia inferita dai nomi.</p>
                </div>
              </div>
            )}

            <p className={styles.disclaimer}>
              Le UO non sono automaticamente “dipartimenti”: IPA descrive uffici e relazioni dichiarate dall&apos;ente.
              Per direzioni generali e strutture giuridiche fanno fede anche regolamenti e pagine di Amministrazione trasparente.
            </p>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <h2>Sede e contatti pubblicati</h2>
              <span>fonte IPA</span>
            </div>
            <div className={styles.contactList}>
              <div className={styles.contact}>
                <span>Indirizzo</span>
                <b>{show(entity.sede.indirizzo)}</b>
              </div>
              <div className={styles.contact}>
                <span>CAP</span>
                <b>{show(entity.sede.cap)}</b>
              </div>
              <div className={styles.contact}>
                <span>Comune ISTAT</span>
                <b>{show(entity.sede.codiceComuneIstat)}</b>
              </div>
              {entity.email.map((mail) => (
                <div className={styles.contact} key={`${mail.indirizzo}-${mail.tipo ?? "mail"}`}>
                  <span>{mail.tipo ?? "email"}</span>
                  <a href={`mailto:${mail.indirizzo}`}>{mail.indirizzo}</a>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <h2>Dati economici</h2>
              <span>collegamenti in corso</span>
            </div>
            <div className={styles.futureData}>
              <div className={styles.futureRow}>
                <strong>Pagamenti e serie storiche</strong>
                <span>SIOPE / OpenBDAP</span>
              </div>
              <div className={styles.futureRow}>
                <strong>Contratti e fornitori</strong>
                <span>ANAC / BDNCP</span>
              </div>
              <div className={styles.futureRow}>
                <strong>Progetti, opere e PNRR</strong>
                <span>CUP / ReGiS / OpenCoesione</span>
              </div>
              <div className={styles.futureRow}>
                <strong>Consulenze e incarichi</strong>
                <span>Funzione Pubblica</span>
              </div>
            </div>
            <p className={styles.disclaimer}>
              Non mostriamo grafici economici finché il relativo record non è collegato a una fonte
              ufficiale verificabile. La pagina è già il punto canonico su cui verranno innestati i dataset finanziari.
            </p>
          </section>
        </div>

        <aside className={styles.detailSide}>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <h2>Provenienza</h2>
              <span>record sorgente</span>
            </div>
            <div className={styles.provenance}>
              <div className={styles.provenanceRow}>
                <span>Dataset</span>
                <a href={IPA_ENTI_DATASET_URL} target="_blank" rel="noreferrer">Indice PA · Enti ↗</a>
              </div>
              <div className={styles.provenanceRow}>
                <span>Titolare</span>
                <b>Agenzia per l&apos;Italia Digitale</b>
              </div>
              <div className={styles.provenanceRow}>
                <span>Resource ID</span>
                <b>{IPA_ENTI_RESOURCE_ID}</b>
              </div>
              <div className={styles.provenanceRow}>
                <span>Licenza</span>
                <b>{IPA_LICENSE}</b>
              </div>
              <div className={styles.provenanceRow}>
                <span>Frequenza</span>
                <b>giornaliera</b>
              </div>
              <div className={styles.provenanceRow}>
                <span>Data record</span>
                <b>{show(entity.dataAggiornamento)}</b>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <h2>API DoveVannoINostriSoldi</h2>
              <span>json</span>
            </div>
            <div className={styles.provenanceRow}>
              <span>Endpoint normalizzato</span>
              <Link href={`/api/enti/${encodeURIComponent(entity.codiceIpa)}`}>
                /api/enti/{entity.codiceIpa} →
              </Link>
            </div>
            <p className={styles.disclaimer}>
              L&apos;endpoint aggiunge metadati di provenienza e normalizza i campi, ma non modifica il significato del record IPA.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
