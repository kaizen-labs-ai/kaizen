"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";

interface AgentConfig {
  id: string;
  type: string;
  label: string;
  model: string;
  imageModel: string | null;
  fileModel: string | null;
  audioModel: string | null;
  videoModel: string | null;
  thinking: boolean;
  timeout: number;
  enabled: boolean;
  systemPrompt: string;
}

export function AgentDetailClient({ initialData, id }: { initialData: AgentConfig | null; id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [agent, setAgent] = useState<AgentConfig | null>(initialData);
  const [model, setModel] = useState(initialData?.model ?? "");
  const [imageModel, setImageModel] = useState(initialData?.imageModel ?? "");
  const [fileModel, setFileModel] = useState(initialData?.fileModel ?? "");
  const [audioModel, setAudioModel] = useState(initialData?.audioModel ?? "");
  const [videoModel, setVideoModel] = useState(initialData?.videoModel ?? "");
  const [thinking, setThinking] = useState(initialData?.thinking ?? false);
  const [timeout, setTimeout_] = useState(initialData?.timeout ?? 120);
  const [loading, setLoading] = useState(!initialData);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [interactivePlanning, setInteractivePlanning] = useState(false);
  const [deepSkills, setDeepSkills] = useState(false);

  // Track last-saved values to avoid unnecessary saves on blur
  const savedRef = useRef<Record<string, unknown>>(initialData ? {
    model: initialData.model,
    imageModel: initialData.imageModel ?? "",
    fileModel: initialData.fileModel ?? "",
    audioModel: initialData.audioModel ?? "",
    videoModel: initialData.videoModel ?? "",
    thinking: initialData.thinking,
    timeout: initialData.timeout,
  } : {});

  const loadAgent = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${id}`);
      if (!res.ok) {
        router.push("/settings/agents");
        return;
      }
      const data: AgentConfig = await res.json();
      setAgent(data);
      setModel(data.model);
      setImageModel(data.imageModel ?? "");
      setFileModel(data.fileModel ?? "");
      setAudioModel(data.audioModel ?? "");
      setVideoModel(data.videoModel ?? "");
      setThinking(data.thinking);
      setTimeout_(data.timeout);
      savedRef.current = {
        model: data.model,
        imageModel: data.imageModel ?? "",
        fileModel: data.fileModel ?? "",
        audioModel: data.audioModel ?? "",
        videoModel: data.videoModel ?? "",
        thinking: data.thinking,
        timeout: data.timeout,
      };
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    if (!initialData) loadAgent();
  }, [loadAgent]);

  // Load agent-specific settings
  useEffect(() => {
    if (id !== "planner" && id !== "executor") return;
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (id === "planner" && data.interactive_planning === "true") setInteractivePlanning(true);
        if (id === "executor" && data.deep_skills === "true") setDeepSkills(true);
      })
      .catch(() => {});
  }, [id]);

  // Autosave a partial update — only sends changed fields
  const saveFields = useCallback(async (fields: Record<string, unknown>) => {
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (savedRef.current[key] !== value) {
        changed[key] = value;
      }
    }
    if (Object.keys(changed).length === 0) return;

    try {
      const res = await fetch(`/api/agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changed),
      });
      if (res.ok) {
        const data = await res.json();
        setAgent((prev) => prev ? { ...prev, ...data } : data);
        for (const [key, value] of Object.entries(changed)) {
          savedRef.current[key] = value;
        }
        queryClient.invalidateQueries({ queryKey: ["agents"] });
        toast.success("Saved");
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ? `Failed to save: ${err.error}` : "Failed to save");
      }
    } catch {
      toast.error("Failed to save");
    }
  }, [id]);

  // Blur handler for text/model inputs
  function handleModelBlur(field: string, value: string) {
    const trimmed = value.trim();
    if (field === "model" && !trimmed) {
      toast.error("Model ID is required");
      return;
    }
    saveFields({ [field]: trimmed });
  }

  // Blur handler for timeout
  function handleTimeoutBlur() {
    const clamped = Math.max(10, Math.min(600, timeout || 120));
    setTimeout_(clamped);
    saveFields({ timeout: clamped });
  }

  // Switch handlers — save immediately on toggle
  function handleThinkingChange(value: boolean) {
    setThinking(value);
    saveFields({ thinking: value });
  }

  if (loading) {
    return (
      <div className="flex h-[40vh] items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!agent) return null;

  const isSystem = agent.type === "system";

  // Show modality model fields for agents that use them
  const hasModalityModels = agent.id === "reviewer" || agent.id === "executor";
  // Router has a single audioModel for transcribing voice messages
  const hasAudioOnly = agent.id === "router";

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/settings/agents"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h2 className="text-lg font-medium">{agent.label}</h2>
      </div>

      <div className="space-y-6">
        {/* Standard agents: standalone model field */}
        {!hasModalityModels && (
          <div className="space-y-2">
            <Label>OpenRouter Model</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => handleModelBlur("model", model)}
              placeholder="anthropic/claude-sonnet-4"
            />
            <p className="text-xs text-muted-foreground">
              Default model for text-based tasks
            </p>
          </div>
        )}

        {/* Router: audio model for transcribing voice messages */}
        {hasAudioOnly && (
          <div className="space-y-2">
            <Label>Audio Model</Label>
            <Input
              value={audioModel}
              onChange={(e) => setAudioModel(e.target.value)}
              onBlur={() => handleModelBlur("audioModel", audioModel)}
              placeholder="google/gemini-3-flash-preview"
            />
            <p className="text-xs text-muted-foreground">
              Model for transcribing voice messages (must support audio input)
            </p>
          </div>
        )}

        {/* Modality models — grouped for executor and reviewer */}
        {hasModalityModels && (
          <div className="space-y-4 rounded-md border border-muted-foreground/20 p-4">
            <div>
              <h3 className="text-sm font-medium">Modality Models</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {agent.id === "executor"
                  ? "Models used for different input types. Leave blank to use the text model."
                  : "Choose models by input modality. Leave blank to use the text model."}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Text Model</Label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => handleModelBlur("model", model)}
                placeholder="google/gemini-3-flash-preview"
              />
              <p className="text-xs text-muted-foreground">
                {agent.id === "executor" ? "Default model for text messages and tasks" : "Default model for text-based review"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Image Model</Label>
              <Input
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value)}
                onBlur={() => handleModelBlur("imageModel", imageModel)}
                placeholder="google/gemini-3-flash-preview"
              />
              <p className="text-xs text-muted-foreground">
                {agent.id === "executor"
                  ? "Model for understanding image inputs (must support vision)"
                  : "For reviewing image outputs (PNG, JPG, SVG)"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>File Model</Label>
              <Input
                value={fileModel}
                onChange={(e) => setFileModel(e.target.value)}
                onBlur={() => handleModelBlur("fileModel", fileModel)}
                placeholder="google/gemini-3-flash-preview"
              />
              <p className="text-xs text-muted-foreground">
                {agent.id === "executor"
                  ? "Model for understanding file inputs like PDFs and documents (must support file input)"
                  : "For reviewing file outputs (PDF, documents)"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Audio Model</Label>
              <Input
                value={audioModel}
                onChange={(e) => setAudioModel(e.target.value)}
                onBlur={() => handleModelBlur("audioModel", audioModel)}
                placeholder="google/gemini-3-flash-preview"
              />
              <p className="text-xs text-muted-foreground">
                {agent.id === "executor"
                  ? "Model for voice messages and audio (must support audio input)"
                  : "For reviewing audio outputs (future)"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Video Model</Label>
              <Input
                value={videoModel}
                onChange={(e) => setVideoModel(e.target.value)}
                onBlur={() => handleModelBlur("videoModel", videoModel)}
                placeholder={agent.id === "executor" ? "google/gemini-3.1-pro-preview" : ""}
              />
              <p className="text-xs text-muted-foreground">
                {agent.id === "executor"
                  ? "Model for video inputs (must support video)"
                  : "For reviewing video outputs (future)"}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <Label>Thinking Mode</Label>
            <p className="text-xs text-muted-foreground">
              Enable extended reasoning on supported models
            </p>
          </div>
          <Switch checked={thinking} onCheckedChange={handleThinkingChange} />
        </div>

        {agent.id === "planner" && (
          <div className="flex items-center justify-between">
            <div>
              <Label>Interactive Planning</Label>
              <p className="text-xs text-muted-foreground">
                Present approach options for the user to choose before executing
              </p>
            </div>
            <Switch
              checked={interactivePlanning}
              onCheckedChange={async (value) => {
                setInteractivePlanning(value);
                try {
                  await fetch("/api/settings", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key: "interactive_planning", value: String(value) }),
                  });
                  toast.success(value ? "Interactive planning enabled" : "Interactive planning disabled");
                } catch {
                  toast.error("Failed to save");
                }
              }}
            />
          </div>
        )}

        {agent.id === "executor" && (
          <div className="flex items-center justify-between">
            <div>
              <Label>Deep Skills</Label>
              <p className="text-xs text-muted-foreground">
                After creating a skill, smoke-test it by running each step, then self-correct any issues before delivering
              </p>
            </div>
            <Switch
              checked={deepSkills}
              onCheckedChange={async (value) => {
                setDeepSkills(value);
                try {
                  await fetch("/api/settings", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key: "deep_skills", value: String(value) }),
                  });
                  toast.success(value ? "Deep Skills enabled" : "Deep Skills disabled");
                } catch {
                  toast.error("Failed to save");
                }
              }}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label>Timeout (seconds)</Label>
          <Input
            type="number"
            min={10}
            max={600}
            value={timeout}
            onChange={(e) => setTimeout_(Math.max(10, Math.min(600, Number(e.target.value) || 120)))}
            onBlur={handleTimeoutBlur}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">
            Max wait time per LLM call before timing out (10–600s)
          </p>
        </div>

        {/* System prompt — read-only for system agents */}
        {isSystem && (
          <div className="space-y-2">
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setPromptExpanded(!promptExpanded)}
            >
              {promptExpanded
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronRight className="h-3.5 w-3.5" />}
              System Prompt
            </button>
            {promptExpanded && (
              <>
                <p className="text-xs text-muted-foreground">
                  Managed by the orchestration engine — read only.
                </p>
                <Textarea
                  value={agent.systemPrompt}
                  readOnly
                  className="min-h-[400px] font-mono text-xs md:text-xs leading-relaxed resize-y opacity-70 cursor-default"
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
