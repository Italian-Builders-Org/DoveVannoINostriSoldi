export type SiteSupporter = Readonly<{
  name: string;
  href: string;
  contribution: string;
}>;

/** Individual donors acknowledged publicly (e.g. Buy Me a Coffee). */
export const INDIVIDUAL_SUPPORTERS: readonly SiteSupporter[] = [
  {
    name: "Clodo76",
    href: "https://github.com/Clodo76",
    contribution:
      "Primo sostegno su Buy Me a Coffee per aiutare a coprire compute e hosting del progetto.",
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
