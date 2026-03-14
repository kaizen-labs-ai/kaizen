"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mic, X, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AudioWaveform } from "@/components/chat/audio-waveform";
import { insertAtLastFocus } from "@/lib/utils/text-insertion";
import { trackFocusTarget } from "@/lib/utils/focus-tracker";

interface SpeechToTextProps {
  /** Optional override — if provided, called instead of auto-inserting at last caret. */
  onTranscribe?: (text: string) => void;
  className?: string;
}

export function SpeechToText({ onTranscribe, className }: SpeechToTextProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const lastFocusedRef = useRef<Element | null>(null);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      return res.json();
    },
  });

  // Track focus changes — capture the last focused input/textarea/editor
  useEffect(() => {
    return trackFocusTarget(lastFocusedRef);
  }, []);

  const voiceEnabled = settings?.voice_input_enabled === "true";

  if (!voiceEnabled) return null;

  function handleTranscribedText(text: string) {
    if (onTranscribe) {
      onTranscribe(text);
      return;
    }
    if (!insertAtLastFocus(lastFocusedRef.current, text)) {
      toast.info("Click on a field first, then use voice input");
    }
  }

  async function handleStart() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicStream(stream);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setMicStream(null);

        if (cancelledRef.current) {
          audioChunksRef.current = [];
          return;
        }

        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];

        if (blob.size === 0) return;

        setIsTranscribing(true);
        try {
          const buffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          const format = mimeType.split("/")[1].split(";")[0];

          const res = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: base64, format }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.text) {
              handleTranscribedText(data.text);
            }
          } else {
            const err = await res.json().catch(() => ({ error: "Transcription failed" }));
            toast.error(err.error || "Transcription failed");
          }
        } catch (err) {
          console.error("[voice] Transcription error:", err);
          toast.error("Transcription failed");
        } finally {
          setIsTranscribing(false);
        }
      };

      cancelledRef.current = false;
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      toast.error("Microphone access denied");
    }
  }

  function handleCancel() {
    cancelledRef.current = true;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecording(false);
  }

  function handleConfirm() {
    cancelledRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecording(false);
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 rounded-full border border-border bg-card shadow-lg px-2 h-9">
        {isRecording ? (
          <>
            <button
              onClick={handleCancel}
              className="flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <div
              className="flex items-center overflow-hidden"
              style={{ animation: "slide-tray-in 300ms ease-out forwards" }}
            >
              <AudioWaveform stream={micStream} isRecording={isRecording} barCount={18} />
            </div>
            <button
              onClick={handleConfirm}
              className="flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground hover:text-foreground transition-colors"
            >
              <Check className="h-4 w-4" />
            </button>
          </>
        ) : isTranscribing ? (
          <div className="flex items-center justify-center h-7 w-7">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <button
            onClick={handleStart}
            className="flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground hover:text-foreground transition-colors"
          >
            <Mic className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
