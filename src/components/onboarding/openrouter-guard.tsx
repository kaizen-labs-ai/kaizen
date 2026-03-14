"use client";

import { useState, useEffect } from "react";
import { useOpenRouterKey } from "@/hooks/use-openrouter-key";
import { OpenRouterSetupDialog } from "./openrouter-setup-dialog";
import { OpenRouterBanner } from "./openrouter-banner";

export function OpenRouterGuard() {
  const { hasKey, isLoaded } = useOpenRouterKey();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Auto-open dialog when no key detected on mount
  useEffect(() => {
    if (isLoaded && !hasKey) {
      setDialogOpen(true);
    }
  }, [isLoaded, hasKey]);

  // Reset dismissed state when key is added
  useEffect(() => {
    if (hasKey) {
      setDismissed(false);
      setDialogOpen(false);
    }
  }, [hasKey]);

  // Listen for custom event from other components (chat, voice)
  useEffect(() => {
    function handleOpenSetup() {
      setDialogOpen(true);
    }
    window.addEventListener("open-openrouter-setup", handleOpenSetup);
    return () =>
      window.removeEventListener("open-openrouter-setup", handleOpenSetup);
  }, []);

  if (!isLoaded || hasKey) return null;

  return (
    <>
      <OpenRouterSetupDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setDismissed(true);
        }}
      />
      <OpenRouterBanner onSetup={() => setDialogOpen(true)} />
    </>
  );
}
