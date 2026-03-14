"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export function useOpenRouterKey() {
  const queryClient = useQueryClient();

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      return res.json();
    },
  });

  const hasKey = settings?.has_openrouter_key === "true";

  const saveKey = useCallback(
    async (key: string) => {
      const res = await fetch("/api/setup/openrouter-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save key");
      }
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["vault"] });
      return res.json();
    },
    [queryClient],
  );

  return { hasKey, saveKey, isLoaded: settings !== undefined };
}
