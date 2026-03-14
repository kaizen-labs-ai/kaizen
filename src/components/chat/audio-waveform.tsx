"use client";

import { useRef, useEffect } from "react";

interface AudioWaveformProps {
  stream: MediaStream | null;
  isRecording: boolean;
  barCount?: number;
  className?: string;
}

export function AudioWaveform({
  stream,
  isRecording,
  barCount = 28,
  className,
}: AudioWaveformProps) {
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!isRecording || !stream) return;

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    ctxRef.current = ctx;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const step = Math.max(1, Math.floor(data.length / barCount));

    let active = true;
    const tick = () => {
      if (!active) return;
      analyser.getByteFrequencyData(data);

      for (let i = 0; i < barCount; i++) {
        const el = barsRef.current[i];
        if (!el) continue;
        const val = data[Math.min(i * step, data.length - 1)] ?? 0;
        const scale = Math.max(0.05, val / 255);
        el.style.transform = `scaleY(${scale})`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      ctx.close();
    };
  }, [isRecording, stream, barCount]);

  return (
    <div
      className={`flex items-center justify-center gap-[2px] ${className ?? ""}`}
      style={{ height: 20 }}
    >
      {Array.from({ length: barCount }, (_, i) => (
        <div
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          className="w-[2px] rounded-full bg-primary/60"
          style={{
            height: "100%",
            transform: "scaleY(0.05)",
            transformOrigin: "center",
            transition: "transform 80ms ease-out",
          }}
        />
      ))}
    </div>
  );
}
