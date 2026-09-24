import { createElement as h, type ReactElement, type ReactNode } from "react";
import { ImageResponse } from "next/og";
import {
  SHARE_FACT_CARD_SIZE,
  type ShareFactCardParsed,
} from "@/lib/share-fact-card";

const COLORS = {
  bg: "#f3f5f7",
  text: "#182b3a",
  muted: "#536474",
  accent: "#b42332",
  line: "#c5cfd8",
} as const;

const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

function box(
  style: Record<string, string | number>,
  ...children: ReactNode[]
): ReactElement {
  return h(
    "div",
    { style: { display: "flex", ...style } },
    ...children.filter((child) => child != null && child !== false),
  );
}

export function createShareFactCardImageResponse(fact: ShareFactCardParsed): ImageResponse {
  const root = box(
    {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      background: COLORS.bg,
      color: COLORS.text,
    },
    box({ height: 18, width: "100%", background: COLORS.accent }),
    box(
      {
        flex: 1,
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px 72px 56px",
      },
      box(
        { flexDirection: "column", gap: 28 },
        box(
          {
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: COLORS.text,
          },
          "Dove Vanno I Nostri Soldi",
        ),
        box(
          {
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: COLORS.muted,
          },
          fact.title,
        ),
        box(
          {
            fontSize: 120,
            fontWeight: 700,
            letterSpacing: "-0.05em",
            lineHeight: 1,
            color: COLORS.text,
          },
          fact.value,
        ),
        fact.detail
          ? box(
              {
                maxWidth: 900,
                fontSize: 36,
                lineHeight: 1.35,
                color: COLORS.text,
              },
              fact.detail,
            )
          : null,
      ),
      box(
        {
          flexDirection: "column",
          gap: 18,
          borderTop: `2px solid ${COLORS.line}`,
          paddingTop: 28,
        },
        fact.source
          ? box(
              {
                fontSize: 26,
                color: COLORS.muted,
                lineHeight: 1.35,
              },
              fact.source,
            )
          : null,
        box(
          {
            fontSize: 28,
            fontWeight: 600,
            color: COLORS.accent,
          },
          `${fact.hostLabel}${fact.path === "/" ? "" : fact.path}`,
        ),
      ),
    ),
  );

  return new ImageResponse(root, {
    width: SHARE_FACT_CARD_SIZE,
    height: SHARE_FACT_CARD_SIZE,
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "Content-Disposition": 'inline; filename="dvns-dato.png"',
    },
  });
}
