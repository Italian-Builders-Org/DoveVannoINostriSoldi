import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";

/**
 * Shown when a verified snapshot is missing: a bordered status notice with a
 * primary way out and, optionally, a secondary "Riprova" link that reloads the
 * same URL (a plain link: no client JS). `data-share-hidden` tells the section
 * chrome to drop "Condividi questa vista" (see section-nav.module.css): there is no view.
 */
export function DataUnavailableNotice({ title, action, retry, children }: Readonly<{
  title: string;
  action: Readonly<{ href: string; label: string }>;
  retry?: Readonly<{ href: string; label: string }>;
  children: ReactNode;
}>) {
  return (
    <div role="status" className="notice data-unavailable" data-share-hidden="true">
      <Icon name="info" size={22} className="data-unavailable-icon" />
      <div className="data-unavailable-body">
        <strong>{title}</strong>
        <p>{children}</p>
        <div className="data-unavailable-actions">
          <Link prefetch={false} href={action.href} className="btn btn-primary">{action.label}<Icon name="chevron-right" size={16} /></Link>
          {/* A plain anchor, not next/link: a retry must reach the server again. */}
          {retry ? <a href={retry.href} className="btn btn-secondary">{retry.label}</a> : null}
        </div>
      </div>
    </div>
  );
}
