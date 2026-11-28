import type { SVGProps } from "react";
import { ICON_PATHS, type IconName } from "@/components/icon-paths";

export type { IconName };
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

type IconProps = Omit<SVGProps<SVGSVGElement>, "children" | "strokeWidth" | "name"> & {
  name: IconName;
  size?: number | string;
  strokeWidth?: number;
  /** Accessible name. Without it the icon is decorative and hidden from AT. */
  label?: string;
};

/** DVNS icon set: one stroked family on a 24px grid (see icon-paths.ts). */
export function Icon({ name, size = 20, strokeWidth = 1.75, label, ...rest }: IconProps) {
  const a11y = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true, focusable: "false" as const };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
      {...rest}
    >
      {ICON_PATHS[name].map((d, index) => <path key={index} d={d} />)}
    </svg>
  );
}
