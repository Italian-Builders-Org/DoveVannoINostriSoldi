export const GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_HREF = "/api/governi/dati";
export const GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_FILENAME = "government-scorecard-downloads.json";

const DOWNLOADS = [
  {
    id: "score-data",
    filename: "government-scorecard-data.json",
    category: "data",
    label: "Dati usati nel voto",
    description: "I dati annuali AMECO congelati su cui viene calcolato il voto.",
  },
  {
    id: "page-data",
    filename: "government-scorecard-page-data.json.gz",
    category: "data",
    label: "Dati di grafici e contesto",
    description: "Le serie mostrate nei grafici e il contesto documentato, che non cambiano il voto.",
  },
  {
    id: "methodology",
    filename: "government-scorecard-methodology.json",
    category: "methodology",
    label: "Metodo di calcolo",
    description: "Formula, indicatori, pesi, serie AMECO e trasformazioni del voto.",
  },
  {
    id: "chronology",
    filename: "government-scorecard-chronology.json",
    category: "chronology",
    label: "Cronologia dei governi",
    description: "Date istituzionali e fonti della Presidenza della Repubblica.",
  },
  {
    id: "score-provenance",
    filename: "government-scorecard-score-provenance.json",
    category: "provenance",
    label: "Provenienza del voto",
    description: "Fonte, vintage, periodo, serie, licenza e regole di acquisizione dei dati AMECO.",
  },
  {
    id: "page-provenance",
    filename: "government-scorecard-page-provenance.json",
    category: "provenance",
    label: "Provenienza di grafici e contesto",
    description: "Query, unità, frequenze, derivazioni e controlli delle serie della pagina.",
  },
] as const;

export const GOVERNMENT_SCORECARD_DOWNLOADS = DOWNLOADS.map((download) => ({
  ...download,
  href: `${GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_HREF}/${download.id}`,
}));
