import type { Metadata } from "next";
import IntegratedDomainHub from "@/components/integrated-domain-hub";

export const metadata: Metadata = {
  title: "Trasparenza e verifiche",
  description: "Documenti mancanti, URL, segnalazioni, benchmark e atti di controllo da verificare.",
};

export default function TransparencyPage() {
  return (
    <IntegratedDomainHub
      title="Documenti, segnali e verifiche"
      introduction="Problemi di trasparenza, URL catalogati, segnalazioni, benchmark, atti di controllo, enti e lotti di candidati sono esposti con lo stato probatorio dichiarato."
      domains={[
        "transparency",
        "evidence",
        "oversight",
        "sources",
        "entities",
        "benchmarks",
        "candidate-batches",
      ]}
      editorialSection="trasparenza"
      interpretation="Documento mancante o scostamento vanno verificati e possono motivare accesso civico. Non provano da soli occultamento o spreco. Gli importi negli atti non sono automaticamente danni accertati."
      related={[
        {
          href: "/controlli/segnalazioni",
          title: "Segnalazioni da verificare",
          summary: "Domande pubbliche ordinate per priorità, tipo ed ente, tutte collegate a una fonte.",
          metric: "168 casi",
        },
        {
          href: "/controlli/corte-dei-conti",
          title: "Atti della Corte dei conti",
          summary: "Atti e importi citati con il confine esplicito fra oggetto dell’atto e danno.",
          metric: "87 atti",
        },
        {
          href: "/confronti/catalogo",
          title: "Benchmark da rendere omogenei",
          summary: "Consulenze, contratti e istituzioni passano da un gate di comparabilità.",
          metric: "90 benchmark",
        },
        {
          href: "/controlli/working-set",
          title: "Working set dei candidati",
          summary: "Quattro lotti contabilizzati, separati dalle segnalazioni editoriali e non etichettati come sprechi.",
          metric: "3.144 righe",
        },
      ]}
    />
  );
}
