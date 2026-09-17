import type { Metadata } from "next";
import IntegratedDomainHub from "@/components/integrated-domain-hub";

export const metadata: Metadata = {
  title: "Spese operative · dati di dettaglio",
  description: "Affitti, auto, eventi, campagne, missioni, rimborsi, conti statali e progetti.",
};

export default function OperatingSpendingPage() {
  return (
    <IntegratedDomainHub
      title="Immobili, missioni, eventi e altre spese"
      introduction="Canoni, auto, welfare, missioni, rimborsi, eventi, campagne, capitoli statali e progetti sono consultabili nel perimetro in cui sono stati osservati."
      domains={["operations", "state-accounts", "projects"]}
      editorialSection="spese"
      interpretation="Pagamenti, previsioni e massimali restano separati. I capitoli di missione non sono trasferte individuali. Una spesa documentata non è automaticamente uno spreco."
      related={[
        {
          href: "/spese/consulenze",
          title: "Consulenze ministeriali RGS",
          summary: "Pagamenti 2024-2025 per consulenze e lavoro parasubordinato, già riconciliati alla fonte.",
          metric: "268 righe",
        },
        {
          href: "/spese/territoriale",
          title: "Spesa statale per territorio",
          summary: "Regioni, macroaree e Italia restano livelli distinti su quattro misure contabili.",
          metric: "20.268 righe",
        },
      ]}
    />
  );
}
