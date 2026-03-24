"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Send, Square, Plus, Paperclip, X, Mic, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { AudioWaveform } from "./audio-waveform";

export interface UploadedFile {
  uploadId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

interface ChatInputProps {
  onSend: (message: string, attachments?: UploadedFile[], skillId?: string, pluginId?: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  voiceEnabled?: boolean;
  initialSkill?: { id: string; name: string };
  initialPlugin?: { id: string; name: string };
}

/** Recursively extract text from editor DOM, replacing badge spans with their URLs */
function getEditorText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node instanceof HTMLElement) {
    if (node.dataset.skill) return `\x01${node.dataset.skill}\x02`; // delimited skill name for chat bubble styling
    if (node.dataset.plugin) return `\x04${node.dataset.plugin}\x05`; // delimited plugin name for chat bubble styling
    if (node.dataset.url) return node.dataset.url;
    if (node.tagName === "BR") return "\n";
    const text = Array.from(node.childNodes).map(getEditorText).join("");
    if (node.tagName === "DIV" || node.tagName === "P") return "\n" + text;
    return text;
  }
  return "";
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build an HTML string for a non-editable skill badge */
function skillBadgeHtml(name: string): string {
  return (
    `<span contenteditable="false" data-skill="${escapeHtml(name)}" style="color:#ce9178;font-weight:500;font-size:0.875rem">` +
    `${escapeHtml(name)}` +
    `</span>`
  );
}

/** Build an HTML string for a non-editable plugin badge */
function pluginBadgeHtml(name: string): string {
  return (
    `<span contenteditable="false" data-plugin="${escapeHtml(name)}" style="color:#ce9178;font-weight:500;font-size:0.875rem">` +
    `${escapeHtml(name)}` +
    `</span>`
  );
}

/** Build an HTML string for a non-editable link badge (uses <a> for native hover preview) */
function linkBadgeHtml(url: string): string {
  let display: string;
  try {
    display = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    display = url;
  }
  return (
    `<a contenteditable="false" data-url="${escapeHtml(url)}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors align-baseline mx-0.5 select-none cursor-pointer no-underline">` +
    `<span>${escapeHtml(display)}</span>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>` +
    `</a>`
  );
}

interface SkillOption {
  id: string;
  name: string;
  description: string;
}

interface PluginOption {
  id: string;
  name: string;
  description: string;
}

export function ChatInput({ onSend, onStop, isStreaming, disabled, voiceEnabled, initialSkill, initialPlugin }: ChatInputProps) {
  const [isEmpty, setIsEmpty] = useState(true);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const peakRmsRef = useRef<number>(0);
  const rmsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Slash command skill autocomplete ──────────────────
  const { data: skillsRaw = [] } = useQuery<SkillOption[]>({
    queryKey: ["skills"],
    queryFn: async () => {
      const res = await fetch("/api/skills");
      const data = await res.json();
      return data
        .filter((s: { enabled: boolean }) => s.enabled)
        .map((s: { id: string; name: string; description: string }) => ({
          id: s.id,
          name: s.name,
          description: s.description,
        }));
    },
  });
  const skills = useMemo(() => skillsRaw, [skillsRaw]);
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const [skillFilter, setSkillFilter] = useState("");
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [selectedSkill, setSelectedSkill] = useState<SkillOption | null>(null);
  const skillMenuRef = useRef<HTMLDivElement>(null);

  // ── Star command plugin autocomplete ──────────────────
  const { data: pluginsRaw = [] } = useQuery<PluginOption[]>({
    queryKey: ["plugins"],
    queryFn: async () => {
      const res = await fetch("/api/plugins");
      const data = await res.json();
      return data
        .filter((p: { enabled: boolean }) => p.enabled)
        .map((p: { id: string; name: string; description: string }) => ({
          id: p.id,
          name: p.name,
          description: p.description,
        }));
    },
  });
  const plugins = useMemo(() => pluginsRaw, [pluginsRaw]);
  const [showPluginMenu, setShowPluginMenu] = useState(false);
  const [pluginFilter, setPluginFilter] = useState("");
  const [selectedPluginIndex, setSelectedPluginIndex] = useState(0);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginOption | null>(null);
  const pluginMenuRef = useRef<HTMLDivElement>(null);

  // Pre-select skill when opened from skill page "Run" button
  const initialSkillApplied = useRef(false);
  useEffect(() => {
    if (!initialSkill || initialSkillApplied.current) return;
    const el = editorRef.current;
    if (!el) return;
    initialSkillApplied.current = true;
    el.innerHTML = skillBadgeHtml(initialSkill.name) + "&nbsp;";
    setSelectedSkill({ id: initialSkill.id, name: initialSkill.name, description: "" });
    setIsEmpty(false);
    // Focus and move caret to end
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [initialSkill]);

  // Pre-select plugin when opened from plugin page "Run" button
  const initialPluginApplied = useRef(false);
  useEffect(() => {
    if (!initialPlugin || initialPluginApplied.current) return;
    const el = editorRef.current;
    if (!el) return;
    initialPluginApplied.current = true;
    el.innerHTML = pluginBadgeHtml(initialPlugin.name) + "&nbsp;";
    setSelectedPlugin({ id: initialPlugin.id, name: initialPlugin.name, description: "" });
    setIsEmpty(false);
    // Focus and move caret to end
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [initialPlugin]);

  function updateIsEmpty() {
    const el = editorRef.current;
    if (!el) { setIsEmpty(true); return; }
    const hasText = (el.textContent?.trim() || "") !== "";
    const hasBadges = el.querySelector("[data-url], [data-skill], [data-plugin]") !== null;
    setIsEmpty(!hasText && !hasBadges);
  }

  function handleSubmit() {
    if (showSkillMenu || showPluginMenu) return; // don't submit while menu is open
    const el = editorRef.current;
    const text = el ? getEditorText(el).trim() : "";
    const skillId = selectedSkill?.id;
    const pluginId = selectedPlugin?.id;
    const hasSkill = !!selectedSkill;
    const hasPlugin = !!selectedPlugin;
    if ((!text && !hasSkill && !hasPlugin && attachments.length === 0) || disabled || isStreaming) return;

    const displayText = text || (hasSkill ? `\x01${selectedSkill!.name}\x02` : hasPlugin ? `\x04${selectedPlugin!.name}\x05` : "(attached files)");

    onSend(displayText, attachments.length > 0 ? attachments : undefined, skillId, pluginId);
    if (el) el.innerHTML = "";
    setIsEmpty(true);
    setAttachments([]);
    setSelectedSkill(null);
    setSelectedPlugin(null);
    setShowSkillMenu(false);
    setShowPluginMenu(false);
    el?.focus();
  }

  // Compute filtered skills/plugins for the menus
  const filteredSkills = skills.filter((s) =>
    s.name.toLowerCase().includes(skillFilter.toLowerCase())
  );
  const filteredPlugins = plugins.filter((p) =>
    p.name.toLowerCase().includes(pluginFilter.toLowerCase())
  );

  /** Remove the trigger text (e.g. "*foo" or "/bar") from the editor's last text node,
   *  then append the badge HTML — preserving existing badge spans intact. */
  function replaceTriggerWithBadge(trigger: string, badgeHtml: string) {
    const el = editorRef.current;
    if (!el) return;

    // Walk text nodes in reverse to find the one containing the trigger
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let lastTextNode: Text | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) lastTextNode = node as Text;

    if (lastTextNode) {
      const idx = lastTextNode.textContent!.lastIndexOf(trigger);
      if (idx !== -1) {
        // Remove trigger text from the text node
        lastTextNode.textContent = lastTextNode.textContent!.slice(0, idx);
      }
    }

    // Append badge + trailing space using a temporary container
    const temp = document.createElement("span");
    temp.innerHTML = badgeHtml + "&nbsp;";
    while (temp.firstChild) el.appendChild(temp.firstChild);

    // Move caret to end
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function selectPlugin(plugin: PluginOption) {
    const el = editorRef.current;
    if (el) {
      const text = el.textContent || "";
      const starIdx = text.lastIndexOf("*");
      const trigger = starIdx !== -1 ? text.slice(starIdx) : "*";
      replaceTriggerWithBadge(trigger, pluginBadgeHtml(plugin.name));
    }
    setSelectedPlugin(plugin);
    setShowPluginMenu(false);
    setPluginFilter("");
    setSelectedPluginIndex(0);
    updateIsEmpty();
  }

  function selectSkill(skill: SkillOption) {
    const el = editorRef.current;
    if (el) {
      const text = el.textContent || "";
      const slashIdx = text.lastIndexOf("/");
      const trigger = slashIdx !== -1 ? text.slice(slashIdx) : "/";
      replaceTriggerWithBadge(trigger, skillBadgeHtml(skill.name));
    }
    setSelectedSkill(skill);
    setShowSkillMenu(false);
    setSkillFilter("");
    setSelectedSkillIndex(0);
    updateIsEmpty();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (showSkillMenu && filteredSkills.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSkillIndex((i) => {
          const next = Math.min(i + 1, filteredSkills.length - 1);
          skillMenuRef.current?.children[0]?.children[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSkillIndex((i) => {
          const next = Math.max(i - 1, 0);
          skillMenuRef.current?.children[0]?.children[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectSkill(filteredSkills[selectedSkillIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSkillMenu(false);
        return;
      }
    }

    if (showPluginMenu && filteredPlugins.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedPluginIndex((i) => {
          const next = Math.min(i + 1, filteredPlugins.length - 1);
          pluginMenuRef.current?.children[0]?.children[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedPluginIndex((i) => {
          const next = Math.max(i - 1, 0);
          pluginMenuRef.current?.children[0]?.children[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectPlugin(filteredPlugins[selectedPluginIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowPluginMenu(false);
        return;
      }
    }

    if (e.key === "Escape" && (showSkillMenu || showPluginMenu)) {
      e.preventDefault();
      setShowSkillMenu(false);
      setShowPluginMenu(false);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput() {
    updateIsEmpty();

    const el = editorRef.current;
    if (!el) return;
    const text = el.textContent || "";

    // Find the last "/" in the text and extract the word after it
    const slashIdx = text.lastIndexOf("/");
    if (slashIdx !== -1) {
      const afterSlash = text.slice(slashIdx + 1);
      // Only show menu if we're still typing the command (no space after it yet)
      if (!/\s/.test(afterSlash)) {
        setSkillFilter(afterSlash);
        setShowSkillMenu(true);
        setSelectedSkillIndex(0);
        setShowPluginMenu(false);
        return;
      }
    }

    // Find the last "*" in the text and extract the word after it
    const starIdx = text.lastIndexOf("*");
    if (starIdx !== -1) {
      const afterStar = text.slice(starIdx + 1);
      // Only show menu if we're still typing the command (no space after it yet)
      if (!/\s/.test(afterStar)) {
        setPluginFilter(afterStar);
        setShowPluginMenu(true);
        setSelectedPluginIndex(0);
        setShowSkillMenu(false);
        return;
      }
    }

    setShowSkillMenu(false);
    setSkillFilter("");
    setShowPluginMenu(false);
    setPluginFilter("");

    // If user deleted the skill badge, clear selection
    if (selectedSkill && !editorRef.current?.querySelector("[data-skill]")) {
      setSelectedSkill(null);
    }
    // If user deleted the plugin badge, clear selection
    if (selectedPlugin && !editorRef.current?.querySelector("[data-plugin]")) {
      setSelectedPlugin(null);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    // Handle image paste from clipboard (e.g. screenshots, copied images)
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (!file) return;
        const formData = new FormData();
        formData.append("file", file, file.name || "pasted-image.png");
        setUploading(true);
        fetch("/api/uploads", { method: "POST", body: formData })
          .then((res) => (res.ok ? res.json() : null))
          .then((data: UploadedFile | null) => {
            if (data) setAttachments((prev) => [...prev, data]);
          })
          .finally(() => setUploading(false));
        return;
      }
    }

    const pasted = e.clipboardData.getData("text/plain").trim();
    if (!pasted) return;

    e.preventDefault();

    // Split preserving whitespace tokens so we keep spacing intact
    const tokens = pasted.split(/(\s+)/);
    const hasUrl = tokens.some((t) => /^https?:\/\/\S+$/.test(t));

    if (!hasUrl) {
      // No URLs — plain text insert (uses undo stack)
      document.execCommand("insertText", false, pasted);
    } else {
      // Build HTML with inline badges — insertHTML respects Ctrl+Z undo
      let html = "";
      for (const token of tokens) {
        if (/^https?:\/\/\S+$/.test(token)) {
          html += linkBadgeHtml(token);
        } else {
          html += escapeHtml(token);
        }
      }
      // Append a space + invisible marker so we can place the caret at the end
      html += '&nbsp;<span data-caret></span>';
      document.execCommand("insertHTML", false, html);

      const el = editorRef.current;
      if (el) {
        const marker = el.querySelector("[data-caret]");
        if (marker) {
          const sel = window.getSelection();
          if (sel) {
            const r = document.createRange();
            r.setStartAfter(marker);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
          }
          marker.remove();
        }
      }
    }

    updateIsEmpty();
  }


  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/uploads", { method: "POST", body: formData });
        if (!res.ok) continue;

        const data: UploadedFile = await res.json();
        setAttachments((prev) => [...prev, data]);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment(uploadId: string) {
    setAttachments((prev) => prev.filter((a) => a.uploadId !== uploadId));
  }

  async function handleStartRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicStream(stream);

      // Set up RMS sampling for silence detection
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
        // Clean up RMS sampling
        if (rmsIntervalRef.current) { clearInterval(rmsIntervalRef.current); rmsIntervalRef.current = null; }
        if (audioContextRef.current) { audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }

        const peakRms = peakRmsRef.current;
        stream.getTracks().forEach((t) => t.stop());
        setMicStream(null);

        if (cancelledRef.current) {
          audioChunksRef.current = [];
          return;
        }

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
            if (data.text) {
              const el = editorRef.current;
              if (el) {
                const existing = el.textContent?.trim() || "";
                el.focus();
                document.execCommand("insertText", false, existing ? " " + data.text : data.text);
                updateIsEmpty();
              }
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

  function handleCancelRecording() {
    cancelledRef.current = true;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecording(false);
    window.dispatchEvent(new CustomEvent("dictation:done"));
  }

  function handleConfirmRecording() {
    cancelledRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecording(false);
    window.dispatchEvent(new CustomEvent("dictation:done"));
  }

  // Listen for global dictation shortcut events from DictationOverlay
  const startRef = useRef(handleStartRecording);
  const confirmRef = useRef(handleConfirmRecording);
  startRef.current = handleStartRecording;
  confirmRef.current = handleConfirmRecording;

  useEffect(() => {
    if (!voiceEnabled) return;

    const onStart = () => { startRef.current(); };
    const onStop = () => { confirmRef.current(); };

    window.addEventListener("dictation:start", onStart);
    window.addEventListener("dictation:stop", onStop);
    return () => {
      window.removeEventListener("dictation:start", onStart);
      window.removeEventListener("dictation:stop", onStop);
    };
  }, [voiceEnabled]);

  const hasContent = !isEmpty || attachments.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="rounded-2xl border border-border bg-card shadow-lg">
        {/* Editable input area */}
        <div className="relative">
          {isEmpty && (
            <span className="absolute left-4 top-3 text-sm text-muted-foreground pointer-events-none select-none">
              {isRecording ? "Listening..." : "Reply..."}
            </span>
          )}
          <div
            ref={editorRef}
            contentEditable={!disabled && !isStreaming && !isRecording}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onInput={handleInput}
            className="min-h-[44px] max-h-[200px] overflow-y-auto text-sm outline-none px-4 pt-3 pb-1 whitespace-pre-wrap break-words"
          />
        </div>

        {/* Slash command skill autocomplete */}
        {showSkillMenu && filteredSkills.length > 0 && (
          <div ref={skillMenuRef} className="border-t border-border">
            <div className="max-h-[160px] overflow-y-auto py-1">
              {filteredSkills.slice(0, 8).map((skill, i) => (
                <button
                  key={skill.id}
                  type="button"
                  className={`w-full px-4 py-1 text-left text-sm transition-colors ${
                    i === selectedSkillIndex ? "text-white" : "text-muted-foreground hover:text-white"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSkill(skill);
                  }}
                  onMouseEnter={() => setSelectedSkillIndex(i)}
                >
                  {skill.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Star command plugin autocomplete */}
        {showPluginMenu && filteredPlugins.length > 0 && (
          <div ref={pluginMenuRef} className="border-t border-border">
            <div className="max-h-[160px] overflow-y-auto py-1">
              {filteredPlugins.slice(0, 8).map((plugin, i) => (
                <button
                  key={plugin.id}
                  type="button"
                  className={`w-full px-4 py-1 text-left text-sm transition-colors ${
                    i === selectedPluginIndex ? "text-white" : "text-muted-foreground hover:text-white"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectPlugin(plugin);
                  }}
                  onMouseEnter={() => setSelectedPluginIndex(i)}
                >
                  {plugin.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Attachment preview strip */}
        {(attachments.length > 0 || uploading) && (
          <div className="flex flex-wrap gap-2 px-3 py-2">
            {attachments.map((a) =>
              a.mimeType.startsWith("image/") ? (
                <div key={a.uploadId} className="relative group">
                  <img
                    src={`/api/uploads/${a.uploadId}?filename=${encodeURIComponent(a.filename)}`}
                    alt={a.filename}
                    className="h-16 w-16 rounded-lg object-cover border border-border"
                  />
                  <button
                    onClick={() => removeAttachment(a.uploadId)}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-muted-foreground/70 hover:bg-muted-foreground text-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div
                  key={a.uploadId}
                  className="relative group flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs"
                >
                  <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate max-w-[120px]">{a.filename}</span>
                  <button
                    onClick={() => removeAttachment(a.uploadId)}
                    className="h-5 w-5 rounded-full bg-muted-foreground/70 hover:bg-muted-foreground text-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            )}
            {uploading && (
              <Skeleton className="h-16 w-16 rounded-lg" />
            )}
          </div>
        )}

        <div className="flex items-center justify-between px-3 pb-2">
          {/* Left: attachment button (hidden when recording) */}
          {/* Left: attachment button */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.csv,.json,.md,.xml,.html"
              onChange={handleFileSelect}
              className="hidden"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                  disabled={disabled || isStreaming || uploading}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="min-w-[200px]">
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="h-4 w-4 mr-2" />
                  Add files or photos
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Right: mic/waveform + send/stop */}
          <div className="flex items-center gap-1">
            {voiceEnabled && !isStreaming && (
              isRecording ? (
                <div className="flex items-center gap-1.5">
                  {/* Tray slides out from right to left */}
                  <div
                    className="flex items-center gap-1.5 overflow-hidden"
                    style={{ animation: "slide-tray-in 300ms ease-out forwards" }}
                  >
                    <Button
                      onClick={handleCancelRecording}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-white"
                      disabled={disabled}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <AudioWaveform stream={micStream} isRecording={isRecording} barCount={18} />
                  </div>
                  <Button
                    onClick={handleConfirmRecording}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-white"
                    disabled={disabled}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              ) : isTranscribing ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-muted-foreground"
                  disabled
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                </Button>
              ) : (
                <Button
                  onClick={handleStartRecording}
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                  disabled={disabled}
                >
                  <Mic className="h-4 w-4" />
                </Button>
              )
            )}

            {isStreaming ? (
              <Button
                onClick={onStop}
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0 rounded-lg border-muted-foreground/30 text-muted-foreground hover:bg-destructive hover:text-white hover:border-destructive"
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={disabled || !hasContent}
                size="icon"
                className="h-8 w-8 shrink-0 rounded-lg"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
