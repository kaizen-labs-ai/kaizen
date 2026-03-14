"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Play, Pause } from "lucide-react";

interface AudioPlayerProps {
  src: string;
  className?: string;
}

const BAR_COUNT = 32;

/** Decode audio and sample amplitude peaks into `count` bars (0-1). */
async function extractWaveform(url: string, count: number): Promise<number[]> {
  try {
    const res = await fetch(url);
    const arrayBuf = await res.arrayBuffer();
    const ctx = new AudioContext();
    const audioBuf = await ctx.decodeAudioData(arrayBuf);
    const raw = audioBuf.getChannelData(0);
    const step = Math.floor(raw.length / count);
    const peaks: number[] = [];
    for (let i = 0; i < count; i++) {
      let max = 0;
      for (let j = i * step; j < (i + 1) * step && j < raw.length; j++) {
        const v = Math.abs(raw[j]);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    const ceiling = Math.max(...peaks, 0.01);
    await ctx.close();
    return peaks.map((p) => Math.max(0.08, p / ceiling));
  } catch {
    return Array.from({ length: count }, () => 0.15 + Math.random() * 0.85);
  }
}

export function AudioPlayer({ src, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const staticBarsRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0.08));
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);

  // Decode static waveform on mount
  useEffect(() => {
    extractWaveform(src, BAR_COUNT).then((peaks) => {
      staticBarsRef.current = peaks;
      for (let i = 0; i < BAR_COUNT; i++) {
        const el = barsRef.current[i];
        if (el) el.style.transform = `scaleY(${peaks[i]})`;
      }
    });
  }, [src]);

  // Listen for ended
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => { setPlaying(false); stopAnimation(); };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create AudioContext + AnalyserNode on first play (needs user gesture)
  const ensureAudioGraph = useCallback(() => {
    if (audioCtxRef.current || !audioRef.current) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audioRef.current);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
  }, []);

  const startAnimation = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const step = Math.max(1, Math.floor(data.length / BAR_COUNT));

    const tick = () => {
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < BAR_COUNT; i++) {
        const el = barsRef.current[i];
        if (!el) continue;
        const val = data[Math.min(i * step, data.length - 1)] ?? 0;
        const scale = Math.max(0.05, val / 255);
        el.style.transform = `scaleY(${scale})`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const stopAnimation = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    for (let i = 0; i < BAR_COUNT; i++) {
      const el = barsRef.current[i];
      if (el) el.style.transform = `scaleY(${staticBarsRef.current[i]})`;
    }
  }, []);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      stopAnimation();
      setPlaying(false);
    } else {
      ensureAudioGraph();
      const ctx = audioCtxRef.current;
      if (ctx?.state === "suspended") await ctx.resume();
      await audio.play();
      setPlaying(true);
      startAnimation();
    }
  }, [playing, ensureAudioGraph, startAnimation, stopAnimation]);

  // Cleanup
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      audioCtxRef.current?.close();
    };
  }, []);

  return (
    <div className={`flex items-center gap-2.5 rounded-lg bg-secondary/80 border border-border px-2.5 py-2 min-w-[150px] max-w-[220px] ${className ?? ""}`}>
      <audio ref={audioRef} src={src} preload="auto" crossOrigin="anonymous" />

      <button
        type="button"
        onClick={togglePlay}
        className="flex items-center justify-center h-8 w-8 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/80 transition-colors"
      >
        {playing
          ? <Pause className="h-4 w-4" />
          : <Play className="h-4 w-4 ml-0.5" />}
      </button>

      <div
        className="flex-1 min-w-0 flex items-center justify-center gap-[2px]"
        style={{ height: 24 }}
      >
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <div
            key={i}
            ref={(el) => { barsRef.current[i] = el; }}
            className={`w-[2px] rounded-full ${playing ? "bg-primary/60" : "bg-muted-foreground/30"}`}
            style={{
              height: "100%",
              transform: `scaleY(${staticBarsRef.current[i] ?? 0.08})`,
              transformOrigin: "center",
              transition: "transform 80ms ease-out",
            }}
          />
        ))}
      </div>
    </div>
  );
}
