#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , outputFile, sourceArchive] = process.argv;

if (!outputFile || !sourceArchive) {
  throw new Error(
    "Uso: node scripts/maps/generate_italy_regions.mjs <output TypeScript> <ZIP ufficiale>",
  );
}

const SHAPEFILE = "Reg01012026_g_WGS84.shp";
const DATABASE = "Reg01012026_g_WGS84.dbf";
const SOURCE_URL =
  "https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip";
const SOURCE_SHA256 = "b011a590656c3a3ebc297fba80726a376aa843b6f164641cf6a4a990021a81d6";
const VIEWBOX = { width: 560, height: 640, padding: 12 };
const SIMPLIFICATION_TOLERANCE = 2_500;
const MINIMUM_PART_AREA = 500_000;

function parseDbf(buffer) {
  const recordCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];

  for (let offset = 32; buffer[offset] !== 0x0d; offset += 32) {
    const name = buffer
      .subarray(offset, offset + 11)
      .toString("utf8")
      .replace(/\0.*$/, "")
      .trim();
    fields.push({ name, length: buffer[offset + 16] });
  }

  return Array.from({ length: recordCount }, (_, index) => {
    const start = headerLength + index * recordLength;
    let cursor = start + 1;
    const record = {};

    for (const field of fields) {
      record[field.name] = buffer
        .subarray(cursor, cursor + field.length)
        .toString("utf8")
        .trim();
      cursor += field.length;
    }

    return record;
  });
}

function parseShapefile(buffer) {
  const shapes = [];
  let offset = 100;

  while (offset + 8 <= buffer.length) {
    const contentLength = buffer.readUInt32BE(offset + 4) * 2;
    const contentStart = offset + 8;
    const shapeType = buffer.readUInt32LE(contentStart);

    if (shapeType === 5) {
      const partCount = buffer.readUInt32LE(contentStart + 36);
      const pointCount = buffer.readUInt32LE(contentStart + 40);
      const partsOffset = contentStart + 44;
      const pointsOffset = partsOffset + partCount * 4;
      const partStarts = Array.from({ length: partCount }, (_, index) =>
        buffer.readUInt32LE(partsOffset + index * 4),
      );
      const points = Array.from({ length: pointCount }, (_, index) => [
        buffer.readDoubleLE(pointsOffset + index * 16),
        buffer.readDoubleLE(pointsOffset + index * 16 + 8),
      ]);

      shapes.push(
        partStarts.map((start, index) =>
          points.slice(start, partStarts[index + 1] ?? pointCount),
        ),
      );
    }

    offset = contentStart + contentLength;
  }

  return shapes;
}

function perpendicularDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const numerator = Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]);
  return numerator / Math.hypot(dx, dy);
}

function simplifyLine(points, tolerance) {
  if (points.length <= 4) return points;
  let maximumDistance = 0;
  let splitIndex = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index], points[0], points.at(-1));
    if (distance > maximumDistance) {
      maximumDistance = distance;
      splitIndex = index;
    }
  }

  if (maximumDistance <= tolerance) return [points[0], points.at(-1)];
  return [
    ...simplifyLine(points.slice(0, splitIndex + 1), tolerance).slice(0, -1),
    ...simplifyLine(points.slice(splitIndex), tolerance),
  ];
}

function simplifyRing(points, tolerance) {
  const ring =
    points.length > 1 &&
    points[0][0] === points.at(-1)[0] &&
    points[0][1] === points.at(-1)[1]
      ? points.slice(0, -1)
      : points;
  if (ring.length <= 4) return ring;

  let splitIndex = 1;
  let maximumDistance = 0;
  for (let index = 1; index < ring.length; index += 1) {
    const distance = Math.hypot(
      ring[index][0] - ring[0][0],
      ring[index][1] - ring[0][1],
    );
    if (distance > maximumDistance) {
      maximumDistance = distance;
      splitIndex = index;
    }
  }

  const firstArc = simplifyLine(ring.slice(0, splitIndex + 1), tolerance);
  const secondArc = simplifyLine(
    [...ring.slice(splitIndex), ring[0]],
    tolerance,
  );
  return [...firstArc.slice(0, -1), ...secondArc.slice(0, -1)];
}

function polygonArea(points) {
  return Math.abs(
    points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length];
      return area + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2,
  );
}

function round(value) {
  return Number(value.toFixed(1));
}

function projectRegions(regions) {
  const points = regions.flatMap((region) => region.parts.flat());
  const eastings = points.map(([easting]) => easting);
  const northings = points.map(([, northing]) => northing);
  const minimumEasting = Math.min(...eastings);
  const maximumEasting = Math.max(...eastings);
  const minimumNorthing = Math.min(...northings);
  const maximumNorthing = Math.max(...northings);
  const projectedWidth = maximumEasting - minimumEasting;
  const projectedHeight = maximumNorthing - minimumNorthing;
  const scale = Math.min(
    (VIEWBOX.width - VIEWBOX.padding * 2) / projectedWidth,
    (VIEWBOX.height - VIEWBOX.padding * 2) / projectedHeight,
  );
  const contentWidth = projectedWidth * scale;
  const contentHeight = projectedHeight * scale;
  const xOffset = (VIEWBOX.width - contentWidth) / 2;
  const yOffset = (VIEWBOX.height - contentHeight) / 2;

  return regions.map((region) => ({
    ...region,
    path: region.parts
      .map((part) => {
        const projected = part.map(([easting, northing]) => [
          xOffset + (easting - minimumEasting) * scale,
          yOffset + (maximumNorthing - northing) * scale,
        ]);
        return projected
          .map(([x, y], index) => `${index === 0 ? "M" : "L"}${round(x)} ${round(y)}`)
          .join("") + "Z";
      })
      .join(""),
  }));
}

function typescript(regions) {
  const serializedRegions = regions
    .map(
      (region) =>
        `  { code: ${JSON.stringify(region.code)}, name: ${JSON.stringify(region.name)}, path: ${JSON.stringify(region.path)} },`,
    )
    .join("\n");

  return `/**\n * Generated from ISTAT administrative boundaries. Do not edit by hand.\n * Source: ${SOURCE_URL}\n * Source SHA-256: ${SOURCE_SHA256}\n * Geography date: 1 January 2026 · License: CC BY 4.0\n * Generator: scripts/maps/generate_italy_regions.mjs\n */\n\nexport const ITALY_REGIONS_VIEWBOX = ${JSON.stringify(`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`)};\n\nexport const italyRegionGeometry = [\n${serializedRegions}\n] as const;\n`;
}

const archiveBuffer = await readFile(sourceArchive);
const archiveSha256 = createHash("sha256").update(archiveBuffer).digest("hex");
if (archiveSha256 !== SOURCE_SHA256) {
  throw new Error(`Checksum ISTAT non valido: atteso ${SOURCE_SHA256}, trovato ${archiveSha256}.`);
}
const shapeBuffer = execFileSync(
  "unzip",
  ["-p", sourceArchive, `Reg01012026_g/${SHAPEFILE}`],
  { maxBuffer: 4 * 1024 * 1024 },
);
const dbfBuffer = execFileSync(
  "unzip",
  ["-p", sourceArchive, `Reg01012026_g/${DATABASE}`],
  { maxBuffer: 1024 * 1024 },
);
const records = parseDbf(dbfBuffer);
const shapes = parseShapefile(shapeBuffer);

if (records.length !== shapes.length || shapes.length !== 20) {
  throw new Error(`Attese 20 regioni ISTAT, trovate ${records.length} record e ${shapes.length} geometrie.`);
}

const normalized = records.map((record, index) => {
  const code = String(Number.parseInt(record.COD_REG, 10)).padStart(2, "0");
  const name = record.DEN_REG;
  const parts = shapes[index]
    .filter((part) => part.length >= 4 && polygonArea(part) >= MINIMUM_PART_AREA)
    .map((part) => simplifyRing(part, SIMPLIFICATION_TOLERANCE))
    .filter((part) => part.length >= 3);

  if (!code || !name || parts.length === 0) {
    throw new Error(`Geometria ISTAT non valida alla riga ${index + 1}.`);
  }

  return { code, name, parts };
});

const projected = projectRegions(normalized);
const originalPointCount = shapes.flat(2).length;
const simplifiedPointCount = normalized.flatMap((region) => region.parts).flat().length;
await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, typescript(projected), "utf8");
console.log(
  `Generate ${projected.length} regioni in ${outputFile} (${originalPointCount} -> ${simplifiedPointCount} punti)`,
);
