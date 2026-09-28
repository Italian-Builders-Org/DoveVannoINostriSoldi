import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RealEstateExplorer, RealEstateMap } from "@/components/real-estate-map";
import { integer } from "@/lib/format";
import { getRealEstateNationalData } from "@/lib/real-estate-map-points";

export const metadata: Metadata = {
  title: "Patrimonio pubblico fermo",
  description:
    "Fabbricati di Comuni ed enti per l'edilizia residenziale pubblica dichiarati non utilizzati, inutilizzabili o in ristrutturazione nel censimento MEF.",
  alternates: { canonical: "/patrimonio" },
};

export default async function PatrimonioPage() {
  const data = await getRealEstateNationalData();
  return (
    <main className="shell page">
      <header className="page-intro">
        <p className="eyebrow">Patrimonio pubblico · MEF</p>
        <h1>Fabbricati pubblici fermi</h1>
        <p>
          Fabbricati posseduti da Comuni ed enti per l’edilizia residenziale pubblica che l’ente dichiara non
          utilizzati, inutilizzabili o in ristrutturazione. Sono dichiarazioni, non verifiche: un bene fermo non è di
          per sé uno spreco, e può non essere agibile né affittabile.
        </p>
      </header>

      <section className="panel" aria-labelledby="mappa-patrimonio">
        <h2 id="mappa-patrimonio" className="panel-title">Fabbricati fermi · {integer(data.total)} in Italia</h2>
        {/* The URL is only known in the browser: the prerendered HTML is the national view. */}
        <Suspense fallback={<RealEstateMap {...data} />}>
          <RealEstateExplorer {...data} />
        </Suspense>
      </section>

      <section className="panel" aria-labelledby="limiti-patrimonio">
        <h2 id="limiti-patrimonio" className="panel-title">Come leggere la mappa</h2>
        <p>
          La mappa colora le regioni secondo i fabbricati fermi del censimento degli immobili pubblici (rilascio 2023);
          dentro una regione i Comuni sono in classifica, per numero di fabbricati o in rapporto ai contribuenti IRPEF
          2024 del Comune, che non sono i residenti. Né la pagina né il dataset pubblicano la posizione dei singoli
          edifici. Terreni e beni affittati o concessi a terzi, comprese le case popolari abitate, sono esclusi. Un bene
          in comproprietà è contato una volta per ogni ente proprietario.
        </p>
        <p>
          Il censimento include enti che non hanno inviato la comunicazione 2023: per loro i dati possono risalire a
          un censimento precedente. Confini: ISTAT, 1° gennaio 2026. Dati nel catalogo:{" "}
          <Link href="/dati/mef-patrimonio-fabbricati-fermi-2023">fabbricati fermi</Link>,{" "}
          <Link href="/dati/mef-patrimonio-beni-2023">beni</Link> e{" "}
          <Link href="/dati/mef-patrimonio-contratti-2023">contratti</Link> per ente,{" "}
          <Link href="/dati/mef-patrimonio-adempimento-2023">comunicazione 2023</Link>.
        </p>
      </section>
    </main>
  );
}
