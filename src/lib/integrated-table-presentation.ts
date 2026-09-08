/** Presentation only: every source column remains available in the row details.
 * Unknown columns stay visible. Do not use this projection for exports or queries.
 */
const technicalKeys = new Set([
  'id', 'id_segnalazione', 'ipa', 'codice_ipa', 'cf', 'cf_ente', 'cf_contraente',
  'cf_aggiudicatario', 'cf_fornitore', 'cf_sa', 'cf_controllante', 'cf_piva', 'fonte_cf',
  'codice_fiscale', 'codice_fiscale_soggetto_attuatore', 'codice_ipa_sa', 'partita_iva',
  'piva_codfiscale_sog_titolare', 'codice_regione', 'codice_comune_istat', 'codice_istat_comune',
  'codice_istat', 'codice_catastale', 'altri_codici_anagrafici', 'codice_comune_sogg_titolare',
  'codice_sottocateg_soggetto', 'codice_categoria_soggetto', 'codice_area_soggetto',
  'codice_natura', 'stp', 'codice_stp', 'cr_openbdap', 'codice_dataset', 'fonte_file',
  'sku_cerebro', 'identificativo_lotto', 'progressivo_partecipante', 'codice_locale_progetto',
  'codice_univoco_misura', 'codice_univoco_submisura', 'codice_disciplina',
  'codice_categoria', 'codice_ce2', 'codice_ce3', 'entity_code', 'tax_code',
  'ipa_join_status', 'region_join_status', 'management_code', 'title_code',
  'valid_from', 'valid_to', 'data_di_estrazione',
  'codice_amministrazione_rgs', 'codice_istituzione',
]);

function normalizedKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[\s/]+/g, '_');
}

export function isTechnicalTableColumn(key: string): boolean {
  return technicalKeys.has(normalizedKey(key));
}

const leadingKeys = new Set(['ente', 'amministrazione', 'entity_name', 'denominazione', 'ragione_sociale', 'nome', 'titolo_progetto', 'soggetto_titolare']);

export function splitTableColumns(headers: readonly string[], datasetId?: string) {
  const isDetail = (key: string) => isTechnicalTableColumn(key)
    || (datasetId === 'affitti-immobili' && ['categoria', 'tipo'].includes(normalizedKey(key)))
    || (datasetId?.startsWith('siope-uscite-') === true && ['entity_type', 'compartment'].includes(normalizedKey(key)));
  const priority = (key: string) => normalizedKey(key) === 'strato' ? 0 : leadingKeys.has(normalizedKey(key)) ? 1 : 2;
  return {
    primary: headers.filter((key) => !isDetail(key)).sort((a, b) => priority(a) - priority(b)),
    technical: headers.filter(isDetail),
  };
}

const labels: Record<string, string> = {
  strato: 'Livello del dato', ipa: 'Codice IPA', cf: 'Codice fiscale',
  cf_ente: 'Codice fiscale ente', cf_contraente: 'Codice fiscale contraente',
  cf_aggiudicatario: 'Codice fiscale aggiudicatario', cf_fornitore: 'Codice fiscale fornitore',
  cf_piva: 'Codice fiscale o partita IVA', fonte_file: 'File di provenienza',
  entity_code: 'Codice SIOPE', tax_code: 'Codice fiscale', codice_ipa: 'Codice IPA',
  entity_name: 'Ente', entity_type: 'Tipo di ente', year: 'Anno', month: 'Mese',
  codice_amministrazione_rgs: 'Codice amministrazione RGS',
  region: 'Regione', province: 'Provincia', management_label: 'Gestione',
  title_label: 'Titolo di spesa', compartment: 'Comparto', amount_cents: 'Importo (centesimi di euro)',
  valid_from: 'Valido dal', valid_to: 'Valido fino al', source_year: 'Anno della fonte',
  known_amount_cents: 'Importo noto (centesimi di euro)',
  ipa_matched_amount_cents: 'Importo con ente IPA collegato (centesimi di euro)',
  ipa_unmatched_amount_cents: 'Importo senza ente IPA collegato (centesimi di euro)',
  ipa_ambiguous_amount_cents: 'Importo con collegamento IPA ambiguo (centesimi di euro)',
  registry_rows: 'Righe anagrafiche', distinct_siope_codes: 'Codici SIOPE distinti',
  distinct_tax_codes: 'Codici fiscali distinti', valid_at_observation_codes: 'Codici validi alla rilevazione',
  observed_siope_codes: 'Codici SIOPE osservati', without_movements_codes: 'Codici senza movimenti',
  observed_months: 'Mesi osservati', raw_movement_rows: 'Righe dei movimenti',
  ipa_matched: 'Enti collegati a IPA', ipa_unmatched: 'Enti senza collegamento IPA',
  ipa_ambiguous: 'Enti con collegamento IPA ambiguo', coverage_status: 'Stato della copertura',
  coverage_note: 'Nota sulla copertura', product_status: 'Stato di pubblicazione',
  mq: 'Superficie (m²)', canone_annuo_eur: 'Canone annuo (€)', canone_mq: 'Canone al m²',
  chi_autorizzato: 'Chi ha autorizzato', chi_ricevuto: 'Chi ha ricevuto',
  nome_o_ditta: 'Persona o ditta', n_unita: 'Numero di unità', n_atti: 'Numero di atti',
  nome_studio: 'Persona o studio', ragione_sociale: 'Ragione sociale',
  fte: 'Addetti equivalenti a tempo pieno (FTE)', teste: 'Persone',
};

export function tableColumnLabel(key: string): string {
  const normalized = normalizedKey(key);
  if (labels[normalized]) return labels[normalized];
  const words = normalized.replace(/_/g, ' ').replace(/\b(eur|euro)\b/g, '€')
    .replace(/\b(ipa|cig|cup|iva|cpv|pnrr|ssn|fte|ue|cp|rs)\b/g, (word) => word.toUpperCase());
  return words.charAt(0).toUpperCase() + words.slice(1);
}
