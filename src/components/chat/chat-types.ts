// ── Shared types for chat components ────────────────────────────

export interface StepData {
  type: string;
  content: unknown;
  toolId?: string;
  createdAt?: string;
}

export interface ArtifactInfo {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  summary?: string;
}

export interface ChatApiMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  objectiveId?: string;
  objective?: { id?: string; phase?: string };
  run?: {
    status?: string;
    steps?: { type: string; content: string; toolId?: string; createdAt?: string }[];
    artifacts?: ArtifactInfo[];
  };
}

export interface ChatApiResponse {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  hasUnread: boolean;
  messages: ChatApiMessage[];
  activeRun?: { runId: string; label: string } | null;
}

/** A chat entry is either a text bubble, a group of tool steps, or artifact cards */
export interface ChatEntry {
  id: string;
  kind: "message" | "steps" | "artifacts";
  role?: "user" | "assistant";
  content?: string;
  steps?: StepData[];
  artifacts?: ArtifactInfo[];
  runStatus?: string;
}

// ── Utility functions ───────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** MIME types that can be opened inline in a browser tab */
export function isViewableInBrowser(mimeType: string): boolean {
  if (mimeType.startsWith("image/")) return true;
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/pdf") return true;
  if (mimeType === "application/json") return true;
  return false;
}
