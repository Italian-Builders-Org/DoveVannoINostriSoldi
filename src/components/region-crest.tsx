import Image from "next/image";
import manifest from "@/data/region-crests-manifest.json";
import styles from "./region-crest.module.css";

type ManifestEntry = {
  name: string;
  assetType?: "commons-crest" | "commons-regional-flag";
  assetLabel?: string;
  asset: string | null;
  sourcePage: string | null;
  license: string | null;
  author: string | null;
  width?: number;
  height?: number;
};

const entries = manifest.regions as Record<string, ManifestEntry>;

export type RegionCrestProps = {
  /** ISTAT code from the regional source contract (01 to 20). */
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
  const symbolLabel = entry?.assetType === "commons-regional-flag" ? "Bandiera regionale" : "Stemma";
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
      data-region-crest-type={entry.assetType ?? undefined}
      title={entry.assetLabel ?? `${symbolLabel} di ${name}`}
    >
      <Image
        className={styles.image}
        src={entry.asset}
        width={entry.width}
        height={entry.height}
        alt={decorative ? "" : `${symbolLabel} di ${name}`}
        unoptimized
        loading="eager"
        decoding="async"
      />
    </span>
  );
}

export function RegionCrestAttribution() {
  const crestCount = Object.values(entries).filter((entry) => entry.assetType === "commons-crest").length;
  const alternateCount = Object.values(entries).filter(
    (entry) => entry.assetType === "commons-regional-flag",
  ).length;

  return (
    <p className={styles.attribution} data-region-crest-attribution>
      Simboli regionali: {crestCount} stemmi SVG Commons e {alternateCount} alternativa vettoriale
      Commons, con autore e licenza registrati nel manifest. Non usiamo segnaposto neutri né badge
      originali{" "}
      <a href={manifest.catalogUrl} target="_blank" rel="noreferrer">
        nel catalogo Wikimedia Commons ↗
      </a>
      . Il simbolo del Veneto è indicato come bandiera regionale alternativa. I simboli identificano
      il territorio: non sono una misura dei pagamenti e non modificano la choropleth.
    </p>
  );
}
