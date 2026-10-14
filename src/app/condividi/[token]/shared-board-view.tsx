"use client";

import Link from "next/link";
import type { BoardDocument } from "@/lib/data/boards-document";
import { ensureBoardHtml } from "@/lib/boards/board-html";
import { BoardLocalTileChart, BoardTileChart } from "@/app/dashboard/board-tile-chart";
import styles from "./shared-board.module.css";

type Props = {
  token: string;
  title: string;
  category: string;
  updatedAt: string;
  document: BoardDocument;
};

export function SharedBoardView({ token, title, category, updatedAt, document }: Props) {
  return (
    <div className={styles.shell} data-immersive-page="boards" data-testid="boards-shared">
      <header className={styles.topbar}>
        <div>
          <p className={styles.kicker}>DVNS Boards · sola lettura</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.meta}>
            {category} · aggiornata{" "}
            {new Intl.DateTimeFormat("it-IT", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(updatedAt))}
          </p>
        </div>
        <Link className={styles.link} href="/">
          dovevannoinostrisoldi.com
        </Link>
      </header>
      <div className={styles.canvas}>
        {document.tiles.length === 0 ? (
          <p className={styles.empty}>Questa board non contiene elementi.</p>
        ) : null}
        {document.tiles.map((tile) => {
          const frame = tile.frame ?? { x: 40, y: 40, w: 360, h: 260 };
          const isText = tile.kind === "heading" || tile.kind === "note";
          return (
            <article
              key={tile.id}
              className={styles.tile}
              data-kind={tile.kind}
              style={{
                left: frame.x,
                top: frame.y,
                width: frame.w,
                height: frame.h,
                ["--tile-accent" as string]: tile.color ?? "var(--boards-accent)",
              }}
            >
              {isText ? null : (
                <header className={styles.tileHeader}>
                  <strong>{tile.title ?? tile.datasetId ?? tile.kind}</strong>
                  <span>{tile.kind}</span>
                </header>
              )}
              <div className={styles.tileBody}>
                {tile.kind === "data" ? (
                  <BoardTileChart tile={tile} shareToken={token} />
                ) : null}
                {tile.kind === "local" && tile.localTable ? (
                  <BoardLocalTileChart tile={tile} />
                ) : null}
                {isText ? (
                  <div
                    className={styles.richText}
                    dangerouslySetInnerHTML={{
                      __html: ensureBoardHtml(
                        tile.body,
                        tile.kind === "heading" ? (tile.title ?? "") : "",
                      ),
                    }}
                  />
                ) : null}
                {tile.kind === "link" && tile.href ? (
                  <a href={tile.href} target="_blank" rel="noreferrer">
                    {tile.href}
                  </a>
                ) : null}
                {tile.kind === "image" && tile.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tile.imageUrl} alt={tile.title ?? ""} className={styles.image} />
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      <footer className={styles.footer}>
        I numeri sono riletti dal layer pubblico DVNS al momento della visualizzazione. Non è un
        ranking di spreco.
      </footer>
    </div>
  );
}
