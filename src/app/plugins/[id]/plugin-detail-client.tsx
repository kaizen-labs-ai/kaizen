"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Trash2, Save, ExternalLink, Plus, X, Play,
  Undo2, Redo2, MessageSquareOff, IndentIncrease, IndentDecrease, WrapText, FolderOpen,
} from "lucide-react";
import Editor from "@monaco-editor/react";
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

export interface PluginDetail {
  id: string;
  name: string;
  description: string;
  language: string;
  scriptPath: string;
  absolutePath: string;
  timeout: number;
  dependencies: string[];
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
  scriptContent: string;
  inputSchema: {
    type: string;
    properties?: Record<string, { type?: string; description?: string; default?: unknown }>;
    required?: string[];
  } | null;
}

interface InputParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

function schemaToParams(schema: PluginDetail["inputSchema"]): InputParam[] {
  if (!schema?.properties) return [];
  return Object.entries(schema.properties).map(([name, prop]) => ({
    name,
    type: (prop.type ?? "string").toLowerCase(),
    description: prop.description ?? "",
    required: schema.required?.includes(name) ?? false,
  }));
}

function paramsToSchema(variables: InputParam[]): PluginDetail["inputSchema"] {
  if (variables.length === 0) return { type: "object", properties: {} };
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];
  for (const v of variables) {
    properties[v.name] = { type: v.type, description: v.description };
    if (v.required) required.push(v.name);
  }
  return { type: "object", properties, required: required.length > 0 ? required : undefined };
}

function getDependencyUrl(dep: string, language: string): string {
  switch (language) {
    case "python":
      return `https://pypi.org/project/${encodeURIComponent(dep)}`;
    case "ruby":
      return `https://rubygems.org/gems/${encodeURIComponent(dep)}`;
    default:
      return `https://www.npmjs.com/package/${encodeURIComponent(dep)}`;
  }
}

const MONACO_LANGUAGE_MAP: Record<string, string> = {
  python: "python",
  node: "javascript",
  bash: "shell",
  typescript: "typescript",
  ruby: "ruby",
};

export function PluginDetailClient({ initialData, id: pluginId }: { initialData: PluginDetail | null; id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [plugin, setPlugin] = useState<PluginDetail | null>(initialData);
  const [pluginName, setPluginName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [scriptContent, setScriptContent] = useState(initialData?.scriptContent ?? "");
  const [timeout, setTimeoutVal] = useState(initialData ? initialData.timeout / 1000 : 60);
  const [inputParams, setInputParams] = useState<InputParam[]>(initialData ? schemaToParams(initialData.inputSchema) : []);
  const [editingParam, setEditingParam] = useState<InputParam | null>(null);
  const [editingIndex, setEditingIndex] = useState<number>(-1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [deletePluginOpen, setDeletePluginOpen] = useState(false);
  const [deleteParamIndex, setDeleteParamIndex] = useState<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);

  const loadPlugin = useCallback(async () => {
    const res = await fetch(`/api/plugins/${pluginId}`);
    if (!res.ok) {
      router.push("/plugins");
      return;
    }
    const data = await res.json();
    setPlugin(data);
    setPluginName(data.name);
    setDescription(data.description);
    setScriptContent(data.scriptContent);
    setTimeoutVal(data.timeout / 1000);
    setInputParams(schemaToParams(data.inputSchema));
  }, [pluginId, router]);

  useEffect(() => {
    if (!initialData) loadPlugin();
  }, [loadPlugin]);

  async function handleSave() {
    await fetch(`/api/plugins/${pluginId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: pluginName, description, scriptContent, inputSchema: paramsToSchema(inputParams), timeout: timeout * 1000 }),
    });
    toast.success("Plugin updated");
    queryClient.invalidateQueries({ queryKey: ["plugins"] });
    loadPlugin();
  }

  async function handleToggle() {
    if (!plugin) return;
    await fetch(`/api/plugins/${pluginId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !plugin.enabled }),
    });
    toast.success(plugin.enabled ? "Plugin disabled" : "Plugin enabled");
    queryClient.invalidateQueries({ queryKey: ["plugins"] });
    loadPlugin();
  }

  async function handleDelete() {
    await fetch(`/api/plugins/${pluginId}`, { method: "DELETE" });
    toast.success("Plugin deleted");
    queryClient.invalidateQueries({ queryKey: ["plugins"] });
    router.push("/plugins");
  }

  function editorAction(id: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.trigger("toolbar", id, null);
  }

  if (!plugin) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const params = new URLSearchParams({ pluginId: plugin.id, pluginName: plugin.name });
                window.open(`/chats/new?${params.toString()}`, "_blank");
              }}
            >
              <Play className="mr-1 h-4 w-4" /> Run
            </Button>
            <Button variant="outline" size="sm" onClick={handleSave}>
              <Save className="mr-1 h-4 w-4" /> Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => setDeletePluginOpen(true)}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
          </>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/plugins">Plugins</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{plugin.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <div className="flex-1 overflow-hidden p-4">
        <div className="flex flex-row-reverse gap-6 h-full">
          {/* Right column — plugin details */}
          <div className="w-80 shrink-0 space-y-6 overflow-y-auto px-1 -mx-1">
            {/* Plugin Info */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">Properties</h3>
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {plugin.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <Switch
                    checked={plugin.enabled}
                    onCheckedChange={handleToggle}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={pluginName}
                  onChange={(e) => setPluginName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  className="min-h-[80px] resize-none text-sm"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Timeout (seconds)</Label>
                <Input
                  type="number"
                  min={1}
                  value={timeout}
                  onChange={(e) => setTimeoutVal(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Dependencies */}
            {plugin.dependencies.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="mb-2 text-sm font-medium">Dependencies</h3>
                  <div className="flex flex-wrap gap-2">
                    {plugin.dependencies.map((dep) => (
                      <a
                        key={dep}
                        href={getDependencyUrl(dep, plugin.language)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Badge
                          variant="outline"
                          className="gap-1 cursor-pointer hover:bg-accent transition-colors"
                        >
                          {dep}
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </Badge>
                      </a>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Parameters */}
            <Separator />
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Parameters</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setEditingParam({ name: "", type: "string", description: "", required: false });
                    setEditingIndex(-1);
                    setDialogKey((k) => k + 1);
                    setDialogOpen(true);
                  }}
                >
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              </div>
              {inputParams.length === 0 ? (
                <p className="text-xs text-muted-foreground">No parameters defined.</p>
              ) : (
                <div className="rounded-md border border-border divide-y divide-border">
                  {inputParams.map((v, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent/50 cursor-pointer transition-colors"
                      onClick={() => {
                        setEditingParam({ ...v });
                        setEditingIndex(i);
                        setDialogKey((k) => k + 1);
                        setDialogOpen(true);
                      }}
                    >
                      {v.required && (
                        <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                      )}
                      <span className="text-xs font-medium truncate">{v.name || "unnamed"}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                        {v.type}
                      </Badge>
                      <div className="flex-1" />
                      <button
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteParamIndex(i);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Edit Parameter Dialog */}
            <Dialog
              open={dialogOpen}
              onOpenChange={(open) => {
                setDialogOpen(open);
                if (!open) setTimeout(() => setEditingParam(null), 200);
              }}
            >
              <DialogContent key={dialogKey} className="sm:max-w-sm" onOpenAutoFocus={(e) => e.preventDefault()}>
                <DialogHeader>
                  <DialogTitle>
                    {editingIndex === -1 ? "Add Parameter" : "Edit Parameter"}
                  </DialogTitle>
                </DialogHeader>
                {editingParam && (
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        value={editingParam.name}
                        onChange={(e) =>
                          setEditingParam({ ...editingParam, name: e.target.value })
                        }
                        placeholder="e.g. url, topic, max_pages"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Select
                        value={editingParam.type}
                        onValueChange={(val) =>
                          setEditingParam({ ...editingParam, type: val })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="string">string</SelectItem>
                          <SelectItem value="number">number</SelectItem>
                          <SelectItem value="boolean">boolean</SelectItem>
                          <SelectItem value="object">object</SelectItem>
                          <SelectItem value="array">array</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Textarea
                        className="min-h-[80px] resize-none text-sm"
                        value={editingParam.description}
                        onChange={(e) =>
                          setEditingParam({ ...editingParam, description: e.target.value })
                        }
                        placeholder="What this parameter is used for"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="var-required"
                        checked={editingParam.required}
                        onCheckedChange={(checked) =>
                          setEditingParam({ ...editingParam, required: checked === true })
                        }
                      />
                      <Label htmlFor="var-required" className="cursor-pointer">
                        Required
                      </Label>
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!editingParam?.name.trim()) {
                        toast.error("Parameter name is required");
                        return;
                      }
                      setInputParams((prev) => {
                        if (editingIndex === -1) return [...prev, editingParam];
                        const updated = [...prev];
                        updated[editingIndex] = editingParam;
                        return updated;
                      });
                      setDialogOpen(false);
                    }}
                  >
                    {editingIndex === -1 ? "Add" : "Save"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* Left column — source code (fills remaining width) */}
          <div className="min-w-0 flex-1 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-medium">Source Code</h3>
              <Badge variant="outline">{plugin.language}</Badge>
              <span className="flex-1" />
              <div className="flex items-center gap-0.5">
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => editorAction("undo")}>
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => editorAction("redo")}>
                  <Redo2 className="h-3.5 w-3.5" />
                </button>
                <div className="w-px h-4 bg-border mx-1" />
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => editorAction("editor.action.commentLine")}>
                  <MessageSquareOff className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => editorAction("editor.action.indentLines")}>
                  <IndentIncrease className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => editorAction("editor.action.outdentLines")}>
                  <IndentDecrease className="h-3.5 w-3.5" />
                </button>
                <div className="w-px h-4 bg-border mx-1" />
                <button type="button" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={() => editorAction("editor.action.toggleWordWrap")}>
                  <WrapText className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title={plugin.absolutePath}
                  onClick={async () => {
                    const res = await fetch(`/api/plugins/${pluginId}/open-folder`, { method: "POST" });
                    if (res.ok) {
                      toast.success("Opened in file explorer");
                    } else {
                      toast.error("Failed to open folder");
                    }
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 rounded-md overflow-hidden border border-border bg-[#1e1e1e]">
              <Editor
                loading={null}
                language={MONACO_LANGUAGE_MAP[plugin.language] ?? "plaintext"}
                theme="vs-dark"
                value={scriptContent}
                onChange={(value) => setScriptContent(value ?? "")}
                onMount={(editor) => { editorRef.current = editor; }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbersMinChars: 3,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  renderLineHighlight: "none",
                  stickyScroll: { enabled: false },
                  padding: { top: 12 },
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Delete plugin confirmation */}
      <AlertDialog open={deletePluginOpen} onOpenChange={setDeletePluginOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete plugin</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{plugin.name}&quot; and its source files. This action cannot be undone.
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

      {/* Delete variable confirmation */}
      <AlertDialog open={deleteParamIndex !== null} onOpenChange={(open) => { if (!open) setDeleteParamIndex(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove parameter</AlertDialogTitle>
            <AlertDialogDescription>
              Remove &quot;{deleteParamIndex !== null ? inputParams[deleteParamIndex]?.name || "unnamed" : ""}&quot; from the parameters? You&apos;ll need to save for this to take effect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteParamIndex !== null) {
                  setInputParams((prev) => prev.filter((_, j) => j !== deleteParamIndex));
                }
                setDeleteParamIndex(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
