"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RotateCcw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DEFAULT_SOUL_TRAITS } from "@/lib/agent/soul-defaults";

interface Soul {
  id: string;
  name: string;
  description: string;
  traits: string;
}

export function SoulEditor({ initialData }: { initialData?: Soul | null }) {
  const [soul, setSoul] = useState<Soul | null>(initialData ?? null);
  const [form, setForm] = useState(
    initialData
      ? { name: initialData.name, description: initialData.description, traits: initialData.traits }
      : { name: "", description: "", traits: "" }
  );

  // Track last-saved values to avoid unnecessary saves
  const savedRef = useRef<Record<string, string>>(
    initialData
      ? { name: initialData.name, description: initialData.description, traits: initialData.traits }
      : {}
  );

  const { data: soulData, isLoading: loading, refetch: refetchSoul } = useQuery({
    queryKey: ["soul"],
    queryFn: async () => {
      const res = await fetch("/api/souls");
      const data = await res.json();
      return (data.find((s: Soul & { isActive: boolean }) => s.isActive) ?? data[0] ?? null) as Soul | null;
    },
    initialData: initialData ?? undefined,
    staleTime: 0,
  });

  const initializedRef = useRef(!!initialData);
  useEffect(() => {
    if (soulData && !initializedRef.current) {
      initializedRef.current = true;
      setSoul(soulData);
      setForm({ name: soulData.name, description: soulData.description, traits: soulData.traits });
      savedRef.current = { name: soulData.name, description: soulData.description, traits: soulData.traits };
    }
  }, [soulData]);

  const saveField = useCallback(async (field: string, value: string) => {
    if (savedRef.current[field] === value) return;

    // Build the full payload — API expects all fields
    const payload = { ...form, [field]: value };

    if (!payload.name.trim() || !payload.traits.trim()) {
      if (field === "name" && !value.trim()) {
        toast.error("Name is required");
        return;
      }
      if (field === "traits" && !value.trim()) {
        toast.error("Traits are required");
        return;
      }
    }

    try {
      let res: Response;
      if (soul) {
        res = await fetch(`/api/souls/${soul.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/souls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        savedRef.current[field] = value;
        // If newly created, reload to get the ID
        if (!soul) {
          const { data } = await refetchSoul();
          if (data) setSoul(data);
        }
        toast.success("Saved");
      } else {
        toast.error("Failed to save");
      }
    } catch {
      toast.error("Failed to save");
    }
  }, [form, soul, refetchSoul]);

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleBlur(field: string) {
    saveField(field, form[field as keyof typeof form]);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <Skeleton className="h-3.5 w-[85%]" />
          <Skeleton className="h-3.5 w-[70%]" />
        </div>
        <div className="space-y-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-10" />
            <div className="relative">
              <Skeleton className="h-9 w-full rounded-md !bg-transparent border border-border" />
              <Skeleton className="h-3 w-24 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <div className="relative">
              <Skeleton className="h-9 w-full rounded-md !bg-transparent border border-border" />
              <Skeleton className="h-3 w-44 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-3.5 w-10" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-7 w-28 rounded-md" />
            </div>
            <div className="relative">
              <Skeleton className="h-[192px] w-full rounded-md !bg-transparent border border-border" />
              <div className="absolute left-3 top-3 space-y-2.5 w-[80%]">
                <Skeleton className="h-3 w-[90%]" />
                <Skeleton className="h-3 w-[75%]" />
                <Skeleton className="h-3 w-[85%]" />
                <Skeleton className="h-3 w-[60%]" />
                <Skeleton className="h-3 w-[70%]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The soul defines your agent&apos;s personality and communication style.
        It is loaded into all agent system prompts to shape their communication style.
      </p>

      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="soul-name">Name</Label>
          <Input
            id="soul-name"
            value={form.name}
            onChange={(e) => handleChange("name", e.target.value)}
            onBlur={() => handleBlur("name")}
            placeholder="e.g. Agent K"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="soul-desc">Description</Label>
          <Input
            id="soul-desc"
            value={form.description}
            onChange={(e) => handleChange("description", e.target.value)}
            onBlur={() => handleBlur("description")}
            placeholder="Brief description of this personality"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="soul-traits">
              Traits <span className="text-xs text-muted-foreground">(markdown)</span>
            </Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => {
                handleChange("traits", DEFAULT_SOUL_TRAITS);
                // Save immediately after reset
                saveField("traits", DEFAULT_SOUL_TRAITS);
              }}
            >
              <RotateCcw className="mr-1 h-3 w-3" /> Reset to default
            </Button>
          </div>
          <Textarea
            id="soul-traits"
            value={form.traits}
            onChange={(e) => handleChange("traits", e.target.value)}
            onBlur={() => handleBlur("traits")}
            placeholder="Define the agent's personality, tone, values..."
            rows={12}
            className="font-mono text-xs md:text-xs"
          />
        </div>
      </div>
    </div>
  );
}
