import Link from "next/link";
import { getEditorialTopics, type EditorialTopic } from "@/lib/integrated-editorial";
import styles from "./integrated-section-preview.module.css";

type Props = Readonly<{
  section: EditorialTopic["section"];
  title: string;
  description: string;
  hubHref: string;
  limit?: number;
}>;

export default function IntegratedSectionPreview({
  section,
  title,
  description,
  hubHref,
  limit = 3,
}: Props) {
  const topics = getEditorialTopics(section).slice(0, limit);
  return (
    <section className={styles.preview} aria-labelledby={`integrated-preview-${section}`}>
      <div className={styles.heading}>
        <div>
          <h2 id={`integrated-preview-${section}`}>{title}</h2>
          <p>{description}</p>
        </div>
        <Link href={hubHref}>Esplora tutta la sezione</Link>
      </div>
      <div className={styles.rows}>
        {topics.map((topic) => (
          <article key={topic.slug}>
            <div>
              <strong>{topic.primaryMetric}</strong>
              <span>{topic.primaryLabel}</span>
            </div>
            <div>
              <h3><Link href={`/${topic.section}/${topic.slug}`}>{topic.title}</Link></h3>
              <p>{topic.hubSummary}</p>
            </div>
            <span className="tag tag-neutral">{topic.status}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
