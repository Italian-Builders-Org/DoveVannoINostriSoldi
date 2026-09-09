import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const sourcePath = path.join(root, "public/brand/dvns-mark.png");
const transparentPath = path.join(root, "public/brand/dvns-mark-transparent.png");
const source = await readFile(sourcePath);
const transparent = await readFile(transparentPath);

async function emit(relativePath, content) {
  const outputPath = path.join(root, relativePath);

  if (checkOnly) {
    const existing = await readFile(outputPath);
    if (!existing.equals(content)) {
      throw new Error(`${relativePath} is stale; run npm run brand:generate`);
    }
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content);
}

const rasterTargets = [
  [16, "public/brand/icon-16.png"],
  [32, "public/brand/icon-32.png"],
  [48, "public/brand/icon-48.png"],
  [180, "src/app/apple-icon.png"],
  [192, "public/brand/icon-192.png"],
  [512, "public/brand/icon-512.png"],
  [1024, "public/brand/icon-1024.png"],
];

async function renderPng(size) {
  return sharp(source)
    .resize(size, size, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

for (const [size, relativePath] of rasterTargets) {
  await emit(relativePath, await renderPng(size));
}

const faviconSizes = [16, 32, 48];
const faviconImages = await Promise.all(faviconSizes.map(renderPng));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(faviconImages.length, 4);

let offset = 6 + faviconImages.length * 16;
const entries = faviconImages.map((image, index) => {
  const size = faviconSizes[index];
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += image.length;
  return entry;
});

await emit(
  "src/app/favicon.ico",
  Buffer.concat([header, ...entries, ...faviconImages]),
);
await emit("src/app/icon.png", await renderPng(512));
await emit(
  "public/brand/dvns-mark-transparent.png",
  await sharp(transparent).png({ compressionLevel: 9 }).toBuffer(),
);

console.log(
  checkOnly
    ? "Brand assets match the canonical mark PNG."
    : "Generated favicon.ico, icon.png, apple-icon.png, and 16/32/48/192/512/1024 PNG assets.",
);
