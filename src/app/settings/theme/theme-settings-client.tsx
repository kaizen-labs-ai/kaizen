"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export function ThemeSettingsClient({ initialData }: { initialData: Record<string, string> }) {
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

  const initThemeKit = settings?.theme_kit_enabled === "true";
  const initLinkPreviews = settings?.link_previews_enabled !== "false";

  const [themeKitEnabled, setThemeKitEnabled] = useState(initThemeKit);
  const [linkPreviewsEnabled, setLinkPreviewsEnabled] = useState(initLinkPreviews);

  const initializedRef = useRef(!!settings);
  useEffect(() => {
    if (settings && !initializedRef.current) {
      initializedRef.current = true;
      setThemeKitEnabled(settings.theme_kit_enabled === "true");
      setLinkPreviewsEnabled(settings.link_previews_enabled !== "false");
    }
  }, [settings]);

  async function handleThemeKitToggle(checked: boolean) {
    setThemeKitEnabled(checked);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "theme_kit_enabled", value: String(checked) }),
    });
    toast.success(checked ? "Theme Kit enabled" : "Theme Kit disabled");
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  async function handleLinkPreviewsToggle(checked: boolean) {
    setLinkPreviewsEnabled(checked);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "link_previews_enabled", value: String(checked) }),
    });
    toast.success(checked ? "Link Previews enabled" : "Link Previews disabled");
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
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-1 flex-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-[65%]" />
          </div>
          <Skeleton className="h-5 w-9 rounded-full shrink-0" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Control how generated HTML pages are styled and how links are displayed.
      </p>

      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="theme-kit" className="text-sm font-medium">
            Kaizen Theme Kit
          </Label>
          <p className="text-xs text-muted-foreground">
            When enabled, generated HTML pages will use Kaizen&apos;s dark theme
            with shadcn-styled components. When disabled, the LLM chooses its own
            styling.
          </p>
        </div>
        <Switch
          id="theme-kit"
          checked={themeKitEnabled}
          onCheckedChange={handleThemeKitToggle}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="link-previews" className="text-sm font-medium">
            Link Previews
          </Label>
          <p className="text-xs text-muted-foreground">
            Show rich previews for URLs in chat messages (YouTube players,
            article cards, Spotify embeds, etc.).
          </p>
        </div>
        <Switch
          id="link-previews"
          checked={linkPreviewsEnabled}
          onCheckedChange={handleLinkPreviewsToggle}
        />
      </div>
    </div>
  );
}
