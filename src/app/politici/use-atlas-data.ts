"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RepublicProfile } from "@/lib/politici-repubblica";
import { loadNews, loadProfiles, type NewsData, type Resource } from "./atlas-data";

export function useAtlasData(personId: string | null) {
  const [profiles, setProfiles] = useState<Resource<Record<string, RepublicProfile>>>({ status: "idle" });
  const profileCache = useRef<Record<string, RepublicProfile> | null>(null);
  const newsCache = useRef(new Map<string, Resource<NewsData>>());
  const [newsEntries, setNewsEntries] = useState<Record<string, Resource<NewsData>>>({});
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [newsAttempt, setNewsAttempt] = useState(0);
  const enabled = personId !== null;

  useEffect(() => {
    if (!enabled || profileCache.current) return;
    const controller = new AbortController();
    loadProfiles(controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      profileCache.current = data;
      setProfiles({ status: "ready", data });
    }).catch(() => { if (!controller.signal.aborted) setProfiles({ status: "error" }); });
    return () => controller.abort();
  }, [enabled, profileAttempt]);

  useEffect(() => {
    if (!personId || newsCache.current.has(personId)) return;
    const controller = new AbortController();
    const store = (value: Resource<NewsData>) => {
      if (controller.signal.aborted) return;
      // Bound session memory; cached data and rendered state are updated together.
      if (newsCache.current.size >= 30) newsCache.current.delete(newsCache.current.keys().next().value!);
      newsCache.current.set(personId, value);
      setNewsEntries(Object.fromEntries(newsCache.current));
    };
    loadNews(personId, controller.signal).then((data) => store({ status: "ready", data })).catch(() => store({ status: "error" }));
    return () => controller.abort();
  }, [personId, newsAttempt]);

  const retryProfiles = useCallback(() => {
    setProfiles({ status: "loading" });
    setProfileAttempt((value) => value + 1);
  }, []);
  const retryNews = useCallback(() => {
    if (!personId) return;
    newsCache.current.delete(personId);
    setNewsEntries((current) => ({ ...current, [personId]: { status: "loading" } }));
    setNewsAttempt((value) => value + 1);
  }, [personId]);
  const news: Resource<NewsData> = personId ? newsEntries[personId] ?? { status: "loading" } : { status: "idle" };
  return { profiles, news, retryProfiles, retryNews };
}
