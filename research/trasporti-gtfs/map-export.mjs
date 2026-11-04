import { modeLabel } from "./catalog.mjs";
import { scaleBar } from "./camera.mjs";

export async function mapImage({
  canvas,
  city,
  bandLabel,
  route,
  count,
  mode3d,
  selection,
  camera,
  scale: speedScale,
}) {
  if (!canvas.width || !canvas.height) throw Error("Mappa non pronta.");
  const width = Math.min(2048, Math.max(640, canvas.width)),
    padding = 24;
  const image = document.createElement("canvas"),
    ctx = image.getContext("2d");
  if (!ctx) throw Error("Esportazione non supportata.");
  const lines = (text, font) => {
    ctx.font = font;
    const result = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      if (
        line &&
        ctx.measureText(line + " " + word).width > width - padding * 2
      ) {
        result.push(line);
        line = "";
      }
      for (const character of (line ? " " : "") + word) {
        if (ctx.measureText(line + character).width > width - padding * 2) {
          result.push(line);
          line = "";
        }
        line += character;
      }
    }
    if (line) result.push(line);
    return result;
  };
  const context = [
    modeLabel(city.mode),
    bandLabel,
    mode3d ? "3D" : "2D",
    route ? "Linea " + route : null,
    count + " tratti",
  ]
    .filter(Boolean)
    .join(" · ");
  const contextLines = lines(context, "14px system-ui"),
    selectionLines = selection ? lines(selection, "14px system-ui") : [];
  const holder = city.attribution || city.holder;
  const footer = [
    "Orari programmati, non ritardi misurati." +
      (mode3d
        ? " Altezza: minuti per km, massimo grafico " +
          speedScale.maxMinPerKm +
          "."
        : ""),
    "Servizio: " +
      new Date(city.serviceDate + "T12:00:00").toLocaleDateString("it-IT") +
      " · " +
      holder,
    (city.attributionUrl || new URL(city.landingUrl).origin) +
      " · Feed SHA-256 " +
      city.receipt.sha256.slice(0, 16),
    city.license === "not-declared"
      ? "Condizioni di riuso della fonte da verificare."
      : "Dati: " + city.license,
    "Carta © OpenStreetMap contributors · ODbL 1.0 · openstreetmap.org/copyright",
  ].flatMap((text) => lines(text, "12px system-ui"));
  const headerHeight = 68 + (contextLines.length + selectionLines.length) * 20;
  const mapHeight = Math.round((canvas.height * width) / canvas.width);
  image.width = width;
  image.height = headerHeight + mapHeight + 90 + footer.length * 18;
  ctx.fillStyle = "#f5f6f6";
  ctx.fillRect(0, 0, width, image.height);
  ctx.fillStyle = "#1d2427";
  ctx.font = "650 24px system-ui";
  ctx.fillText(city.name + " · DVNS Mobilità", padding, 35);
  ctx.font = "14px system-ui";
  ctx.fillStyle = "#5d686d";
  let y = 60;
  for (const line of [...contextLines, ...selectionLines]) {
    ctx.fillText(line, padding, y);
    y += 20;
  }
  ctx.drawImage(canvas, 0, headerHeight, width, mapHeight);
  ctx.save();
  ctx.translate(width - 42, headerHeight + 36);
  ctx.fillStyle = "#fffffff0";
  ctx.beginPath();
  ctx.arc(0, 0, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.rotate(-camera.bearing);
  ctx.fillStyle = "#1d2427";
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(-5, 4);
  ctx.lineTo(0, 0);
  ctx.lineTo(5, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.font = "11px system-ui";
  ctx.textAlign = "center";
  ctx.fillStyle = "#1d2427";
  ctx.fillText("N", 0, 17);
  ctx.restore();
  const scale = scaleBar(camera, {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
  });
  if (scale) {
    const pixels = (scale.pixels * width) / canvas.clientWidth;
    const label =
      new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(
        scale.metres >= 1000 ? scale.metres / 1000 : scale.metres,
      ) + (scale.metres >= 1000 ? " km" : " m");
    const x = padding,
      y = headerHeight + mapHeight - 18;
    ctx.fillStyle = "#fffffff0";
    ctx.fillRect(x - 8, y - 30, pixels + 16, 40);
    ctx.strokeStyle = "#5d686d";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y);
    ctx.lineTo(x + pixels, y);
    ctx.lineTo(x + pixels, y - 4);
    ctx.stroke();
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = "#1d2427";
    ctx.fillText(label, x + pixels / 2, y - 11);
    ctx.textAlign = "left";
  }

  y = headerHeight + mapHeight + 32;
  ctx.font = "13px system-ui";
  ctx.fillStyle = "#5d686d";
  const [a, , c] = speedScale.classes,
    rampWidth = Math.min(320, width - padding * 2 - 200),
    ramp = ctx.createLinearGradient(padding, 0, padding + rampWidth, 0);
  for (const [stop, color] of [
    [0, "#a6c9b6"],
    [0.17, "#7fb59a"],
    [0.28, "#e2c460"],
    [0.4, "#e98f3a"],
    [0.55, "#c54028"],
    [0.75, "#7a1626"],
    [1, "#480a1a"],
  ])
    ramp.addColorStop(stop, color);
  ctx.fillStyle = ramp;
  ctx.fillRect(padding, y - 8, rampWidth, 8);
  ctx.fillStyle = "#1d2427";
  ctx.fillText("≥ " + c + " km/h", padding, y + 16);
  ctx.textAlign = "right";
  ctx.fillText("< " + a + " km/h", padding + rampWidth, y + 16);
  ctx.textAlign = "left";
  y += 14;
  y += 28;
  ctx.font = "12px system-ui";
  ctx.fillStyle = "#5d686d";
  for (const line of footer) {
    ctx.fillText(line, padding, y);
    y += 18;
  }
  return new Promise((resolve, reject) =>
    image.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(Error("Impossibile creare l’immagine.")),
      "image/png",
    ),
  );
}
