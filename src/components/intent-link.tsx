"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

type IntentLinkProps = Omit<ComponentProps<typeof Link>, "prefetch">;

export function IntentLink({ onMouseEnter, onFocus, ...props }: IntentLinkProps) {
  const [active, setActive] = useState(false);

  // Large menus must not fetch every destination merely by becoming visible.
  return (
    <Link
      {...props}
      prefetch={active ? null : false}
      onMouseEnter={(event) => {
        setActive(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        setActive(true);
        onFocus?.(event);
      }}
    />
  );
}
