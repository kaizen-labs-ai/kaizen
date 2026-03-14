"use client";

import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";

interface UseVoiceInputOptions {
  /** Called with transcribed text on success */
  onTranscript: (text: string) => void;
}

interface UseVoiceInputReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  toggleRecording: () => void;
}

/**
 * Lightweight voice-to-text hook.
 * Tap to start recording, tap again to stop & transcribe.
 * Reusable across chat input, plan proposal custom fields, etc.
 */
export function useVoiceInput({ onTranscript }: UseVoiceInputOptions): UseVoiceInputReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const peakRmsRef = useRef<number>(0);
  const rmsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // RMS sampling for silence detection
      peakRmsRef.current = 0;
      const actx = new AudioContext();
      const source = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = actx;

      const dataArray = new Float32Array(analyser.fftSize);
      rmsIntervalRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
        const rms = Math.sqrt(sum / dataArray.length);
        if (rms > peakRmsRef.current) peakRmsRef.current = rms;
      }, 50);

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
        if (rmsIntervalRef.current) { clearInterval(rmsIntervalRef.current); rmsIntervalRef.current = null; }
        if (audioContextRef.current) { audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }

        const peakRms = peakRmsRef.current;
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];

        if (blob.size === 0 || peakRms < 0.05) return;

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
            if (data.text) onTranscriptRef.current(data.text);
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

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      toast.error("Microphone access denied");
    }
  }, []);

  const stop = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stop();
    } else {
      start();
    }
  }, [isRecording, start, stop]);

  return { isRecording, isTranscribing, toggleRecording };
}
