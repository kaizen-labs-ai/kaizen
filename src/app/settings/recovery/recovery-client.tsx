"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Download,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileArchive,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface ImportResult {
  counts: Record<string, number>;
  warnings: string[];
}

const COUNT_LABELS: Record<string, string> = {
  agents: "Agents",
  tools: "Tools",
  skills: "Skills",
  souls: "Souls",
  extensions: "Extensions",
  contacts: "Contacts",
  mcpIntegrations: "MCP Integrations",
  vaultEntries: "Vault Entries",
  vaultSecrets: "Vault Secrets",
  settings: "Settings",
  userMemory: "User Memory",
  guardrails: "Guardrails",
  skillAttachments: "Attachments",
  files: "Files",
  chats: "Conversations",
  messages: "Messages",
  objectives: "Objectives",
  runs: "Runs",
  steps: "Steps",
  artifacts: "Artifacts",
  extensionChats: "Extension Chats",
};

export function RecoveryClient() {
  // ── Export state ──
  const [exportPassword, setExportPassword] = useState("");
  const [exportConfirm, setExportConfirm] = useState("");
  const [exporting, setExporting] = useState(false);
  const [showExportPw, setShowExportPw] = useState(false);

  // ── Import state ──
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showImportPw, setShowImportPw] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Export handlers ──
  const canExport =
    exportPassword.length >= 4 && exportPassword === exportConfirm && !exporting;

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/recovery/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: exportPassword }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Export failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ??
        `kaizen-backup-${new Date().toISOString().slice(0, 10)}.kaizen`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success("Backup exported successfully");
      setExportPassword("");
      setExportConfirm("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  }

  // ── Import handlers ──
  const canImport = importFile && importPassword.length >= 4 && !importing;

  async function handleImport() {
    if (!importFile) return;

    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("password", importPassword);

      const res = await fetch("/api/recovery/import", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Import failed");
      }

      setImportResult(result);
      toast.success("Backup imported successfully");
      setImportPassword("");
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Export Section ── */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Export Backup</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Download a backup file containing all your skills, tools, agents, settings,
            vault secrets, and other configuration. Vault secrets are encrypted with the
            password you provide.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="export-password" className="text-xs">
              Encryption Password
            </Label>
            <div className="relative">
              <Input
                id="export-password"
                type={showExportPw ? "text" : "password"}
                placeholder="Enter a password to encrypt the backup"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
                className="pr-9"
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowExportPw(!showExportPw)}
                tabIndex={-1}
              >
                {showExportPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="export-confirm" className="text-xs">
              Confirm Password
            </Label>
            <Input
              id="export-confirm"
              type={showExportPw ? "text" : "password"}
              placeholder="Confirm password"
              value={exportConfirm}
              onChange={(e) => setExportConfirm(e.target.value)}
            />
            {exportConfirm && exportPassword !== exportConfirm && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
          </div>

          <Button
            onClick={handleExport}
            disabled={!canExport}
            size="sm"
          >
            {exporting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            {exporting ? "Exporting..." : "Export Backup"}
          </Button>
        </div>
      </section>

      <Separator />

      {/* ── Import Section ── */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Import Backup</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Restore from a previously exported backup file. Existing records will be
            updated, new ones added. Nothing is deleted.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="import-file" className="text-xs">
              Backup File
            </Label>
            <Input
              id="import-file"
              ref={fileInputRef}
              type="file"
              accept=".kaizen"
              onChange={(e) => {
                setImportFile(e.target.files?.[0] ?? null);
                setImportResult(null);
              }}
              className="cursor-pointer"
            />
            {importFile && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileArchive className="h-3.5 w-3.5" />
                <span>{importFile.name}</span>
                <span>({(importFile.size / 1024).toFixed(1)} KB)</span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="import-password" className="text-xs">
              Backup Password
            </Label>
            <div className="relative">
              <Input
                id="import-password"
                type={showImportPw ? "text" : "password"}
                placeholder="Enter the password used during export"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
                className="pr-9"
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowImportPw(!showImportPw)}
                tabIndex={-1}
              >
                {showImportPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Importing will merge data with your current setup. Matching records
              will be overwritten. WhatsApp will need a server restart to
              reconnect.
            </p>
          </div>

          <Button
            onClick={handleImport}
            disabled={!canImport}
            size="sm"
          >
            {importing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-3.5 w-3.5" />
            )}
            {importing ? "Importing..." : "Import Backup"}
          </Button>
        </div>
      </section>

      {/* ── Import Results Dialog ── */}
      <Dialog
        open={!!importResult}
        onOpenChange={(open) => {
          if (!open) setImportResult(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Recovery Complete
            </DialogTitle>
            <DialogDescription>
              Your backup has been successfully imported. Below is a summary of
              what was restored.
            </DialogDescription>
          </DialogHeader>

          {importResult && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(importResult.counts).map(([key, count]) => (
                  <Badge key={key} variant="secondary" className="text-[10px]">
                    {count} {COUNT_LABELS[key] ?? key}
                  </Badge>
                ))}
              </div>

              {importResult.warnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-yellow-500">Warnings:</p>
                  {importResult.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      {w}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
                <RefreshCw className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  WhatsApp requires a server restart to reconnect. API-based
                  extensions (Zapier, etc.) will work immediately.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setImportResult(null);
              }}
            >
              Close
            </Button>
            <Button
              size="sm"
              onClick={() => {
                window.location.reload();
              }}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Reload Page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
