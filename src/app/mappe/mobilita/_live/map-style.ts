import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

/**
 * Quiet basemap for the live layer: streets, river, parks and Italian names
 * from OpenStreetMap (OpenMapTiles schema served by OpenFreeMap, no API key).
 * Colours are deliberately desaturated so vehicles and the selected line carry
 * the only strong hues on screen.
 */
export const BASEMAP_TILES_URL = "https://tiles.openfreemap.org/planet";
export const BASEMAP_GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · ' +
  'Dati <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';

type Palette = {
  background: string;
  residential: string;
  park: string;
  wood: string;
  water: string;
  waterLabel: string;
  building: string;
  buildingOutline: string;
  building3d: string;
  minor: string;
  major: string;
  majorCasing: string;
  motorway: string;
  motorwayCasing: string;
  rail: string;
  roadLabel: string;
  roadHalo: string;
  place: string;
  placeHalo: string;
};

const LIGHT: Palette = {
  background: "#f2f1ed",
  residential: "#eceae4",
  park: "#dfe8d6",
  wood: "#d5e2cc",
  water: "#bcd3e0",
  waterLabel: "#5d7d8f",
  building: "#e4e1da",
  buildingOutline: "#d6d2c9",
  building3d: "#dedad2",
  minor: "#ffffff",
  major: "#ffffff",
  majorCasing: "#d9d5cc",
  motorway: "#fbf3df",
  motorwayCasing: "#dccfb0",
  rail: "#cbc6bc",
  roadLabel: "#5f646b",
  roadHalo: "#ffffff",
  place: "#3e4650",
  placeHalo: "#f2f1ed",
};

const DARK: Palette = {
  background: "#16191d",
  residential: "#1a1e22",
  park: "#1b2620",
  wood: "#1c2a21",
  water: "#1b2a36",
  waterLabel: "#7f9db0",
  building: "#22272d",
  buildingOutline: "#2a3037",
  building3d: "#2b3138",
  minor: "#2a3036",
  major: "#363d45",
  majorCasing: "#1f2429",
  motorway: "#4a4536",
  motorwayCasing: "#2b2820",
  rail: "#3a4048",
  roadLabel: "#9aa3ad",
  roadHalo: "#16191d",
  place: "#c9d0d8",
  placeHalo: "#16191d",
};

const NAME: ExpressionSpecification = ["coalesce", ["get", "name:it"], ["get", "name"]];
const LINES: ExpressionSpecification = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
const POLYS: ExpressionSpecification = ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false];

export function basemapStyle(theme: "light" | "dark"): StyleSpecification {
  const c = theme === "dark" ? DARK : LIGHT;
  return {
    version: 8,
    glyphs: BASEMAP_GLYPHS_URL,
    sources: {
      osm: { type: "vector", url: BASEMAP_TILES_URL, attribution: BASEMAP_ATTRIBUTION },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": c.background } },
      {
        id: "landuse-residential",
        type: "fill",
        source: "osm",
        "source-layer": "landuse",
        maxzoom: 15,
        filter: ["all", POLYS, ["==", ["get", "class"], "residential"]],
        paint: { "fill-color": c.residential },
      },
      {
        id: "landcover-wood",
        type: "fill",
        source: "osm",
        "source-layer": "landcover",
        filter: ["all", POLYS, ["match", ["get", "class"], ["wood", "forest"], true, false]],
        paint: { "fill-color": c.wood },
      },
      {
        id: "landcover-grass",
        type: "fill",
        source: "osm",
        "source-layer": "landcover",
        filter: ["all", POLYS, ["match", ["get", "class"], ["grass", "farmland"], true, false]],
        paint: { "fill-color": c.park, "fill-opacity": 0.6 },
      },
      {
        id: "park",
        type: "fill",
        source: "osm",
        "source-layer": "park",
        filter: POLYS,
        paint: { "fill-color": c.park },
      },
      {
        id: "water",
        type: "fill",
        source: "osm",
        "source-layer": "water",
        filter: ["all", POLYS, ["!=", ["get", "brunnel"], "tunnel"]],
        paint: { "fill-color": c.water },
      },
      {
        id: "waterway",
        type: "line",
        source: "osm",
        "source-layer": "waterway",
        filter: ["all", LINES, ["match", ["get", "class"], ["river", "canal"], true, false]],
        paint: {
          "line-color": c.water,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 15, 4],
        },
      },
      {
        id: "building",
        type: "fill",
        source: "osm",
        "source-layer": "building",
        minzoom: 14,
        paint: {
          "fill-color": c.building,
          "fill-outline-color": c.buildingOutline,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 1],
        },
      },
      {
        // Shown only in the 3D view (toggled with setLayoutProperty).
        id: "building-3d",
        type: "fill-extrusion",
        source: "osm",
        "source-layer": "building",
        minzoom: 14,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": c.building3d,
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 10],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.85,
        },
      },
      {
        id: "road-minor",
        type: "line",
        source: "osm",
        "source-layer": "transportation",
        minzoom: 12,
        filter: [
          "all",
          LINES,
          ["match", ["get", "class"], ["minor", "service"], true, false],
          ["!=", ["get", "brunnel"], "tunnel"],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.minor,
          "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 12, 0.5, 15, 3, 18, 12],
        },
      },
      {
        id: "road-major-casing",
        type: "line",
        source: "osm",
        "source-layer": "transportation",
        minzoom: 10,
        filter: [
          "all",
          LINES,
          ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk"], true, false],
          ["!=", ["get", "brunnel"], "tunnel"],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.majorCasing,
          "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 10, 1.2, 15, 7, 18, 22],
        },
      },
      {
        id: "road-major",
        type: "line",
        source: "osm",
        "source-layer": "transportation",
        minzoom: 10,
        filter: [
          "all",
          LINES,
          ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk"], true, false],
          ["!=", ["get", "brunnel"], "tunnel"],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.major,
          "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 10, 0.6, 15, 5, 18, 19],
        },
      },
      {
        id: "road-motorway-casing",
        type: "line",
        source: "osm",
        "source-layer": "transportation",
        minzoom: 8,
        filter: ["all", LINES, ["==", ["get", "class"], "motorway"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.motorwayCasing,
          "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 8, 1, 15, 8, 18, 22],
        },
      },
      {
        id: "road-motorway",
        type: "line",
        source: "osm",
        "source-layer": "transportation",
        minzoom: 8,
        filter: ["all", LINES, ["==", ["get", "class"], "motorway"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": c.motorway,
          "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 8, 0.6, 15, 6, 18, 19],
        },
      },
      {
        id: "rail",
        type: "line",
        source: "osm",
        "source-layer": "transportation",
        minzoom: 11,
        filter: [
          "all",
          LINES,
          ["match", ["get", "class"], ["rail", "transit"], true, false],
          ["!=", ["get", "brunnel"], "tunnel"],
        ],
        paint: {
          "line-color": c.rail,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 16, 2],
          "line-dasharray": [3, 2],
        },
      },
      {
        id: "water-name",
        type: "symbol",
        source: "osm",
        "source-layer": "waterway",
        minzoom: 12,
        filter: ["all", LINES, ["==", ["get", "class"], "river"]],
        layout: {
          "symbol-placement": "line",
          "text-field": NAME,
          "text-font": ["Noto Sans Italic"],
          "text-size": 12,
          "text-letter-spacing": 0.1,
        },
        paint: { "text-color": c.waterLabel, "text-halo-color": c.background, "text-halo-width": 1.2 },
      },
      {
        id: "road-name",
        type: "symbol",
        source: "osm",
        "source-layer": "transportation_name",
        minzoom: 13.5,
        filter: [
          "match",
          ["get", "class"],
          ["primary", "secondary", "tertiary", "trunk", "minor"],
          true,
          false,
        ],
        layout: {
          "symbol-placement": "line",
          "text-field": NAME,
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 14, 10.5, 18, 13],
          "text-max-angle": 30,
        },
        paint: { "text-color": c.roadLabel, "text-halo-color": c.roadHalo, "text-halo-width": 1.4 },
      },
      {
        id: "place-neighbourhood",
        type: "symbol",
        source: "osm",
        "source-layer": "place",
        minzoom: 11,
        maxzoom: 16,
        filter: ["match", ["get", "class"], ["suburb", "quarter", "neighbourhood"], true, false],
        layout: {
          "text-field": NAME,
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 15, 13],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.08,
          "text-max-width": 8,
        },
        paint: {
          "text-color": c.place,
          "text-opacity": 0.55,
          "text-halo-color": c.placeHalo,
          "text-halo-width": 1.5,
        },
      },
      {
        id: "place-town",
        type: "symbol",
        source: "osm",
        "source-layer": "place",
        minzoom: 8,
        maxzoom: 13,
        filter: ["match", ["get", "class"], ["town", "village"], true, false],
        layout: {
          "text-field": NAME,
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
        },
        paint: { "text-color": c.place, "text-halo-color": c.placeHalo, "text-halo-width": 1.5 },
      },
    ],
  };
}
