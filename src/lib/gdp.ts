import { eurostatGdpData, eurostatGdpMetadata } from "@/lib/eurostat-gdp-snapshot";

const LEVEL_SCALE = 10;
const RATE_SCALE = 10;

const GEO_LABELS = {
  IT: "Italia",
  FR: "Francia",
  DE: "Germania",
  ES: "Spagna",
} as const;

function millionEuro(tenths: number): number {
  return tenths / LEVEL_SCALE;
}

function rate(tenths: number): number {
  return tenths / RATE_SCALE;
}

export function getGdpView() {
  const latestQuarter = eurostatGdpData.quarterlyObservations.at(-1);
  const latestAnnual = eurostatGdpData.annualObservations.at(-1);
  if (!latestQuarter || !latestAnnual) {
    throw new Error("Snapshot Eurostat GDP senza osservazioni Italia");
  }

  const quarterly = eurostatGdpData.quarterlyObservations.map((row) => ({
    period: row.period,
    nominalMillionEuro: millionEuro(row.nominalMillionEuroTenths),
    realMillionEuro: millionEuro(row.realMillionEuroTenths),
    yoyGrowth: rate(row.yoyGrowthTenths),
    qoqGrowth: rate(row.qoqGrowthTenths),
    finalConsumptionShare: rate(row.finalConsumptionShareTenths),
    investmentShare: rate(row.grossFixedCapitalFormationShareTenths),
    exportsShare: rate(row.exportsShareTenths),
    importsShare: rate(row.importsShareTenths),
    netExportsShare: rate(row.exportsShareTenths - row.importsShareTenths),
    flags: row.flags ?? null,
  }));

  const annual = eurostatGdpData.annualObservations.map((row) => ({
    period: row.period,
    nominalMillionEuro: millionEuro(row.nominalMillionEuroTenths),
    realMillionEuro: millionEuro(row.realMillionEuroTenths),
    yoyGrowth: rate(row.yoyGrowthTenths),
    flags: row.flags ?? null,
  }));

  const peerPeriod = eurostatGdpData.period.peers.to;
  const peers = eurostatGdpData.geographies.map((geo) => {
    const row = eurostatGdpData.peerObservations.find(
      (observation) => observation.geo === geo.code && observation.period === peerPeriod,
    );
    if (!row) throw new Error(`Confronto PIL senza ${geo.code} ${peerPeriod}`);
    return {
      geo: geo.code,
      label: GEO_LABELS[geo.code],
      period: peerPeriod,
      yoyGrowth: rate(row.yoyGrowthTenths),
      provisional: row.flag === "p",
    };
  });

  const components = [
    { key: "consumption", label: "Consumi finali (P3)", value: quarterly.at(-1)!.finalConsumptionShare },
    { key: "investment", label: "Investimenti fissi (P51G)", value: quarterly.at(-1)!.investmentShare },
    { key: "exports", label: "Esportazioni (P6)", value: quarterly.at(-1)!.exportsShare },
    { key: "imports", label: "Importazioni (P7)", value: quarterly.at(-1)!.importsShare },
  ];

  return {
    metadata: eurostatGdpMetadata,
    caveats: eurostatGdpData.caveats,
    latestQuarter: quarterly.at(-1)!,
    latestAnnual: annual.at(-1)!,
    quarterly,
    annual,
    peers,
    components,
    historyMaxAbsGrowth: Math.max(...quarterly.map((row) => Math.abs(row.yoyGrowth)), 1),
  };
}
