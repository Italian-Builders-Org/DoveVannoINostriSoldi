"use client";

import Image from "next/image";
import { useCallback, useState } from "react";

type AtlasImageProps = {
  src: string | null;
  fallback: string;
  size: number;
  className: string;
  family?: string | null;
  eager?: boolean;
};

/** The source key isolates late load/error events when a row shows another person. */
export function AtlasImage(props: AtlasImageProps) {
  return <SourceImage key={props.src ?? "missing"} {...props} />;
}

function SourceImage({ src, fallback, size, className, family, eager = false }: AtlasImageProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    // A cached image can finish before React attaches its load listener.
    if (image?.complete && image.naturalWidth > 0) setStatus("loaded");
  }, []);
  return <span
    className={className}
    style={{ width: size, height: size }}
    data-family={family ?? undefined}
    data-loaded={src !== null && status === "loaded" ? "true" : "false"}
    data-image-state={src === null ? "missing" : status}
    aria-hidden="true">
    <span>{fallback}</span>
    {src !== null && status !== "error" ? <Image
      ref={imageRef}
      src={src}
      alt=""
      width={size}
      height={size}
      sizes={`${size}px`}
      loading={eager ? "eager" : "lazy"}
      onLoad={() => setStatus("loaded")}
      onError={() => setStatus("error")} /> : null}
  </span>;
}
