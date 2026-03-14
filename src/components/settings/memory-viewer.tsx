"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export function MemoryViewer({ initialData }: { initialData?: string }) {
  const [content, setContent] = useState(initialData ?? "");

  // Track last-saved value to avoid unnecessary saves
  const savedRef = useRef(initialData ?? "");

  const { data: memoryContent, isLoading: loading } = useQuery({
    queryKey: ["memory"],
    queryFn: async () => {
      const res = await fetch("/api/memory");
      const data = await res.json();
      return (data.content ?? "") as string;
    },
    initialData,
    staleTime: 0,
  });

  const initializedRef = useRef(initialData !== undefined);
  useEffect(() => {
    if (memoryContent !== undefined && !initializedRef.current) {
      initializedRef.current = true;
      setContent(memoryContent);
      savedRef.current = memoryContent;
    }
  }, [memoryContent]);

  async function handleBlur() {
    if (content === savedRef.current) return;

    try {
      const res = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        savedRef.current = content;
        toast.success("Saved");
      } else {
        toast.error("Failed to save memory");
      }
    } catch {
      toast.error("Failed to save memory");
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <Skeleton className="h-3.5 w-[80%]" />
          <Skeleton className="h-3.5 w-[55%]" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-24" />
          <div className="relative">
            <Skeleton className="h-[192px] w-full rounded-md !bg-transparent border border-border" />
            <div className="absolute left-3 top-3 space-y-2.5 w-[80%]">
              <Skeleton className="h-3 w-[85%]" />
              <Skeleton className="h-3 w-[70%]" />
              <Skeleton className="h-3 w-[90%]" />
              <Skeleton className="h-3 w-[55%]" />
              <Skeleton className="h-3 w-[75%]" />
            </div>
          </div>
          <Skeleton className="h-3 w-14" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Persistent memory about the user. This is included in every agent system
        prompt to personalize interactions.
      </p>

      <div className="space-y-2">
        <Label htmlFor="memory-content">User Memory</Label>
        <Textarea
          id="memory-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={handleBlur}
          placeholder="The agent will learn about you over time, or you can add information manually..."
          rows={12}
          className="font-mono text-xs md:text-xs"
        />
        <p className="text-xs text-muted-foreground">
          {content.split("\n").length} lines
        </p>
      </div>
    </div>
  );
}
