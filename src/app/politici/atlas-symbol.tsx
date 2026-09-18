"use client";

import Image from "next/image";
import { useState } from "react";
import { partySymbol, SYMBOLS_OBSERVED_DATE } from "@/lib/politici-symbols";
import { SourceLink } from "./atlas-primitives";
import { longDate, initialsOf } from "./atlas-model";
import styles from "./politici.module.css";
import extra from "./atlas-enhancements.module.css";

export function PartySymbol({ family, label, size = 28 }: { family: string | null; label: string; size?: number }) {
  const symbol = partySymbol(family);
  const [failed, setFailed] = useState<string | null>(null);
  const available = symbol && failed !== symbol.family;
  return <span className={extra.partySymbol} style={{ width: size, height: size }} data-family={family ?? undefined} aria-hidden="true">
    {available ? <Image src={`/politici/simboli/${encodeURIComponent(symbol.family)}`} alt="" width={size} height={size} sizes={`${size}px`} loading="lazy" onError={() => setFailed(symbol.family)} /> : <span>{initialsOf(label)}</span>}
  </span>;
}

export function SymbolSource({ family }: { family: string }) {
  const symbol = partySymbol(family);
  return <details className={styles.disclosure}>
    <summary>Simbolo e attribuzione</summary>
    <p className={styles.note}>I simboli identificano le famiglie politiche associate ai gruppi nel catalogo, non certificano l’iscrizione delle singole persone. Per gruppi misti o simboli non disponibili mostriamo le iniziali.</p>
    {symbol ? <>
      <SourceLink href={symbol.sourceUrl}>{symbol.credit}</SourceLink>
      <p className={styles.note}>{symbol.version}. Fonte verificata il {longDate(SYMBOLS_OBSERVED_DATE)}. Marchi e immagini appartengono ai rispettivi titolari: non sono distribuiti con la licenza del codice e non indicano sostegno o affiliazione al progetto.</p>
    </> : <p className={styles.note}>Nessun simbolo univoco verificato nel catalogo per questo gruppo.</p>}
  </details>;
}
