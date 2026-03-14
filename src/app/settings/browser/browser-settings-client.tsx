"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export function BrowserSettingsClient({ initialData }: { initialData: Record<string, string> }) {
  const queryClient = useQueryClient();

  const { data: settings, isLoading: loading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      return res.json();
    },
    initialData,
    staleTime: 0,
  });

  const initIncognito = settings?.browser_incognito === "true";

  const [incognito, setIncognito] = useState(initIncognito);

  const initializedRef = useRef(!!settings);
  useEffect(() => {
    if (settings && !initializedRef.current) {
      initializedRef.current = true;
      setIncognito(settings.browser_incognito === "true");
    }
  }, [settings]);

  async function handleIncognitoToggle(checked: boolean) {
    setIncognito(checked);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "browser_incognito", value: String(checked) }),
    });
    toast.success(checked ? "Incognito mode enabled" : "Incognito mode disabled");
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-[80%]" />
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-1 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-[70%]" />
          </div>
          <Skeleton className="h-5 w-9 rounded-full shrink-0" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Configure how the automated browser behaves during skill execution.
      </p>

      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="incognito" className="text-sm font-medium">
            Incognito Mode
          </Label>
          <p className="text-xs text-muted-foreground">
            Launch the browser in incognito mode. No cookies, history, or
            cached data will persist between sessions. Takes effect on the
            next browser launch.
          </p>
        </div>
        <Switch
          id="incognito"
          checked={incognito}
          onCheckedChange={handleIncognitoToggle}
        />
      </div>
    </div>
  );
}
