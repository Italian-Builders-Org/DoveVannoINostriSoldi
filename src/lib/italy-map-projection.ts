import { ITALY_REGIONS_PROJECTION } from "@/data/generated/italy-regions";

// WGS84 ellipsoid and UTM zone 32N, the CRS of the ISTAT boundaries behind the regional map.
const A = 6_378_137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const LON0 = (9 * Math.PI) / 180;
const FALSE_EASTING = 500_000;

/** Transverse Mercator forward series (Snyder, Map Projections: A Working Manual, eq. 8-9 to 8-10). */
export function utm32n(latitude: number, longitude: number): [easting: number, northing: number] {
  const phi = (latitude * Math.PI) / 180;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * sin * sin);
  const t = tan * tan;
  const c = EP2 * cos * cos;
  const a = cos * ((longitude * Math.PI) / 180 - LON0);
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const m = A * (
    (1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
    - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
    - ((35 * e6) / 3072) * Math.sin(6 * phi)
  );
  const easting = FALSE_EASTING + K0 * n * (
    a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120
  );
  const northing = K0 * (
    m + n * tan * (a * a / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24
      + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720)
  );
  return [easting, northing];
}

/** Position of a WGS84 point in the viewBox of the ISTAT regional map. */
export function toItalyMap(latitude: number, longitude: number): [x: number, y: number] {
  const [easting, northing] = utm32n(latitude, longitude);
  const { minimumEasting, maximumNorthing, scale, xOffset, yOffset } = ITALY_REGIONS_PROJECTION;
  return [xOffset + (easting - minimumEasting) * scale, yOffset + (maximumNorthing - northing) * scale];
}
