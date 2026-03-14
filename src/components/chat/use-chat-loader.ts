"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { ChatEntry, StepData, ChatApiResponse, ChatApiMessage } from "./chat-types";

// ── Chat loader hook ────────────────────────────────────────────
// Loads chat history and reconstructs the interleaved entry view.

/** Transform raw API messages into interleaved ChatEntry[] */
export function processChatMessages(messages: ChatApiMessage[]): ChatEntry[] {
  const loaded: ChatEntry[] = [];

  for (const m of messages) {
    if (m.role === "user") {
      loaded.push({ id: m.id, kind: "message", role: "user", content: m.content });
      continue;
    }

    const rawSteps = m.run?.steps;
    if (!rawSteps || rawSteps.length === 0) {
      loaded.push({ id: m.id, kind: "message", role: "assistant", content: m.content });
      continue;
    }

    let toolSteps: StepData[] = [];
    let idx = 0;
    let hasInterleaved = false;
    const loadedRunStatus = m.run?.status;

    const flushTools = () => {
      if (toolSteps.length > 0) {
        loaded.push({ id: `${m.id}-steps-${idx}`, kind: "steps", steps: [...toolSteps], runStatus: loadedRunStatus });
        idx++;
      }
      toolSteps = [];
    };

    const addTextBubble = (text: string) => {
      if (text.trim()) {
        loaded.push({ id: `${m.id}-msg-${idx}`, kind: "message", role: "assistant", content: text });
        idx++;
        hasInterleaved = true;
      }
    };

    for (const step of rawSteps) {
      let parsed: unknown;
      try { parsed = JSON.parse(step.content); } catch { parsed = step.content; }

      const stepData: StepData = {
        type: step.type,
        content: parsed,
        toolId: step.toolId,
        createdAt: step.createdAt,
      };

      if (step.type === "executor_summary") {
        const agent = typeof parsed === "object" && parsed !== null
          ? ((parsed as Record<string, unknown>).agent as string | undefined)
          : undefined;
        if (agent !== "planner") {
          const text = typeof parsed === "object" && parsed !== null
            ? ((parsed as Record<string, unknown>).text as string) ?? ""
            : "";
          toolSteps.push(stepData);
          flushTools();
          addTextBubble(text);
        } else {
          toolSteps.push(stepData);
        }
      } else {
        toolSteps.push(stepData);
      }
    }

    flushTools();

    if (!hasInterleaved && m.content && m.content.trim()) {
      loaded.push({ id: m.id, kind: "message", role: "assistant", content: m.content });
    }

    const runArtifacts = m.run?.artifacts;
    if (runArtifacts && runArtifacts.length > 0) {
      loaded.push({ id: `${m.id}-artifacts`, kind: "artifacts", artifacts: runArtifacts });
    }
  }

  return loaded;
}

export interface UseChatLoaderResult {
  loading: boolean;
  chatTitle: string;
  setChatTitle: (title: string) => void;
  loadChat: (id: string) => Promise<void>;
  currentChatId: string | null;
  setCurrentChatId: (id: string | null) => void;
  mountedRef: React.RefObject<boolean>;
  runIdRef: React.RefObject<string | null>;
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  setActivityLabel: (label: string) => void;
}

export function useChatLoader(
  chatId: string | undefined,
  setEntries: React.Dispatch<React.SetStateAction<ChatEntry[]>>,
  initialChatData?: ChatApiResponse,
  externalSetActiveObjectiveId?: (id: string | null) => void,
  externalSetActivePhase?: (phase: string | null) => void,
): UseChatLoaderResult {
  const [currentChatId, setCurrentChatId] = useState<string | null>(chatId ?? null);
  const [chatTitle, setChatTitle] = useState(initialChatData?.title ?? "");
  const [loading, setLoading] = useState(!!chatId && !initialChatData);
  const [isStreaming, setIsStreaming] = useState(false);
  const [, setActivityLabel_] = useState("Thinking");

  const mountedRef = useRef<boolean>(true);
  const runIdRef = useRef<string | null>(null);
  const loadingRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadChat = useCallback(async (id: string) => {
    if (loadingRef.current === id) return;
    loadingRef.current = id;
    try {
      const res = await fetch(`/api/chats/${id}`);
      if (!res.ok) return;
      const chat = await res.json() as ChatApiResponse;
      setChatTitle(chat.title);
      window.dispatchEvent(new Event("chat-read"));

      if (chat.activeRun && !runIdRef.current) {
        runIdRef.current = chat.activeRun.runId;
        setIsStreaming(true);
        setActivityLabel_(chat.activeRun.label);
      }

      setEntries(processChatMessages(chat.messages));

      const lastAssistantWithObj = [...chat.messages]
        .reverse()
        .find(
          (m) => m.role === "assistant" && m.objective?.id
        );

      if (lastAssistantWithObj?.objective) {
        const phase = lastAssistantWithObj.objective.phase;
        if (phase === "discovery" || phase === "planning") {
          externalSetActiveObjectiveId?.(lastAssistantWithObj.objective.id!);
          externalSetActivePhase?.(phase);
        } else {
          externalSetActiveObjectiveId?.(null);
          externalSetActivePhase?.(null);
        }
      }
    } finally {
      setLoading(false);
      loadingRef.current = null;
    }
  }, [setEntries, externalSetActiveObjectiveId, externalSetActivePhase]);

  // On mount: process initialChatData if provided, otherwise fetch
  useEffect(() => {
    if (chatId && initialChatData) {
      // SSR path — process pre-fetched data, skip network call
      setEntries(processChatMessages(initialChatData.messages));

      if (initialChatData.activeRun && !runIdRef.current) {
        runIdRef.current = initialChatData.activeRun.runId;
        setIsStreaming(true);
        setActivityLabel_(initialChatData.activeRun.label);
      }

      const lastAssistantWithObj = [...initialChatData.messages]
        .reverse()
        .find(
          (m) => m.role === "assistant" && m.objective?.id
        );

      if (lastAssistantWithObj?.objective) {
        const phase = lastAssistantWithObj.objective.phase;
        if (phase === "discovery" || phase === "planning") {
          externalSetActiveObjectiveId?.(lastAssistantWithObj.objective.id!);
          externalSetActivePhase?.(phase);
        } else {
          externalSetActiveObjectiveId?.(null);
          externalSetActivePhase?.(null);
        }
      }

      window.dispatchEvent(new Event("chat-read"));
    } else if (chatId) {
      loadChat(chatId);
    } else {
      // Navigated to /chats/new — reset to blank state
      setCurrentChatId(null);
      setChatTitle("");
      setEntries([]);
      setIsStreaming(false);
      runIdRef.current = null;
    }
  }, [chatId, loadChat, setEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    loading,
    chatTitle,
    setChatTitle,
    loadChat,
    currentChatId,
    setCurrentChatId,
    mountedRef,
    runIdRef,
    isStreaming,
    setIsStreaming,
    setActivityLabel: setActivityLabel_,
  };
}
