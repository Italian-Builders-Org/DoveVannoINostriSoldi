import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getIpaEntityByCode,
  type IpaEntity,
} from "@/lib/ipa";
import {
  getIpaOrganizationStructure,
  type IpaOrganizationStructure,
} from "@/lib/ipa-structure";
import { integer, longDate } from "@/lib/format";
import {
  decodeEntityProcurementRouteCode,
  getEntityProcurementPage,
  loadAnacEntityProcurementPage,
} from "@/lib/data/anac-entity-procurement-page";
import { getMunicipalityProfile } from "@/lib/municipality-profile";
import { municipalityName } from "@/lib/municipality-name";
import { municipalitySnapshotEntity } from "@/lib/municipality-snapshot-entity";
import { getSiopeMunicipalityDetailByIpaCode } from "@/lib/siope-municipality-detail";
import { MunicipalityEconomics } from "./municipality-economics";
import { EntityInformation } from "./entity-information";
import { EntityProcurementSection } from "./entity-procurement-section";
import styles from "./scheda.module.css";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const entityRobots = { index: false, follow: false } as const;

type PageProps = {
  params: Promise<{ codice: string }>;
};

function responsibleLabel(
  titolo: string | null,
  nome: string | null,
  cognome: string | null,
): string {
  const identity = [nome, cognome].filter(Boolean).join(" ");
  return [titolo, identity].filter(Boolean).join(", ") || "Non indicato da IPA";
}

function anacFallbackEntity(codiceIpa: string, codiceFiscale: string | null): IpaEntity {
  return {
    codiceIpa,
    denominazione: `Ente ${codiceIpa}`,
    codiceFiscale,
    tipologia: "Ente pubblico",
    codiceCategoria: null,
    codiceNatura: null,
    codiceAteco: null,
    inLiquidazione: null,
    codiceMiur: null,
    codiceIstat: null,
    acronimo: null,
    responsabile: { nome: null, cognome: null, titolo: null },
    sede: {
      codiceComuneIstat: null,
      codiceCatastaleComune: null,
      cap: null,
      indirizzo: null,
    },
    email: [],
    sitoIstituzionale: null,
    social: { facebook: null, linkedin: null, twitter: null, youtube: null },
    dataAggiornamento: null,
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { codice } = await params;
  const normalizedCode = decodeEntityProcurementRouteCode(codice);
  if (!normalizedCode) return { title: "Ente non trovato", robots: entityRobots };
  const municipality = getSiopeMunicipalityDetailByIpaCode(normalizedCode);
  if (municipality) {
    return {
      title: municipalityName(municipality.name),
      description: `Scheda pubblica del Comune ${municipalityName(municipality.name)}, Codice IPA ${normalizedCode}.`,
      robots: entityRobots,
    };
  }

  try {
    const entity = await getIpaEntityByCode(normalizedCode);
    if (!entity) return { title: "Ente non trovato", robots: entityRobots };

    return {
      title: entity.denominazione,
      description: `Scheda pubblica dell'ente ${entity.denominazione}, Codice IPA ${entity.codiceIpa}.`,
      robots: entityRobots,
    };
  } catch {
    // Avoid a second live IPA round-trip on failure: the page body already
    // handles snapshot/ANAC fallback without turning upstream 429 into metadata errors.
    return {
      title: `Ente ${normalizedCode}`,
      robots: entityRobots,
    };
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
  let snapshotOnly = entity !== null;
  let ipaUnavailable = false;
  let structure: IpaOrganizationStructure | null = null;
  if (!entity) {
    try {
      entity = await getIpaEntityByCode(normalizedCode);
    } catch {
      ipaUnavailable = true;
      const anacOnly = await loadAnacEntityProcurementPage({
        codiceIpa: normalizedCode,
        currentEntityCf: null,
        verifyLiveFiscalCode: false,
      });
      if (anacOnly.status === "available") {
        entity = anacFallbackEntity(normalizedCode, null);
        snapshotOnly = true;
      } else {
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
  }

  if (!entity) notFound();
  if (!snapshotOnly && !ipaUnavailable) {
    try {
      structure = await getIpaOrganizationStructure(normalizedCode);
    } catch {
      structure = null;
    }
  }
  const [municipalityProfile, procurementState] = await Promise.all([
    getMunicipalityProfile(entity, { allowCommittedIstatIdentity: snapshotOnly }),
    ipaUnavailable
      ? loadAnacEntityProcurementPage({
          codiceIpa: entity.codiceIpa,
          currentEntityCf: entity.codiceFiscale,
          verifyLiveFiscalCode: false,
        })
      : getEntityProcurementPage(entity),
  ]);

  const responsible = responsibleLabel(
    entity.responsabile.titolo,
    entity.responsabile.nome,
    entity.responsabile.cognome,
  );
  const isMunicipality = municipalityProfile !== null;
  const displayName = isMunicipality
    ? municipalityName(municipalityProfile.siope.data.name || entity.denominazione)
    : entity.denominazione;
  const latestMunicipalityYear = municipalityProfile?.siope.data.years[0] ?? null;
  const municipalityGeography = latestMunicipalityYear?.geography ?? null;

  return (
    <main className="shell page">
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/enti">Enti e società</Link>
        <span aria-hidden="true">/</span>
        <span>{isMunicipality ? "Scheda comunale" : "Scheda ente"}</span>
      </nav>

      <div className={`${styles.head} ${styles.municipalityHead}`}>
        <div className="page-intro">
          <h1>{displayName}</h1>
          {isMunicipality ? (
            <p>
              {[
                municipalityProfile.siope.data.province
                  ? `Provincia di ${municipalityProfile.siope.data.province}`
                  : null,
                municipalityProfile.siope.data.region
                  ? `Regione ${municipalityProfile.siope.data.region}`
                  : null,
                entity.dataAggiornamento
                  ? `anagrafe aggiornata al ${longDate(entity.dataAggiornamento)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Scheda comunale da fonti ufficiali verificate"}
            </p>
          ) : (
            <p>
              {entity.tipologia ?? "Ente pubblico"}
              {entity.dataAggiornamento ? ` · aggiornato ${longDate(entity.dataAggiornamento)}` : ""}
            </p>
          )}
          {entity.inLiquidazione ? (
            <div className={styles.badges}>
              <span className="tag tag-accent">ente in liquidazione</span>
            </div>
          ) : null}
        </div>

        {entity.sitoIstituzionale ? (
          <a
            className={styles.institutionalLink}
            href={entity.sitoIstituzionale}
            target="_blank"
            rel="noreferrer"
          >
            Sito istituzionale ↗
          </a>
        ) : null}
      </div>

      {isMunicipality && latestMunicipalityYear ? (
        <dl className={styles.identityStrip} aria-label="Identità territoriale del Comune">
          <div>
            <dt>Popolazione</dt>
            <dd>
              {latestMunicipalityYear.population === null
                ? "Non indicata"
                : integer(latestMunicipalityYear.population)}
            </dd>
            {municipalityGeography?.populationYear ? (
              <small>ISTAT {municipalityGeography.populationYear}</small>
            ) : null}
          </div>
          <div>
            <dt>Densità</dt>
            <dd>
              {municipalityGeography?.densityPerSquareKilometre == null
                ? "n.d."
                : `${integer(Math.round(municipalityGeography.densityPerSquareKilometre))} ab./km²`}
            </dd>
          </div>
          <div>
            <dt>Superficie</dt>
            <dd>
              {municipalityGeography
                ? `${municipalityGeography.surfaceSquareKilometres.toLocaleString("it-IT", { maximumFractionDigits: 2 })} km²`
                : "n.d."}
            </dd>
          </div>
          <div>
            <dt>Codice IPA</dt>
            <dd><code>{entity.codiceIpa}</code></dd>
          </div>
        </dl>
      ) : null}

      {snapshotOnly ? (
        <div className="notice">
          <strong>
            {ipaUnavailable
              ? "Anagrafe IPA temporaneamente non disponibile"
              : "Profilo servito da snapshot verificati"}
          </strong>
          <p>
            {ipaUnavailable
              ? "Mostriamo comunque i contratti ANAC collegati a questo codice IPA. Contatti e uffici restano consultabili nella fonte ufficiale."
              : "Questa visita non interroga Indice PA live; contatti e uffici correnti restano consultabili nella fonte ufficiale."}
          </p>
        </div>
      ) : null}

      <div className={styles.municipalityLayout}>
        {isMunicipality ? <MunicipalityEconomics profile={municipalityProfile} /> : null}
        <EntityProcurementSection state={procurementState} />
        <EntityInformation
          entity={entity}
          responsible={responsible}
          structure={structure}
          snapshotOnly={snapshotOnly}
          snapshotObservedAt={municipalitySnapshot?.years[0]?.observedAt ?? null}
          variant={isMunicipality ? "municipality" : "organization"}
        />
      </div>
    </main>
  );
}
