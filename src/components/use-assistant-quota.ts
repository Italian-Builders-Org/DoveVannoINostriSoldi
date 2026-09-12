"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isFreeQuota, type FreeQuota } from "@/lib/assistant/free-contracts";

export function useAssistantQuota() {
  const [quota, setQuota] = useState<FreeQuota | null>(null);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const response = await fetch("/api/assistant/quota", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
      const value: unknown = await response.json();
      if (pending.current === controller && !controller.signal.aborted) setQuota(isFreeQuota(value) ? value : null);
    } catch { if (!controller.signal.aborted && pending.current === controller) setQuota(null); }
  }, []);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const initial = setTimeout(() => void refresh(), 0);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(initial); pending.current?.abort(); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  useEffect(() => {
    if (!quota?.available) return;
    const timer = setTimeout(() => void refresh(), Math.max(1000, Date.parse(quota.resetAt) - Date.now() + 1000));
    return () => clearTimeout(timer);
  }, [quota?.available, quota?.resetAt, refresh]);
  function readHeaders(response: Response) {
    const remaining = response.headers.get("X-Assistant-Remaining");
    const resetAt = response.headers.get("X-Assistant-Reset");
    const next = { available: true, remaining: Number(remaining), resetAt };
    if (remaining !== null && isFreeQuota(next)) setQuota(next);
  }
  return { quota, refresh, readHeaders };
}
