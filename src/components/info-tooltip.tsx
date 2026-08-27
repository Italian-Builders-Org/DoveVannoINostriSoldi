"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HelpCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import styles from "./info-tooltip.module.css";

export function InfoTooltip({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tooltipLeft, setTooltipLeft] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const pointerInteraction = useRef(false);

  const closeTooltip = useCallback(() => {
    setTooltipLeft(null);
    setOpen(false);
  }, []);

  const positionTooltip = useCallback(() => {
    const wrapper = wrapperRef.current;
    const tooltip = tooltipRef.current;
    if (!wrapper || !tooltip) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const tooltipWidth = tooltip.getBoundingClientRect().width;
    if (tooltipWidth === 0) return;

    const gutter = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--gutter"),
    );
    const safeGutter = Number.isFinite(gutter) ? gutter : 0;
    const minLeft = safeGutter;
    const maxLeft = Math.max(minLeft, window.innerWidth - safeGutter - tooltipWidth);
    const desiredLeft = wrapperRect.right - tooltipWidth;
    const clampedLeft = Math.min(Math.max(desiredLeft, minLeft), maxLeft);

    setTooltipLeft(clampedLeft - wrapperRect.left);
  }, []);

  useEffect(() => {
    if (!open) return;

    let frame = window.requestAnimationFrame(positionTooltip);
    const schedulePosition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(positionTooltip);
    };

    window.addEventListener("resize", schedulePosition);
    window.addEventListener("orientationchange", schedulePosition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("orientationchange", schedulePosition);
    };
  }, [open, positionTooltip]);

  useEffect(() => {
    if (!open) return;

    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) {
        closeTooltip();
      }
    }

    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [closeTooltip, open]);

  return (
    <span
      ref={wrapperRef}
      className={styles.wrapper}
      data-info-tooltip="true"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          setTooltipLeft(null);
          setOpen(true);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") closeTooltip();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeTooltip();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          closeTooltip();
          event.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onPointerDown={() => {
          pointerInteraction.current = true;
        }}
        onPointerUp={() => {
          pointerInteraction.current = false;
        }}
        onPointerCancel={() => {
          pointerInteraction.current = false;
        }}
        onFocus={() => {
          if (!pointerInteraction.current) {
            setTooltipLeft(null);
            setOpen(true);
          }
        }}
        onClick={() => {
          pointerInteraction.current = false;
          setTooltipLeft(null);
          setOpen((current) => !current);
        }}
      >
        <HugeiconsIcon icon={HelpCircleIcon} size={18} strokeWidth={1.7} aria-hidden="true" />
      </button>
      <span
        ref={tooltipRef}
        className={styles.tooltip}
        data-open={open}
        data-positioned={tooltipLeft !== null}
        id={id}
        role="tooltip"
        style={
          tooltipLeft === null
            ? undefined
            : { left: `${tooltipLeft}px`, right: "auto" }
        }
      >
        {children}
      </span>
    </span>
  );
}
