import type { Metadata } from "next";
import IntegratedDomainHub from "@/components/integrated-domain-hub";

export const metadata: Metadata = {
  title: "Incarichi, consulenze e personale · dati di dettaglio",
  description: "Incarichi nominativi, consulenze, personale, organi e confronti di esperienza.",
};

export default function AppointmentsDetailPage() {
  return (
    <IntegratedDomainHub
      title="Incarichi, consulenze e personale"
      introduction="Il dettaglio riunisce incarichi nominativi, consulenze legali e PNRR, collaboratori, CV, personale, staff e indennità, mantenendo separati perimetri e strati contabili incompatibili."
      domains={["appointments", "consultancies", "personnel"]}
      editorialSection="incarichi"
      interpretation="Gli incarichi nominativi non si sommano ai capitoli CE3. Un confronto orienta la verifica: non decide da solo se qualcuno è inadeguato."
      related={[
        {
          href: "/incarichi",
          title: "Aggregati nazionali degli incarichi",
          summary: "La serie nazionale DFP resta la vista di contesto per incarichi esterni e ai dipendenti.",
          metric: "dal 2023 al 2026",
        },
        {
          href: "/pnrr/incarichi",
          title: "Incarichi PNRR INDIRE verificati",
          summary: "Il sottoinsieme INDIRE conserva contratti e compensi verificati in una pagina autonoma.",
          metric: "88 incarichi",
        },
      ]}
    />
  );
}
