"use client";

import { AlertTriangle, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OpenRouterBannerProps {
  onSetup: () => void;
}

export function OpenRouterBanner({ onSetup }: OpenRouterBannerProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 min-h-[57px] text-sm shrink-0">
      <div className="flex items-center gap-2 text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        <span>OpenRouter API key required to use Kaizen</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={onSetup}
      >
        <KeyRound className="h-4 w-4 mr-1" />
        Set up now
      </Button>
    </div>
  );
}
