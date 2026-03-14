"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  Plus, Trash2, Shield, Save, Paperclip, X, Wrench, Search, CodeXml,
  Image, FileText, FileCode, FileSpreadsheet, Film, Music, FileArchive, File,
  Undo2, Redo2, Bold, Italic, Heading, Link2, WrapText, KeyRound, Play,
  GitBranch, Database, ChevronRight, Info,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import Editor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { toast } from "sonner";
import Link from "next/link";


interface Guardrail {
  id: string;
  rule: string;
  type: string;
  editableBy: string;
}

interface SkillTool {
  id: string;
  tool: { id: string; name: string; type: string };
}

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

interface DbTool {
  id: string;
  name: string;
  description: string;
  type: string;
}

interface SkillVaultEntry {
  id: string;
  vaultEntry: { id: string; label: string; category: string };
}

interface DbVaultEntry {
  id: string;
  label: string;
  category: string;
}

interface SubSkillEntry {
  id: string;
  childSkillId: string;
  position: number;
  role: string;
  childSkill: { id: string; name: string; description: string };
}

interface DbSkillListItem {
  id: string;
  name: string;
  description: string;
}

interface PendingSubSkill {
  childSkillId: string;
  position: number;
  role: string;
  childSkill: { id: string; name: string; description: string };
}

interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  modelPref: string | null;
  enabled: boolean;
  guardrails: Guardrail[];
  tools: SkillTool[];
  vaultEntries: SkillVaultEntry[];
  attachments: Attachment[];
  subSkills: SubSkillEntry[];
}

// Local-only types for create mode
interface PendingGuardrail {
  tempId: string;
  rule: string;
  type: string;
}

interface PendingFile {
  tempId: string;
  file: File;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toUpperCase() || "FILE";
}

function getFileIcon(mimeType: string) {
  const cls = "h-3 w-3 text-muted-foreground shrink-0";
  if (mimeType.startsWith("image/")) return <Image className={cls} />;
  if (mimeType.startsWith("video/")) return <Film className={cls} />;
  if (mimeType.startsWith("audio/")) return <Music className={cls} />;
  if (mimeType === "application/pdf") return <FileText className={cls} />;
  if (mimeType === "application/json" || mimeType === "text/csv" || mimeType.includes("spreadsheet") || mimeType.includes("excel"))
    return <FileSpreadsheet className={cls} />;
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("gzip") || mimeType.includes("archive") || mimeType.includes("compressed"))
    return <FileArchive className={cls} />;
  if (mimeType.startsWith("text/") || mimeType === "application/javascript" || mimeType === "application/typescript" || mimeType.includes("xml"))
    return <FileCode className={cls} />;
  return <File className={cls} />;
}

let tempCounter = 0;
function tempId() {
  return `temp-${++tempCounter}`;
}

const EMPTY_SKILL: Skill = {
  id: "", name: "", description: "", instructions: "", modelPref: null,
  enabled: true, guardrails: [], tools: [], vaultEntries: [], attachments: [], subSkills: [],
};

export function SkillDetailClient({ initialData, id: paramId }: { initialData: Skill | null; id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: dbInfo } = useQuery<{ hasDatabase: boolean; totalRows?: number }>({
    queryKey: ["skill-db-tables", paramId],
    queryFn: async () => {
      const res = await fetch(`/api/skills/${paramId}/db/tables`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: paramId !== "new",
    refetchOnWindowFocus: false,
  });

  const [isNew, setIsNew] = useState(paramId === "new");
  const [skillId, setSkillId] = useState(paramId === "new" ? null : paramId);
  const [skill, setSkill] = useState<Skill | null>(paramId === "new" ? EMPTY_SKILL : (initialData ?? null));
  const [form, setForm] = useState({
    name: initialData?.name ?? "",
    description: initialData?.description ?? "",
    instructions: initialData?.instructions ?? "",
  });
  const [newGuardrail, setNewGuardrail] = useState({ rule: "", type: "must" });
  const [deleteSkillOpen, setDeleteSkillOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<{ filename: string; sizeBytes: number }[]>([]);
  const toolsRef = useRef<string[]>([]);
  const pluginsRef = useRef<string[]>([]);
  const secretsRef = useRef<string[]>([]);
  const subSkillsRef = useRef<string[]>([]);
  const completionDisposableRef = useRef<{ dispose: () => void } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const decorationsRef = useRef<string[]>([]);

  // Pending state — buffered until save (both create and edit mode)
  const [pendingGuardrails, setPendingGuardrails] = useState<PendingGuardrail[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [pendingToolIds, setPendingToolIds] = useState<string[]>([]);
  // Edit mode: track deletions of existing DB records
  const [deletedGuardrailIds, setDeletedGuardrailIds] = useState<Set<string>>(new Set());
  const [deletedAttachmentIds, setDeletedAttachmentIds] = useState<Set<string>>(new Set());
  const [toolsDirty, setToolsDirty] = useState(false);

  // Tool picker dialog
  const [toolDialogOpen, setToolDialogOpen] = useState(false);
  const [allTools, setAllTools] = useState<DbTool[]>([]);
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set());
  const [toolSearch, setToolSearch] = useState("");

  // Plugin picker
  const [pluginDialogOpen, setPluginDialogOpen] = useState(false);
  const [allPlugins, setAllPlugins] = useState<DbTool[]>([]);
  const [selectedPluginIds, setSelectedPluginIds] = useState<Set<string>>(new Set());
  const [pluginSearch, setPluginSearch] = useState("");
  const [pendingPluginIds, setPendingPluginIds] = useState<string[]>([]);
  const [pluginsDirty, setPluginsDirty] = useState(false);

  // Secret picker
  const [secretDialogOpen, setSecretDialogOpen] = useState(false);
  const [allSecrets, setAllSecrets] = useState<DbVaultEntry[]>([]);
  const [selectedSecretIds, setSelectedSecretIds] = useState<Set<string>>(new Set());
  const [secretSearch, setSecretSearch] = useState("");
  const [pendingSecretIds, setPendingSecretIds] = useState<string[]>([]);
  const [secretsDirty, setSecretsDirty] = useState(false);

  // Sub-skills
  const [pendingSubSkills, setPendingSubSkills] = useState<PendingSubSkill[]>([]);
  const [subSkillsDirty, setSubSkillsDirty] = useState(false);
  const [subSkillDialogOpen, setSubSkillDialogOpen] = useState(false);
  const [allSkillsList, setAllSkillsList] = useState<DbSkillListItem[]>([]);
  const [subSkillSearch, setSubSkillSearch] = useState("");

  // Guardrail dialog
  const [guardrailDialogOpen, setGuardrailDialogOpen] = useState(false);
  const [editingGuardrail, setEditingGuardrail] = useState<{ id: string; rule: string; type: string } | null>(null);

  const loadSkill = useCallback(async (id?: string) => {
    const fetchId = id || skillId;
    if (!fetchId) return;
    const res = await fetch(`/api/skills/${fetchId}`);
    if (!res.ok) {
      router.push("/skills");
      return;
    }
    const data = await res.json();
    setSkill(data);
    setForm({
      name: data.name,
      description: data.description,
      instructions: data.instructions,
    });
    // Initialize sub-skills from loaded data
    if (data.subSkills) {
      setPendingSubSkills(
        [...data.subSkills]
          .sort((a: SubSkillEntry, b: SubSkillEntry) => a.position - b.position)
          .map((s: SubSkillEntry) => ({
            childSkillId: s.childSkillId,
            position: s.position,
            role: s.role,
            childSkill: s.childSkill,
          }))
      );
      setSubSkillsDirty(false);
    }
  }, [skillId, router]);

  useEffect(() => {
    if (!initialData) loadSkill();
  }, [loadSkill]);

  // Initialize sub-skills from initialData (server-side pre-fetch)
  useEffect(() => {
    if (initialData?.subSkills) {
      setPendingSubSkills(
        [...initialData.subSkills]
          .sort((a, b) => a.position - b.position)
          .map((s) => ({
            childSkillId: s.childSkillId,
            position: s.position,
            role: s.role,
            childSkill: s.childSkill,
          }))
      );
    }
  }, []);

  async function handleToggleEnabled(enabled: boolean) {
    if (!skillId) return;
    await fetch(`/api/skills/${skillId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    toast.success(enabled ? "Skill enabled" : "Skill disabled");
    queryClient.invalidateQueries({ queryKey: ["skills"] });
    loadSkill();
  }

  async function handleSave() {
    const missing: string[] = [];
    if (!form.name.trim()) missing.push("Name");
    if (!form.description.trim()) missing.push("Description");
    if (!form.instructions.trim()) missing.push("Instructions");
    if (missing.length > 0) {
      setValidationError(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required before saving.`);
      return;
    }

    if (isNew) {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          toolIds: [...pendingToolIds, ...pendingPluginIds],
          vaultEntryIds: pendingSecretIds,
          guardrails: pendingGuardrails.map((g) => ({ rule: g.rule, type: g.type })),
        }),
      });
      if (!res.ok) {
        toast.error("Failed to create skill");
        return;
      }
      const created = await res.json();

      // Upload buffered files
      for (const pf of pendingFiles) {
        const fd = new FormData();
        fd.append("file", pf.file);
        await fetch(`/api/skills/${created.id}/attachments`, { method: "POST", body: fd });
      }

      toast.success("Skill created");
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setPendingGuardrails([]);
      setPendingFiles([]);
      setSkillId(created.id);
      setIsNew(false);
      router.replace(`/skills/${created.id}`);
    } else {
      // Update skill metadata
      await fetch(`/api/skills/${skillId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      // Persist guardrail changes
      for (const id of deletedGuardrailIds) {
        await fetch(`/api/skills/${skillId}/guardrails?guardrailId=${id}`, { method: "DELETE" });
      }
      for (const g of pendingGuardrails) {
        await fetch(`/api/skills/${skillId}/guardrails`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rule: g.rule, type: g.type }),
        });
      }

      // Persist attachment changes
      for (const id of deletedAttachmentIds) {
        await fetch(`/api/skills/${skillId}/attachments?attachmentId=${id}`, { method: "DELETE" });
      }
      for (const pf of pendingFiles) {
        const fd = new FormData();
        fd.append("file", pf.file);
        await fetch(`/api/skills/${skillId}/attachments`, { method: "POST", body: fd });
      }

      // Persist tool changes (type-aware so plugins are preserved)
      if (toolsDirty) {
        await fetch(`/api/skills/${skillId}/tools`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolIds: pendingToolIds, toolType: "system" }),
        });
      }

      // Persist plugin changes (type-aware so tools are preserved)
      if (pluginsDirty) {
        await fetch(`/api/skills/${skillId}/tools`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolIds: pendingPluginIds, toolType: "plugin" }),
        });
      }

      // Persist secret changes
      if (secretsDirty) {
        await fetch(`/api/skills/${skillId}/secrets`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vaultEntryIds: pendingSecretIds }),
        });
      }

      // Persist sub-skill changes
      if (subSkillsDirty) {
        await fetch(`/api/skills/${skillId}/subskills`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subSkills: pendingSubSkills.map((s, i) => ({
              childSkillId: s.childSkillId,
              position: i,
              role: s.role,
            })),
          }),
        });
      }

      // Clear pending state
      setPendingGuardrails([]);
      setPendingFiles([]);
      setDeletedGuardrailIds(new Set());
      setDeletedAttachmentIds(new Set());
      setToolsDirty(false);
      setPluginsDirty(false);
      setSecretsDirty(false);
      setSubSkillsDirty(false);

      toast.success("Skill updated");
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      loadSkill();
    }
  }

  async function handleDelete() {
    if (!skillId) return;
    await fetch(`/api/skills/${skillId}`, { method: "DELETE" });
    toast.success("Skill deleted");
    queryClient.invalidateQueries({ queryKey: ["skills"] });
    router.push("/skills");
  }

  // ── Guardrails ────────────────────────────────────────

  function handleAddGuardrail() {
    if (!newGuardrail.rule) {
      toast.error("Rule is required");
      return;
    }
    setPendingGuardrails((prev) => [
      ...prev,
      { tempId: tempId(), rule: newGuardrail.rule, type: newGuardrail.type },
    ]);
    setNewGuardrail({ rule: "", type: "must" });
  }

  function handleDeleteGuardrail(id: string) {
    // Check if it's a pending (unsaved) guardrail
    if (pendingGuardrails.some((g) => g.tempId === id)) {
      setPendingGuardrails((prev) => prev.filter((g) => g.tempId !== id));
      return;
    }
    // Existing DB guardrail — mark for deletion on save
    setDeletedGuardrailIds((prev) => new Set(prev).add(id));
  }

  function handleEditGuardrail(g: { id: string; rule: string; type: string }) {
    setEditingGuardrail(g);
    setNewGuardrail({ rule: g.rule, type: g.type });
    setGuardrailDialogOpen(true);
  }

  function handleSaveGuardrailEdit() {
    if (!editingGuardrail || !newGuardrail.rule.trim()) return;
    const id = editingGuardrail.id;
    // Check if it's a pending guardrail
    if (pendingGuardrails.some((g) => g.tempId === id)) {
      setPendingGuardrails((prev) =>
        prev.map((g) => g.tempId === id ? { ...g, rule: newGuardrail.rule, type: newGuardrail.type } : g)
      );
    } else {
      // Existing DB guardrail — delete old + add as pending with new values
      setDeletedGuardrailIds((prev) => new Set(prev).add(id));
      setPendingGuardrails((prev) => [
        ...prev,
        { tempId: tempId(), rule: newGuardrail.rule, type: newGuardrail.type },
      ]);
    }
    setEditingGuardrail(null);
    setNewGuardrail({ rule: "", type: "must" });
    setGuardrailDialogOpen(false);
  }

  // ── Attachments ───────────────────────────────────────

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File too large (max 20MB)");
      e.target.value = "";
      return;
    }
    setPendingFiles((prev) => [...prev, { tempId: tempId(), file }]);
    e.target.value = "";
  }

  function handleDeleteAttachment(id: string) {
    // Check if it's a pending (unsaved) file
    if (pendingFiles.some((f) => f.tempId === id)) {
      setPendingFiles((prev) => prev.filter((f) => f.tempId !== id));
      return;
    }
    // Existing DB attachment — mark for deletion on save
    setDeletedAttachmentIds((prev) => new Set(prev).add(id));
  }

  // ── Tools ────────────────────────────────────────────

  async function openToolDialog() {
    if (allTools.length === 0) {
      const res = await fetch("/api/tools");
      if (res.ok) setAllTools(await res.json());
    }
    // Pre-select currently linked tools
    const currentIds = isNew || toolsDirty
      ? pendingToolIds
      : (skill?.tools.filter((st) => st.tool.type !== "plugin").map((st) => st.tool.id) ?? []);
    setSelectedToolIds(new Set(currentIds));
    setToolDialogOpen(true);
  }

  function handleSaveTools() {
    setPendingToolIds(Array.from(selectedToolIds));
    setToolsDirty(true);
    setToolDialogOpen(false);
  }

  function handleRemoveTool(toolId: string) {
    setPendingToolIds((prev) => prev.filter((id) => id !== toolId));
    setToolsDirty(true);
  }

  // ── Plugins ─────────────────────────────────────────

  async function openPluginDialog() {
    if (allPlugins.length === 0) {
      const res = await fetch("/api/plugins");
      if (res.ok) {
        const data = await res.json();
        setAllPlugins(data.map((p: { id: string; name: string; description: string }) => ({
          id: p.id, name: p.name, description: p.description, type: "plugin",
        })));
      }
    }
    const currentIds = isNew || pluginsDirty
      ? pendingPluginIds
      : (skill?.tools.filter((st) => st.tool.type === "plugin").map((st) => st.tool.id) ?? []);
    setSelectedPluginIds(new Set(currentIds));
    setPluginDialogOpen(true);
  }

  function handleSavePlugins() {
    setPendingPluginIds(Array.from(selectedPluginIds));
    setPluginsDirty(true);
    setPluginDialogOpen(false);
  }

  function handleRemovePlugin(pluginId: string) {
    setPendingPluginIds((prev) => prev.filter((id) => id !== pluginId));
    setPluginsDirty(true);
  }

  // ── Secrets ────────────────────────────────────────
  async function openSecretDialog() {
    if (allSecrets.length === 0) {
      const res = await fetch("/api/vault");
      if (res.ok) {
        const data = await res.json();
        setAllSecrets(data
          .filter((v: { category: string }) => v.category !== "system" && v.category !== "extension")
          .map((v: { id: string; label: string; category: string }) => ({
            id: v.id, label: v.label, category: v.category,
          })));
      }
    }
    const currentIds = isNew || secretsDirty
      ? pendingSecretIds
      : (skill?.vaultEntries?.map((sv) => sv.vaultEntry.id) ?? []);
    setSelectedSecretIds(new Set(currentIds));
    setSecretDialogOpen(true);
  }

  function handleSaveSecrets() {
    setPendingSecretIds(Array.from(selectedSecretIds));
    setSecretsDirty(true);
    setSecretDialogOpen(false);
  }

  function handleRemoveSecret(secretId: string) {
    setPendingSecretIds((prev) => prev.filter((id) => id !== secretId));
    setSecretsDirty(true);
  }

  // ── Sub-skills ──────────────────────────────────────

  async function openSubSkillDialog() {
    if (allSkillsList.length === 0) {
      const res = await fetch("/api/skills");
      if (res.ok) {
        const data = await res.json();
        setAllSkillsList(data.map((s: { id: string; name: string; description: string }) => ({
          id: s.id, name: s.name, description: s.description ?? "",
        })));
      }
    }
    setSubSkillDialogOpen(true);
  }

  function handleToggleSubSkill(s: DbSkillListItem) {
    setPendingSubSkills((prev) => {
      const exists = prev.some((ps) => ps.childSkillId === s.id);
      if (exists) {
        return prev.filter((ps) => ps.childSkillId !== s.id);
      }
      return [
        ...prev,
        {
          childSkillId: s.id,
          position: prev.length,
          role: "",
          childSkill: { id: s.id, name: s.name, description: s.description },
        },
      ];
    });
    setSubSkillsDirty(true);
  }

  function handleRemoveSubSkill(childSkillId: string) {
    setPendingSubSkills((prev) => prev.filter((s) => s.childSkillId !== childSkillId));
    setSubSkillsDirty(true);
  }

  // Unified view of linked tools
  const linkedTools = useMemo(() => {
    if (!skill) return [];
    if (isNew || toolsDirty) {
      return pendingToolIds.map((id) => {
        const t = allTools.find((tool) => tool.id === id);
        return t ? { id, name: t.name, type: t.type } : { id, name: id, type: "unknown" };
      });
    }
    return skill.tools.filter((st) => st.tool.type !== "plugin").map((st) => ({ id: st.tool.id, name: st.tool.name, type: st.tool.type }));
  }, [skill, isNew, toolsDirty, pendingToolIds, allTools]);

  const linkedPlugins = useMemo(() => {
    if (!skill) return [];
    if (isNew || pluginsDirty) {
      return pendingPluginIds.map((id) => {
        const p = allPlugins.find((pl) => pl.id === id);
        return p ? { id, name: p.name } : { id, name: id };
      });
    }
    return skill.tools.filter((st) => st.tool.type === "plugin").map((st) => ({ id: st.tool.id, name: st.tool.name }));
  }, [skill, isNew, pluginsDirty, pendingPluginIds, allPlugins]);

  const linkedSecrets = useMemo(() => {
    if (!skill) return [];
    if (isNew || secretsDirty) {
      return pendingSecretIds.map((id) => {
        const v = allSecrets.find((s) => s.id === id);
        return v ? { id, label: v.label, category: v.category } : { id, label: id, category: "other" };
      });
    }
    return skill.vaultEntries?.map((sv) => ({ id: sv.vaultEntry.id, label: sv.vaultEntry.label, category: sv.vaultEntry.category })) ?? [];
  }, [skill, isNew, secretsDirty, pendingSecretIds, allSecrets]);

  // Unified view data — merge server + pending state (must be above early return for ref sync)
  const guardrails = useMemo(() => {
    if (!skill) return [];
    const existing = isNew
      ? []
      : skill.guardrails
          .filter((g) => !deletedGuardrailIds.has(g.id))
          .map((g) => ({ id: g.id, rule: g.rule, type: g.type }));
    const pending = pendingGuardrails.map((g) => ({ id: g.tempId, rule: g.rule, type: g.type }));
    return [...existing, ...pending];
  }, [skill, isNew, pendingGuardrails, deletedGuardrailIds]);

  const attachments = useMemo(() => {
    if (!skill) return [];
    const existing = isNew
      ? []
      : skill.attachments.filter((a) => !deletedAttachmentIds.has(a.id));
    const pending = pendingFiles.map((pf) => ({
      id: pf.tempId,
      filename: pf.file.name,
      mimeType: pf.file.type || "application/octet-stream",
      sizeBytes: pf.file.size,
    }));
    return [...existing, ...pending];
  }, [skill, isNew, pendingFiles, deletedAttachmentIds]);

  // Keep refs in sync so the Monaco completion provider always sees current state
  useEffect(() => {
    attachmentsRef.current = attachments.map((a) => ({ filename: a.filename, sizeBytes: a.sizeBytes }));
    updateDecorations();
  }, [attachments]);

  useEffect(() => {
    toolsRef.current = linkedTools.map((t) => t.name);
    updateDecorations();
  }, [linkedTools]);

  useEffect(() => {
    pluginsRef.current = linkedPlugins.map((p) => p.name);
    updateDecorations();
  }, [linkedPlugins]);

  useEffect(() => {
    secretsRef.current = linkedSecrets.map((s) => s.label);
    updateDecorations();
  }, [linkedSecrets]);

  useEffect(() => {
    subSkillsRef.current = pendingSubSkills.map((s) => s.childSkill.name);
    updateDecorations();
  }, [pendingSubSkills]);

  // Scan editor content for @filename references and highlight them
  function updateDecorations() {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    const allNames = [
      ...attachmentsRef.current.map((a) => a.filename),
      ...toolsRef.current,
      ...pluginsRef.current,
      ...subSkillsRef.current,
      ...secretsRef.current,
    ];
    if (allNames.length === 0) {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      return;
    }

    // Build regex to match exact names (word-boundary safe via lookaround)
    const escaped = allNames.map((f: string) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(?<![\\w@])(${escaped.join("|")})(?!\\w)`, "g");
    const text = model.getValue();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newDecorations: any[] = [];

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const startPos = model.getPositionAt(match.index);
      const endPos = model.getPositionAt(match.index + match[0].length);
      newDecorations.push({
        range: {
          startLineNumber: startPos.lineNumber,
          startColumn: startPos.column,
          endLineNumber: endPos.lineNumber,
          endColumn: endPos.column,
        },
        options: { inlineClassName: "attachment-ref-highlight" },
      });
    }

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
  }

  // Monaco completion provider — suggests @filename on typing "@"
  const handleEditorMount = useCallback((_editor: unknown, monaco: Monaco) => {
    editorRef.current = _editor;

    completionDisposableRef.current?.dispose();
    completionDisposableRef.current = monaco.languages.registerCompletionItemProvider("markdown", {
      triggerCharacters: ["@"],
      provideCompletionItems(
        model: {
          getWordUntilPosition(pos: { lineNumber: number; column: number }): { startColumn: number; endColumn: number };
          getLineContent(lineNumber: number): string;
        },
        position: { lineNumber: number; column: number },
      ) {
        const wordInfo = model.getWordUntilPosition(position);
        const line = model.getLineContent(position.lineNumber);
        // Check if the character before the word is "@"
        const charBefore = wordInfo.startColumn > 1 ? line[wordInfo.startColumn - 2] : "";
        const hasAt = charBefore === "@";

        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: hasAt ? wordInfo.startColumn - 1 : wordInfo.startColumn,
          endColumn: position.column,
        };

        const suggestions = [
          ...attachmentsRef.current.map((a) => ({
            label: a.filename,
            kind: monaco.languages.CompletionItemKind.File,
            insertText: a.filename,
            filterText: hasAt ? "@" + a.filename : a.filename,
            range,
            detail: formatBytes(a.sizeBytes),
            documentation: "Reference this attachment in your instructions",
            sortText: "1_" + a.filename,
          })),
          ...toolsRef.current.map((name: string) => ({
            label: name,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: name,
            filterText: hasAt ? "@" + name : name,
            range,
            detail: "tool",
            documentation: "Reference this tool in your instructions",
            sortText: "2_" + name,
          })),
          ...pluginsRef.current.map((name: string) => ({
            label: name,
            kind: monaco.languages.CompletionItemKind.Module,
            insertText: name,
            filterText: hasAt ? "@" + name : name,
            range,
            detail: "plugin",
            documentation: "Reference this plugin in your instructions",
            sortText: "3_" + name,
          })),
          ...subSkillsRef.current.map((name: string) => ({
            label: name,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: name,
            filterText: hasAt ? "@" + name : name,
            range,
            detail: "sub-skill",
            documentation: "Reference this sub-skill in your instructions",
            sortText: "4_" + name,
          })),
          ...secretsRef.current.map((name: string) => ({
            label: name,
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: name,
            filterText: hasAt ? "@" + name : name,
            range,
            detail: "secret",
            documentation: "Reference this secret in your instructions",
            sortText: "5_" + name,
          })),
        ];

        return { suggestions };
      },
    });

    // Inject CSS for reference highlights (attachments, tools, plugins)
    const styleId = "attachment-ref-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `.attachment-ref-highlight { color: #58a6ff; font-weight: 500; }`;
      document.head.appendChild(style);
    }

    // Update decorations on every content change
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editorRef.current as any).onDidChangeModelContent(() => updateDecorations());

    // Initial decoration pass
    updateDecorations();
  }, []);

  // Cleanup completion provider on unmount
  useEffect(() => {
    return () => {
      completionDisposableRef.current?.dispose();
    };
  }, []);

  // ── Editor toolbar actions ──────────────────────────────
  function editorAction(id: string) {
    const editor = editorRef.current as any;
    if (!editor) return;
    editor.focus();
    editor.trigger("toolbar", id, null);
  }

  function wrapSelection(before: string, after: string) {
    const editor = editorRef.current as any;
    if (!editor) return;
    editor.focus();
    const sel = editor.getSelection();
    if (!sel) return;
    const model = editor.getModel();
    const selected = model.getValueInRange(sel);
    editor.executeEdits("toolbar", [{
      range: sel,
      text: `${before}${selected}${after}`,
    }]);
  }

  function insertPrefix(prefix: string) {
    const editor = editorRef.current as any;
    if (!editor) return;
    editor.focus();
    const pos = editor.getPosition();
    if (!pos) return;
    const model = editor.getModel();
    const line = model.getLineContent(pos.lineNumber);
    if (line.startsWith(prefix)) {
      // Toggle off — remove prefix
      editor.executeEdits("toolbar", [{
        range: { startLineNumber: pos.lineNumber, startColumn: 1, endLineNumber: pos.lineNumber, endColumn: prefix.length + 1 },
        text: "",
      }]);
    } else {
      editor.executeEdits("toolbar", [{
        range: { startLineNumber: pos.lineNumber, startColumn: 1, endLineNumber: pos.lineNumber, endColumn: 1 },
        text: prefix,
      }]);
    }
  }

  if (!skill) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={
          <>
            {isNew && (
              <Button variant="outline" size="sm" onClick={() => router.push("/skills")}>
                Cancel
              </Button>
            )}
            {!isNew && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const params = new URLSearchParams({ skillId: skill.id, skillName: skill.name });
                  window.open(`/chats/new?${params.toString()}`, "_blank");
                }}
              >
                <Play className="mr-1 h-4 w-4" /> Run
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleSave}>
              <Save className="mr-1 h-4 w-4" /> {isNew ? "Create" : "Save"}
            </Button>
            {!isNew && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={() => setDeleteSkillOpen(true)}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Delete
              </Button>
            )}
          </>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/skills">Skills</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{isNew ? "New Skill" : skill.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <div className="flex-1 overflow-hidden p-4">
        <div className="flex flex-row-reverse gap-6 h-full">
          {/* Right column — skill details sidebar */}
          <div className="w-80 shrink-0 space-y-6 overflow-y-auto px-1 -mx-1">
            {/* Configuration header + enabled toggle */}
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Properties</h3>
              {!isNew && (
                <>
                  <div className="flex-1" />
                  <span className="text-xs text-muted-foreground">
                    {skill.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={handleToggleEnabled}
                  />
                </>
              )}
            </div>

            {/* Name + Description */}
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Code Reviewer"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  className="min-h-[80px] resize-none text-sm"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Brief description of what this skill does"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Resources</h4>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                    <Info className="h-3 w-3" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="left" align="start" className="w-72 text-xs">
                  <p className="font-medium mb-1.5">How resources work</p>
                  <p className="text-muted-foreground leading-relaxed">
                    Resources linked here are <span className="text-foreground font-medium">informational hints</span> for the agent, not restrictions. When running this skill, the agent will see these as recommended tools but can still use any other available tool if needed.
                  </p>
                  <p className="text-muted-foreground leading-relaxed mt-1.5">
                    This preserves flexibility in the agentic flow while guiding the agent toward the most relevant resources.
                  </p>
                </PopoverContent>
              </Popover>
            </div>
            <Accordion type="single" collapsible className="w-full rounded-md border border-border overflow-hidden">
              {/* Sub-skills */}
              <AccordionItem value="sub-skills">
                <AccordionTrigger className="group py-2 px-2.5 gap-2 items-center hover:no-underline hover:bg-accent/50 [&[data-state=open]>svg:last-child]:hidden rounded-b-none rounded-t-md [&[data-state=open]]:border-b [&[data-state=open]]:border-border">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">Sub-skills</span>
                  </div>
                  {pendingSubSkills.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                      {pendingSubSkills.length}
                    </Badge>
                  )}
                  <Plus className="hidden group-data-[state=open]:block size-4 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer" onClick={(e) => { e.stopPropagation(); e.preventDefault(); openSubSkillDialog(); }} />
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  {pendingSubSkills.length > 0 ? (
                    <div className="divide-y divide-border">
                      {pendingSubSkills.map((s) => (
                        <div key={s.childSkillId} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent/50 transition-colors">
                          <span className="text-xs text-muted-foreground truncate">{s.childSkill.name}</span>
                          <div className="flex-1" />
                          <button className="text-muted-foreground hover:text-destructive transition-colors shrink-0" onClick={() => handleRemoveSubSkill(s.childSkillId)}>
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/60 text-center py-4">No sub-skills linked</p>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Tools */}
              <AccordionItem value="tools">
                <AccordionTrigger className="group py-2 px-2.5 gap-2 items-center hover:no-underline hover:bg-accent/50 [&[data-state=open]>svg:last-child]:hidden rounded-none [&[data-state=open]]:border-b [&[data-state=open]]:border-border">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">Tools</span>
                  </div>
                  {linkedTools.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                      {linkedTools.length}
                    </Badge>
                  )}
                  <Plus className="hidden group-data-[state=open]:block size-4 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer" onClick={(e) => { e.stopPropagation(); e.preventDefault(); openToolDialog(); }} />
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  {linkedTools.length > 0 ? (
                    <div className="divide-y divide-border">
                      {linkedTools.map((t) => (
                        <div key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent/50 transition-colors">
                          <span className="text-xs text-muted-foreground truncate">{t.name}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{t.type}</Badge>
                          <div className="flex-1" />
                          <button className="text-muted-foreground hover:text-destructive transition-colors shrink-0" onClick={() => handleRemoveTool(t.id)}>
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/60 text-center py-4">All tools available</p>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Plugins */}
              <AccordionItem value="plugins">
                <AccordionTrigger className="group py-2 px-2.5 gap-2 items-center hover:no-underline hover:bg-accent/50 [&[data-state=open]>svg:last-child]:hidden rounded-none [&[data-state=open]]:border-b [&[data-state=open]]:border-border">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <CodeXml className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">Plugins</span>
                  </div>
                  {linkedPlugins.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                      {linkedPlugins.length}
                    </Badge>
                  )}
                  <Plus className="hidden group-data-[state=open]:block size-4 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer" onClick={(e) => { e.stopPropagation(); e.preventDefault(); openPluginDialog(); }} />
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  {linkedPlugins.length > 0 ? (
                    <div className="divide-y divide-border">
                      {linkedPlugins.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent/50 transition-colors">
                          <span className="text-xs text-muted-foreground truncate">{p.name}</span>
                          <div className="flex-1" />
                          <button className="text-muted-foreground hover:text-destructive transition-colors shrink-0" onClick={() => handleRemovePlugin(p.id)}>
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/60 text-center py-4">All plugins available</p>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Secrets */}
              <AccordionItem value="secrets">
                <AccordionTrigger className="group py-2 px-2.5 gap-2 items-center hover:no-underline hover:bg-accent/50 [&[data-state=open]>svg:last-child]:hidden rounded-none [&[data-state=open]]:border-b [&[data-state=open]]:border-border">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">Secrets</span>
                  </div>
                  {linkedSecrets.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                      {linkedSecrets.length}
                    </Badge>
                  )}
                  <Plus className="hidden group-data-[state=open]:block size-4 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer" onClick={(e) => { e.stopPropagation(); e.preventDefault(); openSecretDialog(); }} />
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  {linkedSecrets.length > 0 ? (
                    <div className="divide-y divide-border">
                      {linkedSecrets.map((s) => (
                        <div key={s.id} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent/50 transition-colors">
                          <span className="text-xs text-muted-foreground truncate">{s.label}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{s.category}</Badge>
                          <div className="flex-1" />
                          <button className="text-muted-foreground hover:text-destructive transition-colors shrink-0" onClick={() => handleRemoveSecret(s.id)}>
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/60 text-center py-4">No secrets linked</p>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Attachments */}
              <AccordionItem value="attachments">
                <AccordionTrigger className="group py-2 px-2.5 gap-2 items-center hover:no-underline hover:bg-accent/50 [&[data-state=open]>svg:last-child]:hidden rounded-none [&[data-state=open]]:border-b [&[data-state=open]]:border-border">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">Attachments</span>
                    <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
                  </div>
                  {attachments.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                      {attachments.length}
                    </Badge>
                  )}
                  <Plus className="hidden group-data-[state=open]:block size-4 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer" onClick={(e) => { e.stopPropagation(); e.preventDefault(); fileInputRef.current?.click(); }} />
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  {attachments.length > 0 ? (
                    <div className="divide-y divide-border">
                      {attachments.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent/50 transition-colors cursor-pointer"
                          onClick={() => { if (!a.id.startsWith("temp_")) window.open(`/api/skills/${skillId}/attachments/${a.id}`, "_blank"); }}
                        >
                          <span className="text-xs text-muted-foreground truncate">{a.filename}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{getFileExtension(a.filename)}</Badge>
                          <span className="text-[10px] text-muted-foreground shrink-0">{formatBytes(a.sizeBytes)}</span>
                          <div className="flex-1" />
                          <button className="text-muted-foreground hover:text-destructive transition-colors shrink-0" onClick={(e) => { e.stopPropagation(); handleDeleteAttachment(a.id); }}>
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/60 text-center py-4">No attachments</p>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Guardrails */}
              <AccordionItem value="guardrails">
                <AccordionTrigger className="group py-2 px-2.5 gap-2 items-center hover:no-underline hover:bg-accent/50 [&[data-state=open]>svg:last-child]:hidden rounded-t-none rounded-b-md [&[data-state=open]]:rounded-b-none [&[data-state=open]]:border-b [&[data-state=open]]:border-border">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">Guardrails</span>
                  </div>
                  {guardrails.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                      {guardrails.length}
                    </Badge>
                  )}
                  <Plus className="hidden group-data-[state=open]:block size-4 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setGuardrailDialogOpen(true); }} />
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  {guardrails.length > 0 ? (
                    <div className="divide-y divide-border">
                      {guardrails.map((g) => (
                        <div key={g.id} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent/50 transition-colors cursor-pointer" onClick={() => handleEditGuardrail(g)}>
                          <span className="text-xs text-muted-foreground truncate">{g.rule}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{g.type}</Badge>
                          <div className="flex-1" />
                          <button className="text-muted-foreground hover:text-destructive transition-colors shrink-0" onClick={(e) => { e.stopPropagation(); handleDeleteGuardrail(g.id); }}>
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/60 text-center py-4">No guardrails defined</p>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Database — standalone link */}
            {!isNew && (
              <Link
                href={`/skills/${skill.id}/database`}
                className="flex items-center gap-2 mt-2 px-2.5 py-2 rounded-md border border-border hover:bg-accent/50 transition-colors cursor-pointer group"
              >
                <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">Database</span>
                <div className="flex-1" />
                {dbInfo?.hasDatabase ? (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {dbInfo.totalRows} rows
                  </Badge>
                ) : (
                  <span className="text-[10px] text-muted-foreground">No data</span>
                )}
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </Link>
            )}
          </div>

          {/* Left column — instructions editor */}
          <div className="min-w-0 flex-1 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-medium">Instructions</h3>
              <Badge variant="outline">markdown</Badge>
              <span className="flex-1" />
              <div className="flex items-center gap-0.5">
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => editorAction("undo")}>
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => editorAction("redo")}>
                  <Redo2 className="h-3.5 w-3.5" />
                </button>
                <div className="w-px h-4 bg-border mx-1" />
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => wrapSelection("**", "**")}>
                  <Bold className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => wrapSelection("_", "_")}>
                  <Italic className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => insertPrefix("## ")}>
                  <Heading className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => wrapSelection("[", "](url)")}>
                  <Link2 className="h-3.5 w-3.5" />
                </button>
                <div className="w-px h-4 bg-border mx-1" />
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => editorAction("editor.action.toggleWordWrap")}>
                  <WrapText className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="relative flex-1 min-h-0">
              <div className="absolute inset-0 rounded-md overflow-hidden border border-border bg-[#1e1e1e]">
                <Editor
                  loading={null}
                  language="markdown"
                  theme="vs-dark"
                  value={form.instructions}
                  onChange={(value) =>
                    setForm({ ...form, instructions: value ?? "" })
                  }
                  onMount={handleEditorMount}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbersMinChars: 3,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    renderLineHighlight: "none",
                    stickyScroll: { enabled: false },
                    padding: { top: 12 },
                    wordWrap: "on",
                  }}
                />
              </div>
              {!form.instructions && (
                <div className="absolute top-[14px] left-[52px] pointer-events-none text-muted-foreground/40 text-[13px] font-mono leading-[18px] whitespace-pre-line">
                  {`Write your instructions as simple steps.\nThe agent will figure out the rest.\n\nNever put passwords or sensitive data here.\nLink them as Secrets and reference by name instead.\n\nExample:\n1. Search for the latest news on the topic\n2. Summarise the key points\n3. Format as a bullet-point list`}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Validation error */}
      <AlertDialog open={!!validationError} onOpenChange={(open) => { if (!open) setValidationError(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Missing fields</AlertDialogTitle>
            <AlertDialogDescription>{validationError}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setValidationError(null)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete skill confirmation */}
      {!isNew && (
        <AlertDialog open={deleteSkillOpen} onOpenChange={setDeleteSkillOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete skill</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &quot;{skill.name}&quot; and all its
                guardrails, attachments, and any schedules linked to it. This
                action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDelete}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Tool picker dialog */}
      <Dialog open={toolDialogOpen} onOpenChange={(open) => { setToolDialogOpen(open); if (!open) setToolSearch(""); }}>
        <DialogContent className="max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle>Select Tools</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Restrict this skill to specific tools. Leave empty to let the system select tools automatically.
            </p>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tools..."
              value={toolSearch}
              onChange={(e) => setToolSearch(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <ScrollArea className="h-[360px] overflow-hidden">
            <div className="space-y-1 pr-3">
              {allTools
                .filter((tool) => {
                  if (!toolSearch.trim()) return true;
                  const q = toolSearch.toLowerCase();
                  return tool.name.toLowerCase().includes(q) || tool.description?.toLowerCase().includes(q);
                })
                .map((tool) => (
                  <label
                    key={tool.id}
                    className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedToolIds.has(tool.id)}
                      onCheckedChange={(checked) => {
                        setSelectedToolIds((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(tool.id);
                          else next.delete(tool.id);
                          return next;
                        });
                      }}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate max-w-[320px]">{tool.name}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                          {tool.type}
                        </Badge>
                      </div>
                      {tool.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 break-words">
                          {tool.description}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setToolDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveTools}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Plugin picker dialog */}
      <Dialog open={pluginDialogOpen} onOpenChange={(open) => { setPluginDialogOpen(open); if (!open) setPluginSearch(""); }}>
        <DialogContent className="max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle>Select Plugins</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Restrict this skill to specific plugins. Leave empty to let the system select plugins automatically.
            </p>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search plugins..."
              value={pluginSearch}
              onChange={(e) => setPluginSearch(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <ScrollArea className="h-[360px] overflow-hidden">
            <div className="space-y-1 pr-3">
              {allPlugins
                .filter((p) => {
                  if (!pluginSearch.trim()) return true;
                  const q = pluginSearch.toLowerCase();
                  return p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q);
                })
                .map((p) => (
                  <label
                    key={p.id}
                    className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedPluginIds.has(p.id)}
                      onCheckedChange={(checked) => {
                        setSelectedPluginIds((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(p.id);
                          else next.delete(p.id);
                          return next;
                        });
                      }}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium truncate block max-w-[320px]">{p.name}</span>
                      {p.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 break-words">
                          {p.description}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              {allPlugins.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">No plugins found.</p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPluginDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSavePlugins}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Secret picker dialog */}
      <Dialog open={secretDialogOpen} onOpenChange={(open) => { setSecretDialogOpen(open); if (!open) setSecretSearch(""); }}>
        <DialogContent className="max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle>Select Secrets</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Link secrets so the agent can access them during execution.
            </p>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search secrets..."
              value={secretSearch}
              onChange={(e) => setSecretSearch(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <ScrollArea className="h-[360px] overflow-hidden">
            <div className="space-y-1 pr-3">
              {allSecrets
                .filter((s) => {
                  if (!secretSearch.trim()) return true;
                  const q = secretSearch.toLowerCase();
                  return s.label.toLowerCase().includes(q) || s.category.toLowerCase().includes(q);
                })
                .map((s) => (
                  <label
                    key={s.id}
                    className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedSecretIds.has(s.id)}
                      onCheckedChange={(checked) => {
                        setSelectedSecretIds((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(s.id);
                          else next.delete(s.id);
                          return next;
                        });
                      }}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate max-w-[320px]">{s.label}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                          {s.category}
                        </Badge>
                      </div>
                    </div>
                  </label>
                ))}
              {allSecrets.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">No secrets found.</p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSecretDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveSecrets}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-skill picker dialog */}
      <Dialog open={subSkillDialogOpen} onOpenChange={(open) => { setSubSkillDialogOpen(open); if (!open) setSubSkillSearch(""); }}>
        <DialogContent className="max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle>Select Sub-skills</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Link other skills as sub-skills. Reference them in the instructions to compose workflows.
            </p>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search skills..."
              value={subSkillSearch}
              onChange={(e) => setSubSkillSearch(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <ScrollArea className="h-[360px] overflow-hidden">
            <div className="space-y-1 pr-3">
              {allSkillsList
                .filter((s) => {
                  if (s.id === (skillId ?? paramId)) return false;
                  if (!subSkillSearch.trim()) return true;
                  const q = subSkillSearch.toLowerCase();
                  return s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q);
                })
                .map((s) => (
                  <label
                    key={s.id}
                    className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={pendingSubSkills.some((ps) => ps.childSkillId === s.id)}
                      onCheckedChange={() => handleToggleSubSkill(s)}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium truncate block max-w-[320px]">{s.name}</span>
                      {s.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 break-words">
                          {s.description}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              {allSkillsList.filter((s) => {
                if (s.id === (skillId ?? paramId)) return false;
                if (!subSkillSearch.trim()) return true;
                const q = subSkillSearch.toLowerCase();
                return s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q);
              }).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">No available skills found.</p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSubSkillDialogOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Guardrail dialog */}
      <Dialog open={guardrailDialogOpen} onOpenChange={(open) => {
        setGuardrailDialogOpen(open);
        if (!open) { setEditingGuardrail(null); setNewGuardrail({ rule: "", type: "must" }); }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingGuardrail ? "Edit Guardrail" : "Add Guardrail"}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Define a safety rule for this skill.
            </p>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select
                value={newGuardrail.type}
                onValueChange={(v) => setNewGuardrail({ ...newGuardrail, type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="must">must</SelectItem>
                  <SelectItem value="must_not">must_not</SelectItem>
                  <SelectItem value="limit">limit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Rule</Label>
              <Input
                value={newGuardrail.rule}
                onChange={(e) => setNewGuardrail({ ...newGuardrail, rule: e.target.value })}
                placeholder="e.g. Always cite sources"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newGuardrail.rule.trim()) {
                    if (editingGuardrail) { handleSaveGuardrailEdit(); } else { handleAddGuardrail(); setGuardrailDialogOpen(false); }
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setGuardrailDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!newGuardrail.rule.trim()}
              onClick={() => {
                if (editingGuardrail) { handleSaveGuardrailEdit(); } else { handleAddGuardrail(); setGuardrailDialogOpen(false); }
              }}
            >
              {editingGuardrail ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
