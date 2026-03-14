"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChatEntry, ArtifactInfo, StepData } from "./chat-types";
import type { UploadedFile } from "./chat-input";

// ── Step label map ──────────────────────────────────────────────

const STEP_LABEL_MAP: Record<string, string> = {
  routing: "Thinking",
  search: "Searching",
  agent_handoff: "Working",
  reasoning: "Thinking",
  tool_call: "Working",
  tool_result: "Working",
  developer_enhancement: "Coding",
  pipeline_execution: "Testing",
  review: "Reviewing",
  pipeline_summary: "Finishing",
  executor_summary: "Typing",
};

// ── Chat stream hook ────────────────────────────────────────────
// Handles SSE streaming (user-initiated) and server-pushed run events.

export interface UseChatStreamOptions {
  currentChatId: string | null;
  setCurrentChatId: (id: string | null) => void;
  entries: ChatEntry[];
  setEntries: React.Dispatch<React.SetStateAction<ChatEntry[]>>;
  loadChat: (id: string) => Promise<void>;
  setChatTitle: (title: string) => void;
  mountedRef: React.RefObject<boolean>;
  runIdRef: React.MutableRefObject<string | null>;
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  activeObjectiveId: string | null;
  activePhase: string | null;
  setActiveObjectiveId: (id: string | null) => void;
  setActivePhase: (phase: string | null) => void;
}

export interface UseChatStreamResult {
  handleSend: (userMessage: string, attachments?: UploadedFile[], skillId?: string, pluginId?: string) => Promise<void>;
  handleStop: () => void;
  activityLabel: string;
}

export function useChatStream(opts: UseChatStreamOptions): UseChatStreamResult {
  const {
    currentChatId, setCurrentChatId,
    entries, setEntries,
    loadChat, setChatTitle, mountedRef, runIdRef,
    isStreaming, setIsStreaming,
    activeObjectiveId, activePhase,
    setActiveObjectiveId, setActivePhase,
  } = opts;

  const [activityLabel, setActivityLabel] = useState("Thinking");
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  // Reset stream state when sidebar "+" triggers a new-chat-reset.
  // This aborts any active SSE fetch and stops processing server-pushed events,
  // allowing the ChatView to reset to a blank state without page navigation.
  useEffect(() => {
    const handleReset = () => {
      abortRef.current?.abort();
      abortRef.current = null;
      serverStreamRef.current = { active: false, msgId: null, stepsId: null, lastKind: null };
      runIdRef.current = null;
      setIsStreaming(false);
      setActivityLabel("Thinking");
    };
    window.addEventListener("new-chat-reset", handleReset);
    return () => {
      window.removeEventListener("new-chat-reset", handleReset);
      abortRef.current?.abort();
    };
  }, [setIsStreaming, runIdRef]);

  // Server-pushed run streaming state
  const serverStreamRef = useRef<{
    active: boolean;
    msgId: string | null;
    stepsId: string | null;
    lastKind: "message" | "steps" | null;
  }>({ active: false, msgId: null, stepsId: null, lastKind: null });

  // Listen for server-pushed events (WhatsApp messages, run lifecycle)
  useEffect(() => {
    if (!currentChatId) return;
    const id = currentChatId;

    function onServerEvent(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.chatId || detail.chatId !== id) return;

      const eventType = detail.type as string;

      if (eventType === "trigger-message") {
        const content = detail.content as string;
        setEntries((prev) => [
          ...prev,
          { id: crypto.randomUUID(), kind: "message", role: "user", content },
        ]);
        return;
      }

      if (eventType === "run-started") {
        if (serverStreamRef.current.active || isStreaming) return;
        serverStreamRef.current = { active: true, msgId: null, stepsId: null, lastKind: null };
        setIsStreaming(true);
        setActivityLabel("Thinking");
        runIdRef.current = detail.runId ?? null;
        return;
      }

      const ss = serverStreamRef.current;

      // Auto-activate server stream if we missed run-started (e.g. scheduled run
      // created the chat before the user navigated to it)
      if (!ss.active && !isStreaming &&
          (eventType === "run-delta" || eventType === "run-step" || eventType === "run-activity")) {
        ss.active = true;
        ss.msgId = null;
        ss.stepsId = null;
        ss.lastKind = null;
        setIsStreaming(true);
        setActivityLabel("Thinking");
      }

      if (eventType === "run-activity" && ss.active) {
        setActivityLabel(detail.label as string);
        return;
      }

      if (eventType === "run-delta" && ss.active) {
        const text = detail.text as string;
        setActivityLabel("Typing");
        if (ss.lastKind === "steps" || ss.lastKind === null) {
          const newMsgId = crypto.randomUUID();
          ss.msgId = newMsgId;
          ss.stepsId = null;
          ss.lastKind = "message";
          setEntries((prev) => [
            ...prev,
            { id: newMsgId, kind: "message", role: "assistant", content: text },
          ]);
        } else {
          const msgId = ss.msgId!;
          setEntries((prev) =>
            prev.map((entry) =>
              entry.id === msgId
                ? { ...entry, content: (entry.content ?? "") + text }
                : entry
            )
          );
        }
        return;
      }

      if (eventType === "run-step" && (ss.active || isStreaming)) {
        const step = detail.step as StepData;
        if (STEP_LABEL_MAP[step.type]) setActivityLabel(STEP_LABEL_MAP[step.type]);
        if (step.type === "agent_handoff") {
          const handoff = step.content as Record<string, unknown>;
          if (handoff.agent === "image-generator") setActivityLabel("Generating image");
        }

        if (ss.active) {
          if (ss.lastKind !== "steps" || !ss.stepsId) {
            const newStepsId = crypto.randomUUID();
            ss.stepsId = newStepsId;
            ss.lastKind = "steps";
            setEntries((prev) => [
              ...prev,
              { id: newStepsId, kind: "steps", steps: [step] },
            ]);
          } else {
            const stepsId = ss.stepsId;
            setEntries((prev) =>
              prev.map((entry) =>
                entry.id === stepsId
                  ? { ...entry, steps: [...(entry.steps ?? []), step] }
                  : entry
              )
            );
          }
        }
        return;
      }

      if ((eventType === "run-complete" || eventType === "run-error") && (ss.active || isStreaming)) {
        if (eventType === "run-error" && ss.active) {
          const errText = `Error: ${detail.error as string}`;
          if (ss.msgId) {
            const msgId = ss.msgId;
            setEntries((prev) =>
              prev.map((entry) =>
                entry.id === msgId && !entry.content
                  ? { ...entry, content: errText }
                  : entry
              )
            );
          } else {
            const errMsgId = crypto.randomUUID();
            setEntries((prev) => [
              ...prev,
              { id: errMsgId, kind: "message", role: "assistant", content: errText },
            ]);
          }
        }

        const finalStatus = eventType === "run-error" ? "error" : "completed";
        setEntries((prev) =>
          prev.map((entry) =>
            entry.kind === "steps" && !entry.runStatus
              ? { ...entry, runStatus: finalStatus }
              : entry
          )
        );

        serverStreamRef.current = { active: false, msgId: null, stepsId: null, lastKind: null };
        runIdRef.current = null;
        setIsStreaming(false);
        loadChat(id);
        return;
      }

      // Simple events (chat-created, chat-updated, chat-unread)
      if (!ss.active && !isStreaming) {
        loadChat(id);
      }
    }

    window.addEventListener("chat-server-event", onServerEvent);
    return () => {
      window.removeEventListener("chat-server-event", onServerEvent);
    };
  }, [currentChatId, isStreaming, loadChat, setIsStreaming, setEntries, runIdRef]);

  // ── handleSend ────────────────────────────────────────────────

  const handleSend = useCallback(async (userMessage: string, attachments?: UploadedFile[], skillId?: string, pluginId?: string) => {
    let activeChatId = currentChatId;

    const isFirstMessage = entries.length === 0;
    if (!activeChatId) {
      const chatRes = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: userMessage.slice(0, 50) }),
      });
      const newChat = await chatRes.json();
      activeChatId = newChat.id;
      setCurrentChatId(activeChatId);
      window.history.replaceState(null, "", `/chats/${activeChatId}`);
      // Notify chats list so it refreshes if currently mounted
      window.dispatchEvent(new Event("chat-list-changed"));
    }

    if (isFirstMessage && activeChatId) {
      const chatIdForTitle = activeChatId;
      const generateTitle = async (retries = 2) => {
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
            const res = await fetch(`/api/chats/${chatIdForTitle}/generate-title`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: userMessage }),
            });
            const data = await res.json();
            if (data.title) { setChatTitle(data.title); return; }
          } catch (err) {
            console.warn(`[titler] Attempt ${attempt + 1} failed:`, err);
          }
        }
      };
      generateTitle();
    }

    let displayContent = userMessage;
    if (attachments && attachments.length > 0) {
      const refs = attachments.map((a) =>
        a.mimeType.startsWith("image/")
          ? `![${a.filename}](/api/uploads/${a.uploadId}?filename=${encodeURIComponent(a.filename)})`
          : `[${a.filename}](/api/uploads/${a.uploadId}?filename=${encodeURIComponent(a.filename)})`
      );
      displayContent = [userMessage, ...refs].filter(Boolean).join("\n\n");
    }

    const userEntry: ChatEntry = {
      id: crypto.randomUUID(),
      kind: "message",
      role: "user",
      content: displayContent,
    };
    setEntries((prev) => [...prev, userEntry]);

    await fetch(`/api/chats/${activeChatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: displayContent }),
    });

    let objectiveId: string;
    if (activeObjectiveId && (activePhase === "discovery" || activePhase === "planning")) {
      objectiveId = activeObjectiveId;
    } else {
      const objRes = await fetch("/api/objectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: userMessage.slice(0, 100),
          description: userMessage,
        }),
      });
      const objective = await objRes.json();
      objectiveId = objective.id;
    }

    setIsStreaming(true);
    setActivityLabel("Thinking");
    const abortController = new AbortController();
    abortRef.current = abortController;

    let currentMsgId: string | null = null;
    let currentStepsId: string | null = null;
    let lastEntryKind: "message" | "steps" | null = null;
    let finalContent = "";

    try {
      const res = await fetch("/api/runs/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectiveId,
          chatId: activeChatId,
          attachments: attachments?.map((a) => ({
            uploadId: a.uploadId,
            filename: a.filename,
            mimeType: a.mimeType,
          })),
          skillId,
          pluginId,
        }),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Stream failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const eventMatch = block.match(/event: (\w+)/);
          const dataMatch = block.match(/data: ([\s\S]+)/);
          if (!eventMatch || !dataMatch) continue;

          const eventType = eventMatch[1];
          let eventData: Record<string, unknown>;
          try { eventData = JSON.parse(dataMatch[1]); } catch { continue; }

          if (eventType === "run_created") {
            runIdRef.current = eventData.runId as string;
          } else if (eventType === "delta") {
            const text = eventData.text as string;
            finalContent += text;
            setActivityLabel("Typing");

            if (lastEntryKind === "steps" || lastEntryKind === null) {
              currentMsgId = crypto.randomUUID();
              currentStepsId = null;
              lastEntryKind = "message";
              const newMsgId = currentMsgId;
              setEntries((prev) => [
                ...prev,
                { id: newMsgId, kind: "message", role: "assistant", content: text },
              ]);
            } else {
              const msgId = currentMsgId!;
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === msgId
                    ? { ...e, content: (e.content ?? "") + text }
                    : e
                )
              );
            }
          } else if (eventType === "step") {
            const step = eventData as unknown as StepData;

            if (STEP_LABEL_MAP[step.type]) setActivityLabel(STEP_LABEL_MAP[step.type]);
            if (step.type === "agent_handoff") {
              const handoff = step.content as Record<string, unknown>;
              if (handoff.agent === "image-generator") setActivityLabel("Generating image");
            }

            if (step.type === "routing") {
              const stepContent = step.content as Record<string, unknown>;
              const raw = stepContent.raw as string | undefined;
              if (raw) {
                try {
                  const parsed = JSON.parse(raw);
                  if (parsed.startPhase) {
                    setActiveObjectiveId(objectiveId);
                    setActivePhase(parsed.startPhase);
                  }
                } catch { /* ignore parse errors */ }
              }
            } else if (step.type === "phase") {
              const stepContent = step.content as Record<string, unknown>;
              const phase = stepContent.phase as string | undefined;
              if (phase) {
                setActiveObjectiveId(objectiveId);
                setActivePhase(phase);
              }
            } else if (step.type === "tool_result") {
              const stepContent = step.content as Record<string, unknown>;
              if (stepContent.name === "advance-phase") {
                const result = stepContent.result as Record<string, unknown> | undefined;
                if (result?.success) {
                  const output = result.output as Record<string, unknown>;
                  const newPhase = output.phase as string;
                  setActiveObjectiveId(objectiveId);
                  setActivePhase(newPhase);
                }
              }
              // Refresh skill list when agent creates/edits a skill
              const toolName = stepContent.name as string | undefined;
              if (toolName === "create-skill" || toolName === "edit-skill") {
                const result = stepContent.result as Record<string, unknown> | undefined;
                if (result?.success) {
                  queryClient.invalidateQueries({ queryKey: ["skills"] });
                }
              }
            }

            if (lastEntryKind !== "steps" || !currentStepsId) {
              currentStepsId = crypto.randomUUID();
              lastEntryKind = "steps";
              const newStepsId = currentStepsId;
              setEntries((prev) => [
                ...prev,
                { id: newStepsId, kind: "steps", steps: [step] },
              ]);
            } else {
              const stepsId = currentStepsId;
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === stepsId
                    ? { ...e, steps: [...(e.steps ?? []), step] }
                    : e
                )
              );
            }
          } else if (eventType === "artifacts") {
            const artifacts = eventData.artifacts as ArtifactInfo[];
            if (artifacts && artifacts.length > 0) {
              const artifactsId = crypto.randomUUID();
              setEntries((prev) => [
                ...prev,
                { id: artifactsId, kind: "artifacts", artifacts },
              ]);
            }
          } else if (eventType === "complete" || eventType === "error") {
            if (eventType === "error") {
              const errText = `Error: ${eventData.error as string}`;
              finalContent = finalContent || errText;
              if (currentMsgId) {
                const msgId = currentMsgId;
                setEntries((prev) =>
                  prev.map((e) =>
                    e.id === msgId && !e.content
                      ? { ...e, content: errText }
                      : e
                  )
                );
              } else {
                const errMsgId = crypto.randomUUID();
                setEntries((prev) => [
                  ...prev,
                  { id: errMsgId, kind: "message", role: "assistant", content: errText },
                ]);
              }
            }
            const finalStatus = eventType === "error" ? "error" : "completed";
            setEntries((prev) =>
              prev.map((e) =>
                e.kind === "steps" && !e.runStatus
                  ? { ...e, runStatus: finalStatus }
                  : e
              )
            );
            if (activeChatId) {
              if (mountedRef.current) {
                // User saw it live
              } else {
                fetch(`/api/chats/${activeChatId}/unread`, { method: "POST" })
                  .then(() => window.dispatchEvent(new Event("chat-unread")))
                  .catch(() => {});
              }
            }
            setIsStreaming(false);
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setEntries((prev) =>
          prev.map((e) =>
            e.kind === "steps" && !e.runStatus
              ? { ...e, runStatus: "cancelled" }
              : e
          )
        );
        setIsStreaming(false);
        abortRef.current = null;
        return;
      }
      const errText = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
      finalContent = finalContent || errText;
      if (currentMsgId) {
        const msgId = currentMsgId;
        setEntries((prev) =>
          prev.map((e) =>
            e.id === msgId && !e.content ? { ...e, content: errText } : e
          )
        );
      } else {
        const errMsgId = crypto.randomUUID();
        setEntries((prev) => [
          ...prev,
          { id: errMsgId, kind: "message", role: "assistant", content: errText },
        ]);
      }
      setEntries((prev) =>
        prev.map((e) =>
          e.kind === "steps" && !e.runStatus
            ? { ...e, runStatus: "error" }
            : e
        )
      );
      setIsStreaming(false);
    }

    abortRef.current = null;
    runIdRef.current = null;
  }, [currentChatId, entries.length, setEntries, setIsStreaming, runIdRef, mountedRef, activeObjectiveId, activePhase, setActiveObjectiveId, setActivePhase, setChatTitle, setCurrentChatId]);

  // ── handleStop ────────────────────────────────────────────────

  const handleStop = useCallback(() => {
    if (runIdRef.current) {
      fetch(`/api/runs/${runIdRef.current}/stop`, { method: "POST" }).catch(() => {});
    }
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current = null;
    setIsStreaming(false);

    setEntries((prev) =>
      prev.map((e) =>
        e.kind === "steps" && !e.runStatus
          ? { ...e, runStatus: "cancelled" }
          : e
      )
    );

    const cancelStepsId = crypto.randomUUID();
    setEntries((prev) => [
      ...prev,
      {
        id: cancelStepsId,
        kind: "steps",
        runStatus: "cancelled",
        steps: [{ type: "cancelled", content: { message: "Stopped by user" } }],
      },
    ]);
  }, [runIdRef, setIsStreaming, setEntries]);

  return { handleSend, handleStop, activityLabel };
}
