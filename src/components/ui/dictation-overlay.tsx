"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { X, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AudioWaveform } from "@/components/chat/audio-waveform";
import { insertAtLastFocus } from "@/lib/utils/text-insertion";
import { trackFocusTarget } from "@/lib/utils/focus-tracker";

type DictationState = "idle" | "waiting" | "tap_one" | "hold_recording" | "double_press_recording" | "transcribing" | "chat_hold" | "chat_double";

function normalizeKey(key: string): string {
  return key;
}

function shortcutMatches(pressed: Set<string>, keys: string[]): boolean {
  if (pressed.size !== keys.length) return false;
  return keys.every((k) => pressed.has(k));
}

function getRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return "audio/mp4";
}

const HOLD_THRESHOLD_MS = 150;
const DOUBLE_TAP_WINDOW_MS = 400;
const SILENCE_THRESHOLD = 0.05; // RMS peak below this = no speech detected

export function DictationOverlay() {
  const pathname = usePathname();
  const isChatPage = pathname?.startsWith("/chats/") ?? false;
  const isChatPageRef = useRef(isChatPage);
  useEffect(() => { isChatPageRef.current = isChatPage; }, [isChatPage]);

  const [state, setState] = useState<DictationState>("idle");
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  const lastFocusedRef = useRef<Element | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<DictationState>("idle");
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const shortcutKeysRef = useRef<string[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const peakRmsRef = useRef<number>(0);
  const rmsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep stateRef in sync
  useEffect(() => { stateRef.current = state; }, [state]);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      return res.json();
    },
  });

  const voiceEnabled = settings?.voice_input_enabled === "true";
  const hasOpenRouterKey = settings?.has_openrouter_key === "true";
  const hasOpenRouterKeyRef = useRef(hasOpenRouterKey);
  useEffect(() => { hasOpenRouterKeyRef.current = hasOpenRouterKey; }, [hasOpenRouterKey]);
  const shortcutSetting = settings?.voice_dictation_shortcut || "";
  const active = voiceEnabled && shortcutSetting.length > 0;

  // Keep shortcut ref in sync (avoids effect re-runs on every render)
  useEffect(() => {
    shortcutKeysRef.current = shortcutSetting ? shortcutSetting.split("+") : [];
  }, [shortcutSetting]);

  // Track focus
  useEffect(() => {
    return trackFocusTarget(lastFocusedRef);
  }, []);

  // ── Recording helpers ───────────────────────────────────

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicStream(stream);

      // Set up audio analysis for silence detection
      peakRmsRef.current = 0;
      const actx = new AudioContext();
      const source = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = actx;
      analyserRef.current = analyser;

      const dataArray = new Float32Array(analyser.fftSize);
      rmsIntervalRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
        const rms = Math.sqrt(sum / dataArray.length);
        if (rms > peakRmsRef.current) peakRmsRef.current = rms;
      }, 50);

      const mimeType = getRecordingMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
    } catch {
      toast.error("Microphone access denied");
      setState("idle");
    }
  }, []);

  const stopAndTranscribe = useCallback(async (cancelled: boolean) => {
    // Stop RMS sampling and audio context
    if (rmsIntervalRef.current) { clearInterval(rmsIntervalRef.current); rmsIntervalRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
    analyserRef.current = null;

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setState("idle");
      return;
    }

    const peakRms = peakRmsRef.current;
    const mimeType = recorder.mimeType;
    const blobPromise = new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const stream = mediaRecorderRef.current?.stream;
        stream?.getTracks().forEach((t) => t.stop());
        setMicStream(null);

        if (cancelled) {
          audioChunksRef.current = [];
          resolve(null);
          return;
        }

        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];
        resolve(blob.size > 0 ? blob : null);
      };
    });

    recorder.stop();
    const blob = await blobPromise;

    if (!blob || peakRms < SILENCE_THRESHOLD) {
      setState("idle");
      return;
    }

    setState("transcribing");
    try {
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const format = mimeType.split("/")[1].split(";")[0];

      if (!hasOpenRouterKeyRef.current) {
        window.dispatchEvent(new Event("open-openrouter-setup"));
        setState("idle");
        return;
      }

      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64, format }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.text) {
          if (!insertAtLastFocus(lastFocusedRef.current, data.text)) {
            toast.info("Click on a field first, then use voice input");
          }
        }
      } else {
        const err = await res.json().catch(() => ({ error: "Transcription failed" }));
        toast.error(err.error || "Transcription failed");
      }
    } catch (err) {
      console.error("[dictation] Transcription error:", err);
      toast.error("Transcription failed");
    } finally {
      setState("idle");
    }
  }, []);

  // Listen for composer signaling it's done (resets chat delegation states)
  useEffect(() => {
    function handleDone() {
      const s = stateRef.current;
      if (s === "chat_hold" || s === "chat_double") {
        setState("idle");
      }
    }
    window.addEventListener("dictation:done", handleDone);
    return () => window.removeEventListener("dictation:done", handleDone);
  }, []);

  // ── Global keyboard listener (stable — depends only on `active`) ──

  useEffect(() => {
    if (!active) return;

    function clearTimers() {
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
      if (tapTimerRef.current) { clearTimeout(tapTimerRef.current); tapTimerRef.current = null; }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.dataset?.dictationIgnore) return;
      // Ignore auto-repeat keydowns
      if (e.repeat) return;

      const key = normalizeKey(e.key);
      pressedKeysRef.current.add(key);

      if (!shortcutMatches(pressedKeysRef.current, shortcutKeysRef.current)) return;

      e.preventDefault();
      e.stopPropagation();

      const s = stateRef.current;

      if (s === "idle") {
        setState("waiting");
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;
          if (isChatPageRef.current) {
            setState("chat_hold");
            window.dispatchEvent(new CustomEvent("dictation:start"));
          } else {
            setState("hold_recording");
            startRecording();
          }
        }, HOLD_THRESHOLD_MS);
      } else if (s === "tap_one") {
        clearTimers();
        if (isChatPageRef.current) {
          setState("chat_double");
          window.dispatchEvent(new CustomEvent("dictation:start"));
        } else {
          setState("double_press_recording");
          startRecording();
        }
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      const key = normalizeKey(e.key);
      pressedKeysRef.current.delete(key);

      const s = stateRef.current;

      if (s === "waiting") {
        // Released before hold threshold → it was a tap
        clearTimers();
        setState("tap_one");
        tapTimerRef.current = setTimeout(() => {
          tapTimerRef.current = null;
          if (stateRef.current === "tap_one") {
            setState("idle");
          }
        }, DOUBLE_TAP_WINDOW_MS);
      } else if (s === "hold_recording") {
        stopAndTranscribe(false);
      } else if (s === "chat_hold") {
        window.dispatchEvent(new CustomEvent("dictation:stop"));
        setState("idle");
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      clearTimers();
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [active, startRecording, stopAndTranscribe]);

  if (!active) return null;

  const visible = state === "hold_recording" || state === "double_press_recording" || state === "transcribing";
  if (!visible) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center gap-1.5 rounded-full border border-border bg-card shadow-lg px-3 h-10">
        {state === "hold_recording" && (
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <div
              className="flex items-center overflow-hidden"
              style={{ animation: "slide-tray-in 300ms ease-out forwards" }}
            >
              <AudioWaveform stream={micStream} isRecording barCount={24} />
            </div>
          </div>
        )}

        {state === "double_press_recording" && (
          <>
            <button
              onClick={() => stopAndTranscribe(true)}
              className="flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <div
              className="flex items-center overflow-hidden"
              style={{ animation: "slide-tray-in 300ms ease-out forwards" }}
            >
              <AudioWaveform stream={micStream} isRecording barCount={24} />
            </div>
            <button
              onClick={() => stopAndTranscribe(false)}
              className="flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground hover:text-foreground transition-colors"
            >
              <Check className="h-4 w-4" />
            </button>
          </>
        )}

        {state === "transcribing" && (
          <div className="flex items-center gap-2 px-1">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Transcribing...</span>
          </div>
        )}
      </div>
    </div>
  );
}
