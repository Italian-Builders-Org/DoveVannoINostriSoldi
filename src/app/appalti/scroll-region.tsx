"use client";

import type { KeyboardEvent, ReactNode } from "react";

type ScrollRegionProps = {
  children: ReactNode;
  className?: string;
  role?: string;
  "aria-label"?: string;
  tabIndex?: number;
};

export function ScrollRegion({ children, ...props }: ScrollRegionProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const step = Math.max(element.clientWidth * 0.8, 160);

    if (event.key === "Home" || event.key === "ArrowLeft") {
      element.scrollLeft = event.key === "Home" ? 0 : Math.max(0, element.scrollLeft - step);
      event.preventDefault();
    }

    if (event.key === "End" || event.key === "ArrowRight") {
      element.scrollLeft = event.key === "End"
        ? element.scrollWidth
        : Math.min(element.scrollWidth, element.scrollLeft + step);
      event.preventDefault();
    }
  }

  return <div {...props} onKeyDown={handleKeyDown}>{children}</div>;
}
