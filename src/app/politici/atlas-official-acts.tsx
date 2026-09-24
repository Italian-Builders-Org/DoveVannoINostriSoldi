import type { ThemeLinkedAct } from "@/lib/politici-voti-tema";
import { object, text } from "./atlas-data";
import { isSafeExternalUrl } from "./atlas-model";
import { SourceLink } from "./atlas-primitives";
import styles from "./politici.module.css";

export function validLinkedActs(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((act) => object(act)
    && text(act.id) && text(act.number) && text(act.title)
    && isSafeExternalUrl(act.officialPage)));
}

export function OfficialActLinks({
  officialPage,
  linkedActs,
}: {
  officialPage: string;
  linkedActs?: ThemeLinkedAct[];
}) {
  if (!linkedActs || linkedActs.length < 2) {
    return <SourceLink href={officialPage}>Atto ufficiale</SourceLink>;
  }
  return <details className={styles.disclosure}>
    <summary>{linkedActs.length} atti collegati alla stessa votazione</summary>
    <ul className={styles.bulletList}>{linkedActs.map((act) => <li key={act.id}>
      <SourceLink href={act.officialPage}>{act.number} · {act.title}</SourceLink>
    </li>)}</ul>
  </details>;
}
