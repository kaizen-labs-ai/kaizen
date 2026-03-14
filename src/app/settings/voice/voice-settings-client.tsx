"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Circle, Keyboard, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { toast } from "sonner";

const CODE_DEFAULT_PROMPT =
  'Transcribe this audio into clean, well-formatted text. Fix filler words, false starts, and misheard words to produce natural sentences. If the speaker uses numbered items (e.g. "one ... two ..."), format them as a numbered list. Use proper punctuation and capitalization. Output ONLY the final text, nothing else.';

// Must match VOICE_PROMPT_CODE_VERSION in registry.ts
const CODE_PROMPT_VERSION = 2;

export function VoiceSettingsClient({ initialData }: { initialData: Record<string, string> }) {
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

  // Derive initial values from cached/loaded settings — avoids false→true flicker on mount
  const initEnabled = settings?.voice_input_enabled === "true";
  const initModel = settings?.voice_input_model || "google/gemini-2.5-flash";
  const initPrompt = settings?.voice_input_prompt || CODE_DEFAULT_PROMPT;
  const initVersion = parseInt(settings?.voice_input_prompt_version || "0", 10);

  const [enabled, setEnabled] = useState(initEnabled);
  const [model, setModel] = useState(initModel);
  const savedModelRef = useRef(initModel);
  const [prompt, setPrompt] = useState(initPrompt);
  const savedPromptRef = useRef(initPrompt);
  const [promptVersion, setPromptVersion] = useState(initVersion);
  const [showingDiff, setShowingDiff] = useState(false);
  const hasInteractedRef = useRef(false);

  const hasUpdate = promptVersion < CODE_PROMPT_VERSION;

  // Sync state when settings load for the first time (cache miss)
  const initializedRef = useRef(!!settings);
  useEffect(() => {
    if (settings && !initializedRef.current) {
      initializedRef.current = true;
      setEnabled(settings.voice_input_enabled === "true");
      const m = settings.voice_input_model || "google/gemini-2.5-flash";
      setModel(m);
      savedModelRef.current = m;
      const p = settings.voice_input_prompt || CODE_DEFAULT_PROMPT;
      setPrompt(p);
      savedPromptRef.current = p;
      setPromptVersion(parseInt(settings.voice_input_prompt_version || "0", 10));
    }
  }, [settings]);

  async function handleToggle(checked: boolean) {
    hasInteractedRef.current = true;
    setEnabled(checked);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "voice_input_enabled", value: String(checked) }),
    });
    toast.success(checked ? "Voice input enabled" : "Voice input disabled");
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  async function handleModelSave() {
    const trimmed = model.trim();
    if (!trimmed || trimmed === savedModelRef.current) return;
    savedModelRef.current = trimmed;
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "voice_input_model", value: trimmed }),
    });
    toast.success("Voice model updated");
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  async function handlePromptSave() {
    const trimmed = prompt.trim();
    if (!trimmed || trimmed === savedPromptRef.current) return;
    savedPromptRef.current = trimmed;
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "voice_input_prompt", value: trimmed }),
    });
    toast.success("Voice prompt updated");
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  async function handleAcceptUpdate() {
    setPrompt(CODE_DEFAULT_PROMPT);
    savedPromptRef.current = CODE_DEFAULT_PROMPT;
    setPromptVersion(CODE_PROMPT_VERSION);
    setShowingDiff(false);
    await Promise.all([
      fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "voice_input_prompt", value: CODE_DEFAULT_PROMPT }),
      }),
      fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "voice_input_prompt_version", value: String(CODE_PROMPT_VERSION) }),
      }),
    ]);
    toast.success("Voice prompt updated to v" + CODE_PROMPT_VERSION);
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  async function handleDismissUpdate() {
    setPromptVersion(CODE_PROMPT_VERSION);
    setShowingDiff(false);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "voice_input_prompt_version", value: String(CODE_PROMPT_VERSION) }),
    });
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  // ── Dictation shortcut ──────────────────────────────
  const initShortcut = settings?.voice_dictation_shortcut || "";
  const [shortcut, setShortcut] = useState(initShortcut);
  const [isListening, setIsListening] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const listeningKeysRef = useRef<Set<string>>(new Set());

  // Sync shortcut when settings load
  useEffect(() => {
    if (settings && !initializedRef.current) {
      // initializedRef already set above — use a separate check
    }
  }, [settings]);

  // Also sync shortcut specifically
  const shortcutInitRef = useRef(false);
  useEffect(() => {
    if (settings && !shortcutInitRef.current) {
      shortcutInitRef.current = true;
      setShortcut(settings.voice_dictation_shortcut || "");
    }
  }, [settings]);

  const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift"]);
  const BLOCKED_KEYS = new Set(["Meta", "OS", "ContextMenu"]);
  const FUNCTION_KEY_PATTERN = /^F([1-9]|1[0-2])$/;

  const DISPLAY_NAMES: Record<string, string> = {
    Control: "Ctrl",
    " ": "Space",
    Backquote: "`",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };

  function displayKey(key: string): string {
    return DISPLAY_NAMES[key] || key;
  }

  function validateShortcut(keys: string[]): string | null {
    if (keys.length === 0) return "No keys pressed";
    if (keys.length > 3) return "Maximum 3 keys allowed";

    if (keys.some((k) => BLOCKED_KEYS.has(k))) {
      return "System keys (Win/Cmd) are reserved and can't be used";
    }

    const modifiers = keys.filter((k) => MODIFIER_KEYS.has(k));
    const nonModifiers = keys.filter((k) => !MODIFIER_KEYS.has(k));

    if (keys.length === 1) {
      const k = keys[0];
      if (FUNCTION_KEY_PATTERN.test(k)) return null;
      if (/^[a-zA-Z]$/.test(k)) return "Alphabetical keys aren't allowed as shortcuts";
      if (/^[0-9]$/.test(k)) return "Number keys aren't allowed as shortcuts";
      if (MODIFIER_KEYS.has(k)) return "Add a second key to your shortcut";
      return "This key needs a modifier (Ctrl, Alt, or Shift)";
    }

    if (nonModifiers.length === 0 && modifiers.length >= 2) return null;

    if (modifiers.length >= 1 && nonModifiers.length >= 1) {
      return null;
    }

    return "Invalid shortcut combination";
  }

  async function saveShortcut(value: string) {
    setShortcut(value);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "voice_dictation_shortcut", value }),
    });
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    if (value) {
      toast.success("Dictation shortcut saved");
    } else {
      toast.success("Dictation shortcut cleared");
    }
  }

  // Keyboard listener for shortcut recording
  const peakKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isListening) return;

    listeningKeysRef.current.clear();
    peakKeysRef.current.clear();
    setShortcutError(null);

    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      const key = e.key;

      if (key === "Escape") {
        setIsListening(false);
        return;
      }

      listeningKeysRef.current.add(key);
      if (listeningKeysRef.current.size > peakKeysRef.current.size) {
        peakKeysRef.current = new Set(listeningKeysRef.current);
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      listeningKeysRef.current.delete(e.key);

      if (listeningKeysRef.current.size > 0) return;

      const keys = Array.from(peakKeysRef.current);
      peakKeysRef.current.clear();

      const sorted = keys.sort((a, b) => {
        const aIsModifier = MODIFIER_KEYS.has(a) ? 0 : 1;
        const bIsModifier = MODIFIER_KEYS.has(b) ? 0 : 1;
        return aIsModifier - bIsModifier || a.localeCompare(b);
      });

      const error = validateShortcut(sorted);
      if (error) {
        setShortcutError(error);
        return;
      }

      setIsListening(false);
      setShortcutError(null);
      saveShortcut(sorted.join("+"));
    }

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [isListening]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-[75%]" />
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1 flex-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-[60%]" />
            </div>
            <Skeleton className="h-5 w-9 rounded-full shrink-0" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Enable speech-to-text input in the chat composer. Audio is recorded in
        your browser and transcribed via OpenRouter.
      </p>

      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="voice-input" className="text-sm font-medium">
              Voice Input
            </Label>
            <p className="text-xs text-muted-foreground">
              Show a microphone button in the chat composer for speech-to-text
              dictation.
            </p>
          </div>
          <Switch
            id="voice-input"
            checked={enabled}
            onCheckedChange={handleToggle}
          />
        </div>

        <div
          className={`grid${hasInteractedRef.current ? " transition-all duration-300 ease-in-out" : ""}`}
          style={{ gridTemplateRows: enabled ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div className="space-y-4 pt-4 border-t mt-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Transcription Model</Label>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  onBlur={handleModelSave}
                  placeholder="google/gemini-2.5-flash"
                />
                <p className="text-xs text-muted-foreground">
                  Paste an OpenRouter model ID that supports audio input.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">System Prompt</Label>

                {hasUpdate && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                        <span className="text-sm font-medium text-amber-400">
                          Prompt update available (v{CODE_PROMPT_VERSION})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={handleAcceptUpdate}
                        >
                          Accept
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setShowingDiff(!showingDiff)}
                        >
                          {showingDiff ? "Hide diff" : "View diff"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-muted-foreground"
                          onClick={handleDismissUpdate}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                    {showingDiff && (
                      <div className="rounded border border-border bg-muted/50 p-3 max-h-[300px] overflow-y-auto">
                        <p className="text-xs text-muted-foreground mb-2">
                          New default prompt (v{CODE_PROMPT_VERSION}):
                        </p>
                        <pre className="text-xs font-mono whitespace-pre-wrap text-foreground/80">
                          {CODE_DEFAULT_PROMPT}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onBlur={handlePromptSave}
                  className="min-h-[120px] font-mono text-xs md:text-xs leading-relaxed resize-y"
                  placeholder="Transcribe this audio exactly as spoken..."
                />
                <p className="text-xs text-muted-foreground">
                  Instructions sent alongside the audio to the transcription model.
                </p>
              </div>

              <div className="border-t border-border" />

              {/* Dictation shortcut */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Keyboard className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">Keyboard Shortcuts</Label>
                </div>
                <p className="text-xs text-muted-foreground !mb-3">
                  Dictate into any text field using keyboard shortcuts.
                </p>
                <p className="text-sm font-medium text-foreground mb-1">Dictation</p>
                <p className="text-xs text-muted-foreground !mb-3">
                  Hold down to speak. Double-press for hands-free mode.
                </p>

                {shortcut ? (
                  <div className="flex items-center gap-2">
                    <KbdGroup>
                      {shortcut.split("+").map((key: string, i: number) => (
                        <span key={key} className="inline-flex items-center gap-1">
                          {i > 0 && <span className="text-xs text-muted-foreground">+</span>}
                          <Kbd className="h-7 min-w-[28px] px-2 rounded-md border border-border text-xs">
                            {displayKey(key)}
                          </Kbd>
                        </span>
                      ))}
                    </KbdGroup>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => saveShortcut("")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : isListening ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-8 flex items-center px-3 rounded-md border border-primary/50 bg-primary/5 text-xs text-primary animate-pulse">
                        Press keys...
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground"
                        onClick={() => { setIsListening(false); setShortcutError(null); }}
                      >
                        Cancel
                      </Button>
                    </div>
                    {shortcutError && (
                      <p className="text-xs text-destructive">{shortcutError}</p>
                    )}
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    data-dictation-ignore="true"
                    onClick={() => setIsListening(true)}
                  >
                    <Circle className="mr-1.5 size-2 fill-red-500 text-red-500" />
                    Record Shortcut
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
