export type StateAdministrationIdentity = {
  ipaCode: string;
  entityApiPath: string;
  joinMethod: "curated-exact";
  verifiedAt: string;
  sources: {
    openBdap: string;
    ipa: string;
  };
};

type Mapping = {
  openBdapLabel: string;
  ipaCode: string;
};

export const STATE_ADMINISTRATION_IPA_CODES: Readonly<Record<string, Mapping>> = {
  "2": { openBdapLabel: "MINISTERO DELL'ECONOMIA E DELLE FINANZE", ipaCode: "m_ef" },
  "3": { openBdapLabel: "MINISTERO DELLE IMPRESE E DEL MADE IN ITALY", ipaCode: "m_svec" },
  "4": { openBdapLabel: "MINISTERO DEL LAVORO E DELLE POLITICHE SOCIALI", ipaCode: "m_lps" },
  "5": { openBdapLabel: "MINISTERO DELLA GIUSTIZIA", ipaCode: "m_dg" },
  "6": {
    openBdapLabel: "MINISTERO DEGLI AFFARI ESTERI E DELLA COOPERAZIONE INTERNAZIONALE",
    ipaCode: "m_ae",
  },
  "7": { openBdapLabel: "MINISTERO DELL'ISTRUZIONE E DEL MERITO", ipaCode: "m_pi" },
  "8": { openBdapLabel: "MINISTERO DELL'INTERNO", ipaCode: "m_it" },
  "9": {
    openBdapLabel: "MINISTERO DELL'AMBIENTE E DELLA SICUREZZA ENERGETICA",
    ipaCode: "m_amte",
  },
  "10": {
    openBdapLabel: "MINISTERO DELLE INFRASTRUTTURE E DEI TRASPORTI",
    ipaCode: "m_inf",
  },
  "11": { openBdapLabel: "MINISTERO DELL'UNIVERSITA' E DELLA RICERCA", ipaCode: "KH5RHFCV" },
  "12": { openBdapLabel: "MINISTERO DELLA DIFESA", ipaCode: "m_d" },
  "13": {
    openBdapLabel: "MINISTERO DELL'AGRICOLTURA, DELLA SOVRANITA' ALIMENTARE E DELLE FORESTE",
    ipaCode: "m_paf",
  },
  "14": { openBdapLabel: "MINISTERO DELLA CULTURA", ipaCode: "m_bac" },
  "15": { openBdapLabel: "MINISTERO DELLA SALUTE", ipaCode: "m_sa" },
  "16": { openBdapLabel: "MINISTERO DEL TURISMO", ipaCode: "WQF3ZW8F" },
};

const VERIFIED_AT = "2026-08-20";

export function getStateAdministrationIdentity(
  openBdapCode: string,
  openBdapLabel: string,
): StateAdministrationIdentity | null {
  const mapping = STATE_ADMINISTRATION_IPA_CODES[openBdapCode];
  if (!mapping || mapping.openBdapLabel !== openBdapLabel.trim()) return null;
  return {
    ipaCode: mapping.ipaCode,
    entityApiPath: `/api/enti/${encodeURIComponent(mapping.ipaCode)}`,
    joinMethod: "curated-exact",
    verifiedAt: VERIFIED_AT,
    sources: {
      openBdap: "https://bdap-opendata.rgs.mef.gov.it/content/api",
      ipa: "https://www.indicepa.gov.it/ipa-dati/dataset/enti",
    },
  };
}
