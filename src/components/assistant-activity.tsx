"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick02Icon, Loading03Icon, File01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import type { AiActivity } from "@/lib/assistant/activity-contracts";
import styles from "@/app/assistente/assistant.module.css";

function ActivityRow({ item, active }: { item: AiActivity; active: boolean }) {
  const row = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    const element = row.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.animate([
      { height: "0px", opacity: 0, transform: "translateY(4px)", filter: "blur(2px)", paddingTop: 0, paddingBottom: 0 },
      { height: `${element.getBoundingClientRect().height}px`, opacity: 1, transform: "translateY(0)", filter: "blur(0)", paddingTop: "7px", paddingBottom: "7px" },
    ], { duration: 220, easing: "cubic-bezier(.23,1,.32,1)" });
    return () => animation.cancel();
  }, []);
  return <li ref={row} className={styles.activityRow} data-running={active && item.status === "running"}>
    <div><span className={styles.activityDot} /><span className={styles.activityLabel}>{item.label}</span></div>
    {item.resources?.length ? <div className={styles.activityResources}>{item.resources.map((resource, index) => <span key={index}><HugeiconsIcon icon={File01Icon} size={12} aria-hidden="true" /><span>{resource}</span></span>)}</div> : null}
  </li>;
}

/** An operational log driven exclusively by API events, never generated reasoning. */
export function AssistantActivity({ activities, active, stopped, startedAt, finishedAt }: { activities: readonly AiActivity[]; active: boolean; stopped?: boolean; startedAt: number; finishedAt?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(startedAt);
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [active]);
  if (!activities.some((item) => item.id === "attachments" || item.id.startsWith("query-"))) return null;
  const open = active || expanded;
  const elapsed = Math.max(0, ((finishedAt ?? now) - startedAt) / 1000).toFixed(1);
  return <div className={styles.activity} data-assistant-activity data-active={active}>
    <button type="button" className={styles.activitySummary} aria-expanded={open} onClick={() => setExpanded(!expanded)} disabled={active}>
      <HugeiconsIcon icon={active ? Loading03Icon : stopped ? Cancel01Icon : Tick02Icon} size={15} aria-hidden="true" />
      <span>{active ? "Consultazione in corso" : stopped ? "Attività interrotta" : "Attività svolte"}</span><time>{elapsed}s</time><HugeiconsIcon icon={ArrowDown01Icon} size={14} aria-hidden="true" />
    </button>
    <div className={styles.activityBody} data-open={open} aria-hidden={!open} inert={!open}><ol>
      {activities.map((item) => <ActivityRow key={item.id} item={item} active={active} />)}
    </ol></div>
  </div>;
}
