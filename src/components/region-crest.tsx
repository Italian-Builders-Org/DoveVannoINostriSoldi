import Image from "next/image";
import manifest from "@/data/region-crests-manifest.json";
import styles from "./region-crest.module.css";

type ManifestEntry = {
  name: string;
  asset: string | null;
  sourcePage: string | null;
  license: string | null;
  author: string | null;
  width?: number;
  height?: number;
};

const entries = manifest.regions as Record<string, ManifestEntry>;

export type RegionCrestProps = {
  /** ISTAT code from the regional source contract (01–20). */
  regionCode: string | null | undefined;
  /** Visible name used in the accessible label and fallback. */
  regionName?: string;
  size?: "sm" | "md";
  /** Use when the adjacent table or link already names the region. */
  decorative?: boolean;
  className?: string;
};

export function RegionCrest({
  regionCode,
  regionName,
  size = "sm",
  decorative = false,
  className,
}: RegionCrestProps) {
  const entry = regionCode ? entries[regionCode] : undefined;
  const name = regionName ?? entry?.name ?? "regione";
  const classes = [styles.crest, styles[size], className].filter(Boolean).join(" ");

  if (!entry?.asset || !entry.width || !entry.height) {
    return (
      <span
        className={[classes, styles.fallback].join(" ")}
        data-region-crest="fallback"
        data-region-code={regionCode ?? undefined}
        role={decorative ? undefined : "img"}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : "Stemma non disponibile per " + name}
      >
        {!decorative ? "n.d." : null}
      </span>
    );
  }

  return (
    <span
      className={classes}
      data-region-crest="local"
      data-region-code={regionCode}
      data-source-page={entry.sourcePage ?? undefined}
      data-license={entry.license ?? undefined}
      data-author={entry.author ?? undefined}
    >
      <Image
        className={styles.image}
        src={entry.asset}
        width={entry.width}
        height={entry.height}
        alt={decorative ? "" : "Stemma di " + name}
        unoptimized
        decoding="async"
      />
    </span>
  );
}

export function RegionCrestAttribution() {
  return (
    <p className={styles.attribution} data-region-crest-attribution>
      Stemmi regionali: 10 SVG locali verificati, con autore e licenza registrati nel manifest;
      per le altre regioni mostriamo un segnaposto neutro{" "}
      <a href={manifest.catalogUrl} target="_blank" rel="noreferrer">
        nel catalogo Wikimedia Commons ↗
      </a>
      . Gli stemmi identificano il territorio: non sono una misura dei pagamenti e non modificano
      la choropleth.
    </p>
  );
}
