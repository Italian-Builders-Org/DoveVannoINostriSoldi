/**
 * Path data of the DVNS icon set, free of React so canvas code can reuse it.
 *
 * Grid: 24×24 viewBox, live area 2–22 (2px optical padding), drawn for a
 * 1.75 stroke with round caps and joins and no fill. Every shape is a stroked
 * path — dots are zero-length segments (`h.01`) that the round cap turns into
 * a disc — so the same strings render identically through `<path>` and
 * `CanvasRenderingContext2D.stroke(new Path2D(d))`.
 */

// Shared shapes keep related icons optically identical.
const circle = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0-${2 * r}Z`;
const bubble = "M6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5v-8A2.5 2.5 0 0 1 6.5 4Z";
const tile = (x: number, y: number, w: number, h: number) =>
  `M${x + 1.5} ${y}h${w - 3}a1.5 1.5 0 0 1 1.5 1.5v${h - 3}a1.5 1.5 0 0 1-1.5 1.5h-${w - 3}a1.5 1.5 0 0 1-1.5-1.5v-${h - 3}a1.5 1.5 0 0 1 1.5-1.5Z`;
const openBook = "M12 6.5C10.5 5.2 8.3 4.5 5.5 4.5h-2v14h2c2.8 0 5 .7 6.5 2 1.5-1.3 3.7-2 6.5-2h2v-14h-2c-2.8 0-5 .7-6.5 2Z";

/** Bus pictogram, also drawn on the live mobility map canvas. */
export const BUS_PATHS = [
  "M6.5 3h11A2.5 2.5 0 0 1 20 5.5V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5.5A2.5 2.5 0 0 1 6.5 3Z",
  "M4 12h16",
  "M9 6.5h6",
  "M7.5 15h.01M16.5 15h.01",
  "M7 18v2.5M17 18v2.5",
] as const;

export const ICON_PATHS = {
  // Navigation sections
  home: ["M3.5 10.5 12 3.5l8.5 7", "M5.5 9v11h13V9", "M10 20v-5h4v5"],
  news: [
    "M17 20H6a2 2 0 0 1-2-2V5.5A1.5 1.5 0 0 1 5.5 4h10A1.5 1.5 0 0 1 17 5.5V18a2 2 0 0 0 4 0V9.5A1.5 1.5 0 0 0 19.5 8H17",
    "M7.5 8h6M7.5 12h6M7.5 16h3.5",
  ],
  business: [
    "M5 7h14a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-10A1.5 1.5 0 0 1 5 7Z",
    "M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7",
    "M3.5 12.5h17",
    "M12 11.5v2",
  ],
  education: ["M2.5 9.5 12 5l9.5 4.5L12 14Z", "M6.5 11.5v4c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3v-4", "M21.5 9.5V15"],
  society: [
    circle(9, 8, 3),
    "M3.5 20v-.5A4.5 4.5 0 0 1 8 15h2a4.5 4.5 0 0 1 4.5 4.5v.5",
    "M15.5 5.2a3 3 0 0 1 0 5.6",
    "M17.5 15.2a4.5 4.5 0 0 1 3 4.3v.5",
  ],
  // Spese: a coin stamped with the euro, built on the same arc as `euro`.
  money: [circle(12, 12, 9), "M15.5 8.75A4.5 4.5 0 1 0 15.5 15.25", "M7.5 10.75h5M7.5 13.25h5"],
  economy: ["M4 4v16h16", "M7.5 15.5l3.5-4 3 2.5 5.5-6", "M15.5 8H19.5v4"],
  map: ["M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5L3.5 20Z", "M9 4v13.5M15 6.5V20"],
  projects: [
    "M8 4.5H6.5A1.5 1.5 0 0 0 5 6v13.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H16",
    "M9.5 3h5a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-2a.5.5 0 0 1 .5-.5Z",
    "M8.75 13.25 11 15.5l4.25-4.5",
  ],
  // Istituzioni: a palazzo front with pediment and columns.
  institutions: ["M3.5 9 12 4l8.5 5Z", "M6 12v5M10 12v5M14 12v5M18 12v5", "M3.5 20h17"],
  entities: [
    "M4.5 20.5V5A1.5 1.5 0 0 1 6 3.5h7A1.5 1.5 0 0 1 14.5 5v15.5",
    "M14.5 9.5H18a1.5 1.5 0 0 1 1.5 1.5v9.5",
    "M2.5 20.5h19",
    "M8 8h3M8 11.5h3M8 15h3",
  ],
  checks: [circle(10.5, 10.5, 6.5), "M15.5 15.5 20 20", "M7.75 10.75l1.75 1.75 3.25-3.5"],
  assistant: [bubble, "M12 7.25c.3 1.75 1.5 2.95 3.25 3.25-1.75.3-2.95 1.5-3.25 3.25-.3-1.75-1.5-2.95-3.25-3.25 1.75-.3 2.95-1.5 3.25-3.25Z"],
  // Fonti: a ledger page examined under a magnifier.
  sources: [
    "M11 20.5H6.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5h7L18 8v2.5",
    "M13.5 3.5V7a1 1 0 0 0 1 1H18",
    "M8.5 8h2.5M8.5 11.5h4",
    circle(16, 16, 3),
    "M18.25 18.25 20.5 20.5",
  ],
  // Boards: a dashboard of unequal tiles.
  boards: [tile(3.5, 3.5, 7, 9.5), tile(3.5, 15, 7, 5.5), tile(12.5, 3.5, 8, 5.5), tile(12.5, 11, 8, 9.5)],
  research: [openBook, "M12 6.5v14", "M6.5 9H9M6.5 12.5H9M15 9h2.5M15 12.5h2.5"],

  // Interface
  menu: ["M4 7h16M4 12h16M4 17h16"],
  close: ["M6 6l12 12M18 6 6 18"],
  "chevron-down": ["M6.5 9.5 12 15l5.5-5.5"],
  "chevron-right": ["M9.5 6.5 15 12l-5.5 5.5"],
  "chevron-left": ["M14.5 6.5 9 12l5.5 5.5"],
  "arrow-right": ["M4.5 12h15", "M13.5 6l6 6-6 6"],
  "arrow-up-right": ["M7 17 17 7", "M8.5 7H17v8.5"],
  // iOS-style share: an arrow leaving an open box.
  share: ["M8.5 9.5H7A1.5 1.5 0 0 0 5.5 11v8A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17 9.5h-1.5", "M12 3.5V14", "M8.5 7 12 3.5 15.5 7"],
  search: [circle(11, 11, 6.5), "M16 16l4 4"],
  info: [circle(12, 12, 9), "M12 11v5.5", "M12 7.75h.01"],
  help: [circle(12, 12, 9), "M9.5 9.5a2.5 2.5 0 1 1 3.4 2.35c-.55.22-.9.76-.9 1.35v.55", "M12 16.75h.01"],
  calendar: [
    "M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5Z",
    "M8 3v4M16 3v4",
    "M4 10h16",
    "M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01",
  ],
  flag: ["M5.5 21V3.5", "M5.5 4.5h12.5l-2.5 4 2.5 4H5.5"],
  sun: [
    circle(12, 12, 3.75),
    "M12 3v2M12 19v2M3 12h2M19 12h2",
    "M5.64 5.64l1.41 1.41M16.95 16.95l1.41 1.41M5.64 18.36l1.41-1.41M16.95 7.05l1.41-1.41",
  ],
  moon: ["M20 14.5A8.25 8.25 0 1 1 9.5 4a7.5 7.5 0 0 0 10.5 10.5Z"],
  euro: ["M18 7.4A6.5 6.5 0 1 0 18 16.6", "M4.5 10h8.5M4.5 14h8.5"],
  // Two flat coins, the back one cut where the front one overlaps it.
  coins: ["M15.43 8.57A6 6 0 1 0 8.57 15.43", circle(14.5, 14.5, 6)],
  "chart-column": ["M3.5 20h17", "M5.5 20v-6.5h3V20M10.5 20V6.5h3V20M15.5 20v-10h3v10"],
  building: [
    "M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21",
    "M3.5 21h17",
    "M9.5 7h.01M14.5 7h.01M9.5 10.5h.01M14.5 10.5h.01M9.5 14h.01M14.5 14h.01",
    "M10.5 21v-3h3v3",
  ],
  "book-open": [openBook, "M12 6.5v14"],
  chat: [bubble, "M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"],
  bus: BUS_PATHS,
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICON_PATHS;
