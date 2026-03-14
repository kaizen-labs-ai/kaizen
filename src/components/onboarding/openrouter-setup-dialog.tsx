"use client";

import { useState } from "react";
import { Loader2, Eye, EyeOff, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOpenRouterKey } from "@/hooks/use-openrouter-key";
import { toast } from "sonner";

interface OpenRouterSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function OpenRouterSetupDialog({
  open,
  onOpenChange,
  onSaved,
}: OpenRouterSetupDialogProps) {
  const { saveKey } = useOpenRouterKey();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = key.trim();
    if (!trimmed) {
      setError("Please paste your API key");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await saveKey(trimmed);
      toast.success("OpenRouter API key saved");
      setKey("");
      setShow(false);
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect to OpenRouter</DialogTitle>
          <DialogDescription>
            Kaizen uses OpenRouter to route AI requests. You need an API key to
            get started.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-2">
            <p className="font-medium">How to get your API key:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
              <li>
                Go to{" "}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2 inline-flex items-center gap-0.5"
                >
                  openrouter.ai/keys
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>Create an account or sign in</li>
              <li>Click "Create Key" and copy the key</li>
              <li>Paste it below</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="or-key" className="text-xs">
              API Key
            </Label>
            <div className="relative">
              <Input
                id="or-key"
                type={show ? "text" : "password"}
                placeholder="sk-or-v1-..."
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
                className="pr-9"
                autoFocus
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShow(!show)}
                tabIndex={-1}
              >
                {show ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Saving
              </>
            ) : (
              "Save Key"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
