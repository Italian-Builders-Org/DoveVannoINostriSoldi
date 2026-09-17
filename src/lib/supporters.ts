export type SiteSupporter = Readonly<{
  name: string;
  /** Public profile when known; omit for anonymous or name-only acknowledgements. */
  href?: string;
  contribution: string;
}>;

export type IndividualSupporter = SiteSupporter & Readonly<{
  /** Buy Me a Coffee coffee_count: unità acquistate, non importo in euro. */
  computeUnits: number;
}>;

/**
 * Donatori individuali riconosciuti pubblicamente su Buy Me a Coffee.
 * Dati pubblici osservati il 29 agosto 2026. Aggregati per nome pubblico
 * visualizzato, che non equivale a un'identità verificata. I contributi
 * anonimi restano in un unico gruppo alla fine.
 */
export const INDIVIDUAL_SUPPORTERS_OBSERVED_AT = "2026-08-29";

export const INDIVIDUAL_SUPPORTERS: readonly IndividualSupporter[] = [
  {
    name: "@Clodo76",
    computeUnits: 500,
    href: "https://github.com/Clodo76",
    contribution:
      "Primo sostegno su Buy Me a Coffee: 500 unità compute. «Progetto meritevole».",
  },
  {
    name: "giuseppe russo",
    computeUnits: 10,
    contribution: "Sostegno su Buy Me a Coffee (10 unità compute).",
  },
  {
    name: "@chochoichoy",
    computeUnits: 10,
    href: "https://x.com/chochoichoy",
    contribution:
      "Sostegni su Buy Me a Coffee (10 unità compute). «grazie per portare avanti questo progetto!»",
  },
  {
    name: "Francesco Cecchetti",
    computeUnits: 11,
    contribution:
      "Sostegni su Buy Me a Coffee (11 unità compute). «❤️ avanti così» «perchè sì!»",
  },
  {
    name: "Crisnulli",
    computeUnits: 10,
    contribution: "Sostegno su Buy Me a Coffee (10 unità compute).",
  },
  {
    name: "@scacciavillani",
    computeUnits: 5,
    href: "https://x.com/scacciavillani",
    contribution: "Sostegno su Buy Me a Coffee (5 unità compute).",
  },
  {
    name: "@HyDrogu",
    computeUnits: 10,
    href: "https://x.com/HyDrogu",
    contribution:
      "Sostegno su Buy Me a Coffee (10 unità compute). «Complimenti ragazzi, continuate così 🦾»",
  },
  {
    name: "Marco rossi",
    computeUnits: 10,
    contribution: "Sostegno su Buy Me a Coffee (10 unità compute). «Bel lavoro! Complimenti»",
  },
  {
    name: "Nicole",
    computeUnits: 10,
    contribution: "Sostegno su Buy Me a Coffee (10 unità compute). «Ottimo lavoro! Continuate così»",
  },
  {
    name: "Luca Celati",
    computeUnits: 5,
    contribution: "Sostegno su Buy Me a Coffee (5 unità compute).",
  },
  {
    name: "Aldo Colamartino",
    computeUnits: 5,
    contribution:
      "Sostegno su Buy Me a Coffee (5 unità compute). «Accountability, accountability e trasparenza ci vogliono.»",
  },
  {
    name: "@MrPolitano",
    computeUnits: 5,
    href: "https://x.com/MrPolitano",
    contribution:
      "Sostegno su Buy Me a Coffee (5 unità compute). «È l'inizio del cambiamento. Forza ragazzi e grazie»",
  },
  {
    name: "@herr_man",
    computeUnits: 5,
    href: "https://x.com/herr_man",
    contribution:
      "Sostegno su Buy Me a Coffee (5 unità compute). «bravi coder mi fate un po' invidia :)»",
  },
  {
    name: "silvano_cibien",
    computeUnits: 50,
    contribution:
      "Sostegno su Buy Me a Coffee (50 unità compute). «State facendo un miracolo utile sperando che qualche politico si accorga che qualcosa si può fare»",
  },
  {
    name: "Ilaria",
    computeUnits: 5,
    contribution:
      "Sostegno su Buy Me a Coffee (5 unità compute). «C'è tanto tanto bisogno di questo progetto! Il migliore utilizzo dell'AI che ho visto fino ad ora, con lo spirito giusto. Grazie grazie!!»",
  },
  {
    name: "@alexguar",
    computeUnits: 5,
    href: "https://x.com/alexguar",
    contribution: "Sostegno su Buy Me a Coffee (5 unità compute). «Finalmente. Grazie.»",
  },
  {
    name: "@GalloDaSballo",
    computeUnits: 1_000,
    href: "https://x.com/GalloDaSballo",
    contribution:
      "Sostegno su Buy Me a Coffee (1000 unità compute). «Conoscerete la verità e la verità vi renderà liberi»",
  },
  {
    name: "@iamandreafranco",
    computeUnits: 5,
    href: "https://x.com/iamandreafranco",
    contribution:
      "Sostegno su Buy Me a Coffee (5 unità compute). «che per una volta la trasparenza non sia solo nel bicchiere di Vodka 😬»",
  },
  {
    name: "@diegograziani",
    computeUnits: 1,
    href: "https://x.com/diegograziani",
    contribution:
      "Sostegno su Buy Me a Coffee (1 unità compute). «Eccellente lavoro ragazzi, impressionante!!»",
  },
  {
    name: "@tedin777",
    computeUnits: 1,
    href: "https://x.com/tedin777",
    contribution: "Sostegno su Buy Me a Coffee (1 unità compute).",
  },
  {
    name: "@piergiudipalo",
    computeUnits: 50,
    href: "https://x.com/piergiudipalo",
    contribution:
      "Sostegno su Buy Me a Coffee (50 unità compute). «Forza ragazzi, continuate così! Questo può fare la differenza!!!»",
  },
  {
    name: "Lorenzo",
    computeUnits: 30,
    contribution: "Sostegni su Buy Me a Coffee (30 unità compute).",
  },
  {
    name: "Marco Amodio",
    computeUnits: 5,
    contribution: "Sostegno su Buy Me a Coffee (5 unità compute). «Forza 💪🏼»",
  },
  {
    name: "Stefano",
    computeUnits: 3,
    contribution: "Sostegno su Buy Me a Coffee (3 unità compute).",
  },
  {
    name: "M",
    computeUnits: 80,
    contribution: "Sostegno su Buy Me a Coffee (80 unità compute).",
  },
  {
    name: "@pgdonzelli",
    computeUnits: 10,
    href: "https://x.com/pgdonzelli",
    contribution: "Sostegno su Buy Me a Coffee (10 unità compute). «👏👏👏👏»",
  },
  {
    name: "@BoccardoReal",
    computeUnits: 100,
    href: "https://x.com/BoccardoReal",
    contribution: "Sostegno su Buy Me a Coffee (100 unità compute). «Studiare serve.»",
  },
  {
    name: "Sostenitori anonimi",
    computeUnits: 5,
    contribution: "Sostegni anonimi su Buy Me a Coffee (5 unità compute in totale).",
  },
];

/** Organisations and communities that provide infrastructure, time or community. */
export const SITE_SUPPORTERS: readonly SiteSupporter[] = [
  {
    name: "Regolo.ai",
    href: "https://regolo.ai/",
    contribution:
      "Accesso illimitato al modello GLM per due mesi, per sperimentare assistenti e analisi sul portale senza spostare i dati fuori dall’UE.",
  },
  {
    name: "Manto Venture",
    href: "https://mantoventure.com",
    contribution: "Supporto al progetto e alla sua messa in produzione.",
  },
  {
    name: "Italian Builders",
    href: "https://italianbuilders.co",
    contribution: "Community di riferimento per chi costruisce prodotti digitali in Italia.",
  },
];
