export const MOBILITA_ROMA_BUS_LIVE_TOOL = "mobilita_roma_bus_live" as const;

export const MOBILITA_ROMA_BUS_LIVE_UI_URI = "ui://mobilita/roma-bus-live.html";

export const MOBILITY_LIVE_TOOLS_URI = "dvns://mobility-live-tools";

export type MobilityLiveToolDescriptor = {
  id: typeof MOBILITA_ROMA_BUS_LIVE_TOOL;
  mcpTool: typeof MOBILITA_ROMA_BUS_LIVE_TOOL;
  title: string;
  summary: string;
  freshness: "live";
  filters: readonly string[];
  uiResource: typeof MOBILITA_ROMA_BUS_LIVE_UI_URI;
  portalUrl: string;
  caveat: string;
  sources: readonly {
    id: string;
    name: string;
    owner: string;
    url: string;
    feedUrl: string;
    license: string;
    cadence: string;
  }[];
};

export const mobilityLiveToolsCatalog: MobilityLiveToolDescriptor[] = [
  {
    id: MOBILITA_ROMA_BUS_LIVE_TOOL,
    mcpTool: MOBILITA_ROMA_BUS_LIVE_TOOL,
    title: "Bus ATAC e Roma TPL in tempo reale (Roma)",
    summary:
      "Posizioni live degli autobus sul territorio di Roma Capitale dal feed GTFS-Realtime VehiclePositions ufficiale. Tram e metro non sono nel feed.",
    freshness: "live",
    filters: ["linea", "limit"],
    uiResource: MOBILITA_ROMA_BUS_LIVE_UI_URI,
    portalUrl: "https://www.dovevannoinostrisoldi.com/mappe/mobilita?vista=bus-live",
    caveat:
      "Dato live, non storico: le posizioni hanno 30-60 secondi di ritardo all'origine e non vengono interpolate o archiviate. Alcune linee possono mancare dal feed anche in orario di servizio.",
    sources: [
      {
        id: "roma-servizi-mobilita-rt",
        name: "GTFS-Realtime VehiclePositions Roma",
        owner: "Roma Servizi per la Mobilità (ATAC e Roma TPL)",
        url: "https://romamobilita.it/sistemi-e-tecnologie/open-data/",
        feedUrl: "https://romamobilita.it/sites/default/files/rome_rtgtfs_vehicle_positions_feed.pb",
        license: "Licenza open data del titolare (Roma Servizi per la Mobilità)",
        cadence: "Aggiornamento del feed circa ogni 30 secondi",
      },
    ],
  },
];
