"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatInput } from "./chat-input";
import { ChatMessage } from "./chat-message";
import { PlanProposal } from "./plan-proposal";
import { RunStepViewer } from "@/components/runs/run-step-viewer";
import { Code, Download, ExternalLink, FileText } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import Link from "next/link";
import type { ChatEntry, ChatApiResponse } from "./chat-types";
import { formatFileSize, isViewableInBrowser } from "./chat-types";
import { useChatLoader, processChatMessages } from "./use-chat-loader";
import { useChatStream } from "./use-chat-stream";

/** Extract a plan proposal from assistant message content (supports both legacy options and sectioned formats) */
function parsePlanProposalContent(content: string): {
  summary: string;
  options?: { label: string; description: string }[];
  sections?: { dimension: string; choices: string[] }[];
} | null {
  const match = content.match(/<!--plan_proposal-->([\s\S]*)<!--\/plan_proposal-->/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.summary && (Array.isArray(parsed.options) || Array.isArray(parsed.sections))) return parsed;
  } catch { /* invalid JSON */ }
  return null;
}

interface ChatViewProps {
  chatId?: string;
  initialChatData?: ChatApiResponse | null;
  initialSkill?: { id: string; name: string };
  initialPlugin?: { id: string; name: string };
}

export function ChatView({ chatId, initialChatData, initialSkill, initialPlugin }: ChatViewProps) {
  const [entries, setEntries] = useState<ChatEntry[]>(
    () => initialChatData ? processChatMessages(initialChatData.messages) : []
  );
  const [devMode, setDevMode] = useState(false);
  const [activeObjectiveId, setActiveObjectiveId] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Sync dev mode from localStorage after hydration
  useEffect(() => {
    const saved = localStorage.getItem("kaizen_dev_mode");
    if (saved === "true") setDevMode(true);
  }, []);

  // Settings from shared React Query cache
  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      return res.json();
    },
  });
  const linkPreviewsEnabled = settingsData?.link_previews_enabled !== "false";
  const voiceEnabled = settingsData?.voice_input_enabled !== "false";
  const hasOpenRouterKey = settingsData?.has_openrouter_key === "true";

  // Chat loader hook
  const loader = useChatLoader(chatId, setEntries, initialChatData ?? undefined, setActiveObjectiveId, setActivePhase);

  // Chat stream hook
  const { handleSend, handleStop, activityLabel } = useChatStream({
    currentChatId: loader.currentChatId,
    setCurrentChatId: loader.setCurrentChatId,
    entries,
    setEntries,
    loadChat: loader.loadChat,
    setChatTitle: loader.setChatTitle,
    mountedRef: loader.mountedRef,
    runIdRef: loader.runIdRef,
    isStreaming: loader.isStreaming,
    setIsStreaming: loader.setIsStreaming,
    activeObjectiveId,
    activePhase,
    setActiveObjectiveId,
    setActivePhase,
  });

  // Guard send: open onboarding dialog if no API key
  const guardedSend = useCallback(
    (...args: Parameters<typeof handleSend>) => {
      if (!hasOpenRouterKey) {
        window.dispatchEvent(new Event("open-openrouter-setup"));
        return;
      }
      handleSend(...args);
    },
    [hasOpenRouterKey, handleSend],
  );

  // Reset to blank chat when sidebar "+" is clicked (avoids blocked startTransition)
  useEffect(() => {
    const handleReset = () => {
      setEntries([]);
      setActiveObjectiveId(null);
      setActivePhase(null);
      loader.setCurrentChatId(null);
      loader.setChatTitle("");
    };
    window.addEventListener("new-chat-reset", handleReset);
    return () => window.removeEventListener("new-chat-reset", handleReset);
  }, [loader.setCurrentChatId, loader.setChatTitle, setEntries]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  if (loader.loading) return null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={
          <Toggle
            pressed={devMode}
            onPressedChange={(v) => { setDevMode(v); localStorage.setItem("kaizen_dev_mode", String(v)); }}
            size="sm"
            className="h-8 gap-1.5 text-xs shrink-0"
            aria-label="Toggle dev mode"
          >
            <Code className="h-3.5 w-3.5" />
            Dev
          </Toggle>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/chats">Chats</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="truncate">{loader.chatTitle || "New Chat"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <div className="relative flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-xl space-y-6 p-4 pb-32">
            {entries.length === 0 && (
              <div className="flex h-[60vh] items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <p className="text-2xl font-semibold">Kaizen</p>
                  <p className="mt-1 text-sm">
                    Describe your objective to get started
                  </p>
                </div>
              </div>
            )}

            {(() => {
              const filtered = entries.filter(
                (entry) =>
                  entry.kind === "steps" ||
                  entry.kind === "artifacts" ||
                  (entry.kind === "message" && entry.content && entry.content.trim() !== "")
              );
              return filtered.map((entry, index) =>
                entry.kind === "message" ? (
                  (() => {
                    // Detect plan proposals in assistant messages
                    if (entry.role === "assistant") {
                      const proposal = parsePlanProposalContent(entry.content ?? "");
                      if (proposal) {
                        const hasResponse = filtered.slice(index + 1).some(
                          (e) => e.kind === "message" && e.role === "user"
                        );
                        return (
                          <PlanProposal
                            key={entry.id}
                            summary={proposal.summary}
                            options={proposal.options}
                            sections={proposal.sections}
                            onSelect={(text) => guardedSend(text)}
                            disabled={hasResponse}
                            voiceEnabled={voiceEnabled}
                          />
                        );
                      }
                    }
                    return (
                      <ChatMessage
                        key={entry.id}
                        role={entry.role!}
                        content={entry.content ?? ""}
                        linkPreviewsEnabled={linkPreviewsEnabled}
                      />
                    );
                  })()
                ) : entry.kind === "artifacts" ? (
                  (() => {
                    const nonImageArtifacts = entry.artifacts?.filter((a) => !a.mimeType.startsWith("image/")) ?? [];
                    if (nonImageArtifacts.length === 0) return null;
                    return (
                      <div key={entry.id} className="flex flex-wrap gap-2">
                        {nonImageArtifacts.map((a) => {
                          const viewable = isViewableInBrowser(a.mimeType);
                          return (
                            <a
                              key={a.id}
                              href={viewable ? `/api/artifacts/${a.id}/download?inline=1` : `/api/artifacts/${a.id}/download`}
                              {...(viewable ? { target: "_blank", rel: "noopener noreferrer" } : { download: a.filename })}
                              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-accent transition-colors"
                            >
                              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div className="min-w-0">
                                <div className="font-medium truncate">{a.filename}</div>
                                <div className="text-xs text-muted-foreground">
                                  {formatFileSize(a.sizeBytes)}
                                </div>
                              </div>
                              {viewable
                                ? <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                : <Download className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                            </a>
                          );
                        })}
                      </div>
                    );
                  })()
                ) : (
                  <RunStepViewer key={entry.id} steps={entry.steps ?? []} devMode={devMode} runStatus={entry.runStatus} />
                )
              );
            })()}

            {loader.isStreaming && !devMode && (
              <p className="text-sm text-muted-foreground animate-pulse py-2">
                {activityLabel}...
              </p>
            )}

            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background from-60% to-transparent pt-8 pb-4 px-4">
          <div className="mx-auto max-w-xl">
            <ChatInput onSend={guardedSend} onStop={handleStop} isStreaming={loader.isStreaming} voiceEnabled={voiceEnabled} initialSkill={initialSkill} initialPlugin={initialPlugin} />
          </div>
        </div>
      </div>
    </div>
  );
}
