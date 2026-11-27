import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";

/**
 * Shown when a verified snapshot is missing: a bordered status notice with a
 * primary way out. `data-share-hidden` tells the section chrome to drop
 * "Condividi questa vista" (see section-nav.module.css): there is no view.
 */
export function DataUnavailableNotice({ title, action, children }: Readonly<{
  title: string;
  action: Readonly<{ href: string; label: string }>;
  children: ReactNode;
}>) {
  return (
    <div role="status" className="notice data-unavailable" data-share-hidden="true">
      <Icon name="info" size={22} className="data-unavailable-icon" />
      <div className="data-unavailable-body">
        <strong>{title}</strong>
        <p>{children}</p>
        <Link prefetch={false} href={action.href} className="btn btn-primary">{action.label}</Link>
      </div>
    </div>
  );
}
