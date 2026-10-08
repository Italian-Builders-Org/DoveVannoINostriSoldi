import { createElement as h, type ReactElement, type ReactNode } from "react";
import { ImageResponse } from "next/og";
import {
  PAYCHECK_SHARE_CARD_SIZE,
  type PaycheckShareCardParsed,
} from "@/lib/paycheck-share-card";

const COLORS = {
  bg: "#f3f5f7",
  ink: "#182b3a",
  muted: "#536474",
  accent: "#b42332",
  panel: "#ffffff",
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

export function createPaycheckShareCardImageResponse(
  card: PaycheckShareCardParsed,
): ImageResponse {
  const missionRows = card.missions.slice(0, 5);

  const root = box(
    {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      background: COLORS.bg,
      color: COLORS.ink,
      fontFamily: "Georgia, 'Times New Roman', serif",
    },
    box({ height: 14, width: "100%", background: COLORS.accent }),
    box(
      {
        flex: 1,
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "48px 56px 44px",
      },
      box(
        { flexDirection: "column", gap: 20 },
        box(
          {
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: COLORS.ink,
            fontFamily: "system-ui, sans-serif",
          },
          "Dove Vanno I Nostri Soldi",
        ),
        box(
          {
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: COLORS.muted,
            fontFamily: "system-ui, sans-serif",
          },
          "Contatore busta paga",
        ),
        box(
          {
            flexDirection: "column",
            gap: 8,
            marginTop: 8,
          },
          box(
            {
              fontSize: 22,
              color: COLORS.muted,
              fontFamily: "system-ui, sans-serif",
            },
            card.regionName,
          ),
          box(
            {
              fontSize: 92,
              fontWeight: 700,
              letterSpacing: "-0.05em",
              lineHeight: 1,
              fontFamily: "system-ui, sans-serif",
            },
            card.monthlyNetLabel,
          ),
          box(
            {
              fontSize: 28,
              color: COLORS.muted,
              fontFamily: "system-ui, sans-serif",
            },
            `netto / mese · lordo ${card.monthlyGrossLabel} · annuo ${card.annualGrossLabel}`,
          ),
        ),
      ),
      box(
        {
          flexDirection: "row",
          gap: 28,
          marginTop: 28,
        },
        box(
          {
            flex: 1,
            flexDirection: "column",
            gap: 10,
            background: COLORS.panel,
            border: `2px solid ${COLORS.line}`,
            padding: "22px 24px",
          },
          box(
            {
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: COLORS.accent,
              fontFamily: "system-ui, sans-serif",
              marginBottom: 6,
            },
            "Trattenute",
          ),
          ...card.deductions.map((row) =>
            box(
              {
                flexDirection: "row",
                justifyContent: "space-between",
                fontSize: 24,
                fontFamily: "system-ui, sans-serif",
                gap: 12,
              },
              box({ color: COLORS.ink }, row.label),
              box({ color: COLORS.ink, fontWeight: 600 }, row.value),
            ),
          ),
        ),
        box(
          {
            flex: 1,
            flexDirection: "column",
            gap: 10,
            background: COLORS.panel,
            border: `2px solid ${COLORS.line}`,
            padding: "22px 24px",
          },
          box(
            {
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: COLORS.accent,
              fontFamily: "system-ui, sans-serif",
              marginBottom: 6,
            },
            "IRPEF sulle missioni",
          ),
          ...(missionRows.length > 0
            ? missionRows.map((row) =>
                box(
                  {
                    flexDirection: "row",
                    justifyContent: "space-between",
                    fontSize: 24,
                    fontFamily: "system-ui, sans-serif",
                    gap: 12,
                  },
                  box({ color: COLORS.ink, maxWidth: 280 }, row.label),
                  box({ color: COLORS.ink, fontWeight: 600 }, row.value),
                ),
              )
            : [
                box(
                  {
                    fontSize: 22,
                    color: COLORS.muted,
                    fontFamily: "system-ui, sans-serif",
                  },
                  "Quote di bilancio non disponibili",
                ),
              ]),
        ),
      ),
      box(
        {
          flexDirection: "column",
          gap: 10,
          borderTop: `2px solid ${COLORS.line}`,
          paddingTop: 22,
          marginTop: 28,
        },
        box(
          {
            fontSize: 22,
            color: COLORS.muted,
            fontFamily: "system-ui, sans-serif",
            lineHeight: 1.35,
          },
          "Stima illustrativa · MEF IRPEF, OECD, OpenBDAP · non è una busta paga reale",
        ),
        box(
          {
            fontSize: 26,
            fontWeight: 700,
            color: COLORS.accent,
            fontFamily: "system-ui, sans-serif",
          },
          `${card.hostLabel}/busta-paga`,
        ),
      ),
    ),
  );

  return new ImageResponse(root, {
    width: PAYCHECK_SHARE_CARD_SIZE,
    height: PAYCHECK_SHARE_CARD_SIZE,
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "Content-Disposition": 'inline; filename="dvns-busta-paga.png"',
    },
  });
}
