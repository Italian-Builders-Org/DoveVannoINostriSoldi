import type { ComponentProps } from "react";
import {
  ChatGptIcon,
  Facebook01Icon,
  GithubIcon,
  InstagramIcon,
  NewTwitterIcon,
  ThreadsIcon,
  TiktokIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/**
 * Third-party brand marks. They stay with the Hugeicons outlines so the logos
 * remain recognisable; every other site icon comes from ./icons.
 */
const BRAND_ICONS = {
  chatgpt: ChatGptIcon,
  github: GithubIcon,
  threads: ThreadsIcon,
  facebook: Facebook01Icon,
  instagram: InstagramIcon,
  tiktok: TiktokIcon,
  x: NewTwitterIcon,
} as const;

export type BrandName = keyof typeof BRAND_ICONS;

type BrandIconProps = Omit<ComponentProps<typeof HugeiconsIcon>, "icon"> & { name: BrandName };

export function BrandIcon({ name, size = 20, strokeWidth = 1.75, ...rest }: BrandIconProps) {
  return <HugeiconsIcon icon={BRAND_ICONS[name]} size={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" {...rest} />;
}
