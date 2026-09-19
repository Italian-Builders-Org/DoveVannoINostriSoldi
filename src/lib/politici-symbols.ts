export type PartySymbol = {
  family: string;
  label: string;
  assetUrl: string;
  sourceUrl: string;
  credit: string;
  version: string;
};

/** Identification assets, not party membership data or AGPL-licensed artwork. */
export const PARTY_SYMBOLS: readonly PartySymbol[] = [
  { family: "alleanza-verdi-sinistra", label: "Alleanza Verdi e Sinistra", assetUrl: "https://verdisinistra.it/wp-content/uploads/2022/08/AVS-Simbolo.png", sourceUrl: "https://verdisinistra.it/materiali/", credit: "Alleanza Verdi e Sinistra", version: "Materiali 2022" },
  { family: "azione", label: "Azione", assetUrl: "https://upload.wikimedia.org/wikipedia/commons/1/1f/Azione_logo.png", sourceUrl: "https://commons.wikimedia.org/wiki/File:Azione_logo.png", credit: "Azione; archivio Wikimedia Commons", version: "Logotipo 2019, file 2020" },
  { family: "forza-italia", label: "Forza Italia", assetUrl: "https://forzaitalia.it/wp-content/uploads/2024/01/LOGO-FI-sotto-copia.png", sourceUrl: "https://forzaitalia.it/", credit: "Forza Italia", version: "File 2024, pubblicato nel sito ufficiale" },
  { family: "fratelli-italia", label: "Fratelli d’Italia", assetUrl: "https://www.fratelli-italia.it/wp-content/uploads/2023/10/fdi-LOGO-PNG.png", sourceUrl: "https://www.fratelli-italia.it/logo/", credit: "Fratelli d’Italia", version: "Simbolo senza nome del candidato, file 2023" },
  { family: "italia-viva", label: "Italia Viva", assetUrl: "https://d3n8a8pro7vhmx.cloudfront.net/comitaticivici/pages/1570/attachments/original/1572013417/italiaviva-simbolo_elettorale-RGB.jpg", sourceUrl: "https://www.italiaviva.it/logoufficiale", credit: "Italia Viva", version: "Simbolo elettorale 2019" },
  { family: "lega", label: "Lega", assetUrl: "https://legaonline.it/wp-content/uploads/sites/4/2022/09/logo-lega-header.png", sourceUrl: "https://legaonline.it/", credit: "Lega per Salvini Premier", version: "File 2022, pubblicato nel sito ufficiale" },
  { family: "movimento-5-stelle", label: "MoVimento 5 Stelle", assetUrl: "https://www.movimento5stelle.eu/wp-content/uploads/2021/07/Logo-M5S-2050.png", sourceUrl: "https://www.movimento5stelle.eu/", credit: "MoVimento 5 Stelle", version: "Simbolo 2050, file 2021" },
  { family: "partito-democratico", label: "Partito Democratico", assetUrl: "https://thumb.wikimedia.org/wikipedia/it/thumb/d/d0/Partito_Democratico_-_Logo_elettorale.svg/250px-Partito_Democratico_-_Logo_elettorale.svg.png", sourceUrl: "https://it.wikipedia.org/wiki/File:Partito_Democratico_-_Logo_elettorale.svg", credit: "Nicola Storto / Associazione Partito Democratico; archivio Wikipedia", version: "Simbolo elettorale 2007" },
];

export const SYMBOLS_OBSERVED_DATE = "2026-09-18";

export function partySymbol(family: string | null | undefined): PartySymbol | null {
  return PARTY_SYMBOLS.find((symbol) => symbol.family === family) ?? null;
}
