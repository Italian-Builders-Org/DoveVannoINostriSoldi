export type SiteSupporter = Readonly<{
  name: string;
  /** Public profile when known; omit for anonymous or name-only acknowledgements. */
  href?: string;
  contribution: string;
}>;

/**
 * Donatori individuali riconosciuti pubblicamente su Buy Me a Coffee.
 * Aggregati per nome pubblico; i contributi ripetuti con lo stesso nome sono sommati.
 * I contributi anonimi restano sotto “Someone”. Ordinati dal primo sostegno pubblico,
 * con il gruppo anonimo alla fine.
 */
export const INDIVIDUAL_SUPPORTERS: readonly SiteSupporter[] = [
  {
    name: "@Clodo76",
    href: "https://github.com/Clodo76",
    contribution:
      "Primo sostegno su Buy Me a Coffee: 500 ai compute. «Progetto meritevole».",
  },
  {
    name: "giuseppe russo",
    contribution: "Sostegno su Buy Me a Coffee (10 ai compute).",
  },
  {
    name: "@chochoichoy",
    href: "https://x.com/chochoichoy",
    contribution:
      "Sostegni su Buy Me a Coffee (10 ai compute). «grazie per portare avanti questo progetto!»",
  },
  {
    name: "Francesco Cecchetti",
    contribution:
      "Sostegni su Buy Me a Coffee (11 ai compute). «❤️ avanti così» «perchè sì!»",
  },
  {
    name: "Crisnulli",
    contribution: "Sostegno su Buy Me a Coffee (10 ai compute).",
  },
  {
    name: "@scacciavillani",
    href: "https://x.com/scacciavillani",
    contribution: "Sostegno su Buy Me a Coffee (5 ai compute).",
  },
  {
    name: "@HyDrogu",
    href: "https://x.com/HyDrogu",
    contribution:
      "Sostegno su Buy Me a Coffee (10 ai compute). «Complimenti ragazzi, continuate così 🦾»",
  },
  {
    name: "Marco rossi",
    contribution: "Sostegno su Buy Me a Coffee (10 ai compute). «Bel lavoro! Complimenti»",
  },
  {
    name: "Nicole",
    contribution: "Sostegno su Buy Me a Coffee (10 ai compute). «Ottimo lavoro! Continuate così»",
  },
  {
    name: "Luca Celati",
    contribution: "Sostegno su Buy Me a Coffee (5 ai compute).",
  },
  {
    name: "Aldo Colamartino",
    contribution:
      "Sostegno su Buy Me a Coffee (5 ai compute). «Accountability, accountability e trasparenza ci vogliono.»",
  },
  {
    name: "@MrPolitano",
    href: "https://x.com/MrPolitano",
    contribution:
      "Sostegno su Buy Me a Coffee (5 ai compute). «È l'inizio del cambiamento. Forza ragazzi e grazie»",
  },
  {
    name: "@herr_man",
    href: "https://x.com/herr_man",
    contribution:
      "Sostegno su Buy Me a Coffee (5 ai compute). «bravi coder mi fate un po' invidia :)»",
  },
  {
    name: "silvano_cibien",
    contribution:
      "Sostegno su Buy Me a Coffee (50 ai compute). «State facendo un miracolo utile sperando che qualche politico si accorga che qualcosa si può fare»",
  },
  {
    name: "Ilaria",
    contribution:
      "Sostegno su Buy Me a Coffee (5 ai compute). «C'è tanto tanto bisogno di questo progetto! Il migliore utilizzo dell'AI che ho visto fino ad ora, con lo spirito giusto. Grazie grazie!!»",
  },
  {
    name: "@alexguar",
    href: "https://x.com/alexguar",
    contribution: "Sostegno su Buy Me a Coffee (5 ai compute). «Finalmente. Grazie.»",
  },
  {
    name: "@GalloDaSballo",
    href: "https://x.com/GalloDaSballo",
    contribution:
      "Sostegno su Buy Me a Coffee (1000 ai compute). «Conoscerete la verità e la verità vi renderà liberi»",
  },
  {
    name: "@iamandreafranco",
    href: "https://x.com/iamandreafranco",
    contribution:
      "Sostegno su Buy Me a Coffee (5 ai compute). «che per una volta la trasparenza non sia solo nel bicchiere di Vodka 😬»",
  },
  {
    name: "@diegograziani",
    href: "https://x.com/diegograziani",
    contribution:
      "Sostegno su Buy Me a Coffee (1 ai compute). «Eccellente lavoro ragazzi, impressionante!!»",
  },
  {
    name: "@tedin777",
    href: "https://x.com/tedin777",
    contribution: "Sostegno su Buy Me a Coffee (1 ai compute).",
  },
  {
    name: "@piergiudipalo",
    href: "https://x.com/piergiudipalo",
    contribution:
      "Sostegno su Buy Me a Coffee (50 ai compute). «Forza ragazzi, continuate così! Questo può fare la differenza!!!»",
  },
  {
    name: "Lorenzo",
    contribution: "Sostegni su Buy Me a Coffee (30 ai compute).",
  },
  {
    name: "Marco Amodio",
    contribution: "Sostegno su Buy Me a Coffee (5 ai compute). «Forza 💪🏼»",
  },
  {
    name: "Stefano",
    contribution: "Sostegno su Buy Me a Coffee (3 ai compute).",
  },
  {
    name: "M",
    contribution: "Sostegno su Buy Me a Coffee (80 ai compute).",
  },
  {
    name: "@pgdonzelli",
    href: "https://x.com/pgdonzelli",
    contribution: "Sostegno su Buy Me a Coffee (10 ai compute). «👏👏👏👏»",
  },
  {
    name: "@BoccardoReal",
    href: "https://x.com/BoccardoReal",
    contribution: "Sostegno su Buy Me a Coffee (100 ai compute). «Studiare serve.»",
  },
  {
    name: "Someone",
    contribution: "Sostegni anonimi su Buy Me a Coffee (5 ai compute in totale).",
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
