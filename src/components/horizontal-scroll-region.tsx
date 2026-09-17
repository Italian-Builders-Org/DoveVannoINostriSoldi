"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

type HorizontalScrollRegionProps = Readonly<{
  ariaDescribedBy: string;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}>;

export function HorizontalScrollRegion({
  ariaDescribedBy,
  ariaLabel,
  children,
  className,
}: HorizontalScrollRegionProps) {
  const regionRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const region = regionRef.current;
    if (!region) return;
    const step = Math.max(160, Math.floor(region.clientWidth * 0.8));

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      region.scrollBy({ left: event.key === "ArrowLeft" ? -step : step, behavior: "auto" });
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      region.scrollTo({ left: event.key === "Home" ? 0 : region.scrollWidth, behavior: "auto" });
    }
  }

  return (
    <div
      aria-describedby={ariaDescribedBy}
      aria-label={ariaLabel}
      className={className}
      onKeyDown={onKeyDown}
      ref={regionRef}
      role="region"
      tabIndex={0}
    >
      {children}
    </div>
  );
}
