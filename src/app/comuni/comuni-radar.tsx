import type { FootprintIndicator } from "@/lib/comuni-footprint";
import styles from "./comuni.module.css";

type RadarProps = Readonly<{
  indicators: readonly FootprintIndicator[];
  municipalityLabel: string;
  hasPeerMedian: boolean;
}>;

const INDEX_CAP = 200;

function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function polygonPoints(
  values: readonly number[],
  cx: number,
  cy: number,
  maxRadius: number,
): string {
  if (values.length === 0) return "";
  return values
    .map((value, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / values.length;
      const point = polar(cx, cy, maxRadius * Math.min(1, Math.max(0, value)), angle);
      return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    })
    .join(" ");
}

export function ComuniRadar({ indicators, municipalityLabel, hasPeerMedian }: RadarProps) {
  const axes = indicators;
  if (axes.length < 3) {
    return (
      <p className={styles.radarEmpty}>
        Servono almeno tre indicatori confrontabili per disegnare il grafico.
      </p>
    );
  }

  const size = 640;
  const cx = size / 2;
  const cy = size / 2;
  const maxRadius = 205;
  const labelRadius = maxRadius + 68;
  const scaled = axes.map((item) => {
    if (item.index === null) return 100 / INDEX_CAP;
    return Math.min(INDEX_CAP, Math.max(0, item.index)) / INDEX_CAP;
  });
  const medianRing = axes.map(() => 100 / INDEX_CAP);
  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <figure className={styles.radarFigure} aria-label={`Confronto indicatori di ${municipalityLabel}`}>
      <svg
        className={styles.radarSvg}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-labelledby="comuni-radar-title comuni-radar-desc"
      >
        <title id="comuni-radar-title">Indicatori indicizzati alla mediana</title>
        <desc id="comuni-radar-desc">
          Ogni asse è un indicatore ufficiale. La mediana dei comuni simili vale 100.
        </desc>
        {rings.map((ring) => (
          <polygon
            key={ring}
            className={styles.radarRing}
            points={polygonPoints(axes.map(() => ring), cx, cy, maxRadius)}
          />
        ))}
        {axes.map((_, index) => {
          const angle = -Math.PI / 2 + (index * 2 * Math.PI) / axes.length;
          const tip = polar(cx, cy, maxRadius, angle);
          return (
            <line key={index} className={styles.radarSpoke} x1={cx} y1={cy} x2={tip.x} y2={tip.y} />
          );
        })}
        {hasPeerMedian ? (
          <polygon className={styles.radarPeer} points={polygonPoints(medianRing, cx, cy, maxRadius)} />
        ) : null}
        <polygon className={styles.radarMunicipality} points={polygonPoints(scaled, cx, cy, maxRadius)} />
        {axes.map((axis, index) => {
          const angle = -Math.PI / 2 + (index * 2 * Math.PI) / axes.length;
          const tip = polar(cx, cy, maxRadius * scaled[index]!, angle);
          const label = polar(cx, cy, labelRadius, angle);
          return (
            <g key={axis.id}>
              <circle className={styles.radarPoint} cx={tip.x} cy={tip.y} r={4.5} />
              <foreignObject x={label.x - 78} y={label.y - 30} width={156} height={60}>
                <div className={styles.radarAxisLabel}>
                  <strong>
                    <span className={styles.radarAxisIndex} aria-hidden="true">{index + 1}. </span>
                    {axis.shortLabel}
                  </strong>
                  <span>
                    {axis.valueLabel}
                    {axis.medianLabel ? ` · ${axis.medianLabel}` : ""}
                  </span>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
      <figcaption className={styles.radarCaption}>
        Linea petrolio: {municipalityLabel}
        {hasPeerMedian ? " · area tratteggiata: mediana dei pari (= 100)" : " · mediana incompleta"}.
        {" "}Su ogni asse: valore di questo Comune · mediana. I numeri da 1 a {axes.length} rimandano alla legenda sotto.
      </figcaption>
    </figure>
  );
}
