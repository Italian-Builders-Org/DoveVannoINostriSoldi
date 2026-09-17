import type { Metadata } from "next";
import { notFound } from "next/navigation";
import EditorialTopicPage from "@/components/editorial-topic-page";
import { getEditorialTopic, getEditorialTopics } from "@/lib/integrated-editorial";

export const dynamicParams = false;

export function generateStaticParams() {
  return getEditorialTopics("confronti").map((topic) => ({ topic: topic.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }): Promise<Metadata> {
  const { topic: slug } = await params;
  const topic = getEditorialTopic("confronti", slug);
  if (!topic) return {};
  return { title: topic.title, description: topic.description };
}

export default async function ComparisonTopicRoute({ params }: { params: Promise<{ topic: string }> }) {
  const { topic: slug } = await params;
  const topic = getEditorialTopic("confronti", slug);
  if (!topic) notFound();
  return <EditorialTopicPage topic={topic} />;
}
