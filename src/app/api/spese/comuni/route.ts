import { NextResponse } from "next/server";
import { siopeMunicipalSnapshot } from "@/lib/siope-snapshot";
import { getSiopeMunicipalityPeerObservations } from "@/lib/siope-municipality-detail";
import {
  eurosPerSquareKilometreCents,
  getRegionGeography,
  municipalityGeographySource,
} from "@/lib/municipality-geography";
import { istatCodeOfRegion } from "@/lib/italy-regions";

export const dynamic = "force-static";

export function GET() {
  const year = siopeMunicipalSnapshot.year;
  const regions = siopeMunicipalSnapshot.regions.map((region) => {
    const code = istatCodeOfRegion(region.region);
    const geography = code ? getRegionGeography(year, code) : null;
    return {
      region: region.region,
      geography,
      perSquareKmCents: eurosPerSquareKilometreCents(
        Math.round(region.value * 100),
        geography?.surfaceSquareMetres ?? null,
      ),
    };
  });
  const topMunicipalitiesByPerSquareKm = getSiopeMunicipalityPeerObservations(year)
    .slice()
    .sort((left, right) => right.perSquareKmCents - left.perSquareKmCents)
    .slice(0, 100)
    .map((item) => ({
      codiceFiscale: item.taxCode,
      name: item.name,
      province: item.province,
      region: item.region,
      totalCents: item.totalCents,
      perCapitaCents: item.perCapitaCents,
      perSquareKmCents: item.perSquareKmCents,
      geography: item.geography,
    }));
  return NextResponse.json({
    ...siopeMunicipalSnapshot,
    territorialNormalization: {
      measure: "pagamenti comunali per chilometro quadrato",
      source: municipalityGeographySource,
      regions,
      topMunicipalitiesByPerSquareKm,
      caveat: "La misura per km² affianca totale e pro capite; non misura efficienza, qualità o fabbisogno.",
    },
  }, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "X-Data-Source": "SIOPE+IPA",
      "X-Data-Period": `${siopeMunicipalSnapshot.year}-${String(siopeMunicipalSnapshot.latestMonth).padStart(2, "0")}`,
    },
  });
}
