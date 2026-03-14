"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { User, Trash2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────

interface ContactPermissions {
  memoryAccess: boolean;
  webAccess: boolean;
  extensionAccess: boolean;
  pluginAccess: boolean;
  codeExecution: boolean;
  fileAccess: boolean;
  browserAccess: boolean;
  skillAccess: boolean;
}

interface ContactProfile {
  id: string;
  extensionId: string;
  externalId: string;
  name: string;
  enabled: boolean;
  isSelf: boolean;
  soulId: string | null;
  model: string | null;
  customSoul: string;
  instructions: string;
  responsePrefix: string;
  permissions: ContactPermissions;
}

interface ExtensionData {
  id: string;
  type: string;
  config: string;
}

function parsePhoneNumber(raw: string): string | null {
  try {
    return JSON.parse(raw).phoneNumber ?? null;
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────

export interface ContactInitialData {
  ext: ExtensionData | null;
  contact: ContactProfile | null;
  phoneNumber: string | null;
}

// ── Client Component ──────────────────────────────────────────

export function ContactDetailClient({
  contactId,
  initialData,
}: {
  contactId: string;
  initialData?: ContactInitialData;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [customPersonality, setCustomPersonality] = useState(false);

  const { data: contactData, isLoading: loading } = useQuery({
    queryKey: ["contact", contactId],
    queryFn: async () => {
      const extRes = await fetch("/api/extensions");
      const extensions: ExtensionData[] = await extRes.json();
      const wa = extensions.find((e) => e.type === "whatsapp");
      if (!wa) return { ext: null, contact: null, phoneNumber: null };

      const phoneNumber = parsePhoneNumber(wa.config);
      const contactRes = await fetch(
        `/api/extensions/${wa.id}/contacts/${contactId}`,
      );
      if (contactRes.ok) {
        const c: ContactProfile = await contactRes.json();
        return { ext: wa, contact: c, phoneNumber };
      }
      return { ext: wa, contact: null, phoneNumber };
    },
    ...(initialData ? { initialData } : {}),
  });

  const ext = contactData?.ext ?? null;
  const contact = contactData?.contact ?? null;
  const phoneNumber = contactData?.phoneNumber ?? null;

  const initializedRef = useRef(false);
  useEffect(() => {
    if (contact && !initializedRef.current) {
      initializedRef.current = true;
      setCustomPersonality(!!contact.customSoul);
    }
  }, [contact]);

  async function patch(data: Record<string, unknown>) {
    if (!ext || !contact) return;
    const res = await fetch(
      `/api/extensions/${ext.id}/contacts/${contact.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
      toast.success("Saved");
    }
  }

  async function handleDelete() {
    if (!ext || !contact) return;
    const res = await fetch(
      `/api/extensions/${ext.id}/contacts/${contact.id}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      toast.success("Contact removed");
      router.push("/channels/whatsapp");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/channels">Channels</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/channels/whatsapp">
                  WhatsApp
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Contact</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageHeader>
        <ScrollArea className="flex-1 overflow-hidden p-4">
          <div className="max-w-xl mx-auto space-y-6">
            {/* Header skeleton */}
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 rounded shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-3.5 w-28" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-14" />
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            </div>

            {/* Display Name skeleton */}
            <div className="rounded-lg border p-4 space-y-3">
              <Skeleton className="h-3.5 w-24" />
              <div className="relative">
                <Skeleton className="h-9 w-full rounded-md !bg-transparent border border-border" />
                <Skeleton className="h-3 w-28 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            {/* Soul skeleton */}
            <div className="rounded-lg border p-4 space-y-3">
              <Skeleton className="h-3.5 w-10" />
              <div className="space-y-1">
                <Skeleton className="h-3 w-[80%]" />
                <Skeleton className="h-3 w-[50%]" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-20 rounded-md" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </div>

            {/* Permissions skeleton */}
            <div className="rounded-lg border p-4 space-y-4">
              <Skeleton className="h-3.5 w-24" />
              <div className="space-y-1">
                <Skeleton className="h-3 w-[70%]" />
                <Skeleton className="h-3 w-[45%]" />
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="space-y-1 flex-1">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3 w-[60%]" />
                  </div>
                  <Skeleton className="h-5 w-9 rounded-full shrink-0" />
                </div>
              ))}
            </div>

            {/* Response Prefix skeleton */}
            <div className="rounded-lg border p-4 space-y-3">
              <Skeleton className="h-3.5 w-28" />
              <div className="space-y-1">
                <Skeleton className="h-3 w-[85%]" />
                <Skeleton className="h-3 w-[60%]" />
              </div>
              <div className="relative">
                <Skeleton className="h-9 w-full rounded-md !bg-transparent border border-border" />
                <Skeleton className="h-3 w-16 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/channels">Channels</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/channels/whatsapp">
                  WhatsApp
                </BreadcrumbLink>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageHeader>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Contact not found.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={
          !contact.isSelf ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove contact</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove{" "}
                    <span className="font-medium text-foreground">
                      {contact.name || contact.externalId}
                    </span>{" "}
                    and all their settings. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : undefined
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/channels">Channels</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/channels/whatsapp">
                WhatsApp
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {contact.name || contact.externalId}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="max-w-xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <User className={`h-5 w-5 ${contact.isSelf ? "text-amber-500" : "text-muted-foreground"}`} />
            <div className="flex-1">
              <h2 className="text-lg font-semibold">
                {contact.name || contact.externalId}
              </h2>
              <p className="text-sm text-muted-foreground">
                +{contact.isSelf && phoneNumber ? phoneNumber : contact.externalId}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {contact.enabled ? "Enabled" : "Disabled"}
              </span>
              <Switch
                checked={contact.enabled}
                onCheckedChange={(enabled) => patch({ enabled })}
              />
            </div>
          </div>

          {/* Display Name */}
          <div className="rounded-lg border p-4 space-y-3">
            <Label className="text-sm font-medium">Display Name</Label>
            <DeferredInput
              value={contact.name}
              onSave={(name) => patch({ name })}
              placeholder="Contact name"
            />
          </div>

          {/* Soul */}
          <div className="rounded-lg border p-4 space-y-3">
            <Label className="text-sm font-medium">Soul</Label>
            <p className="text-xs text-muted-foreground">
              Define how the agent behaves when responding to this contact.
              The default uses your system-wide soul.
            </p>
            <div className="flex gap-2">
              <Button
                variant={!customPersonality ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setCustomPersonality(false);
                  patch({ customSoul: "" });
                }}
              >
                Default
              </Button>
              <Button
                variant={customPersonality ? "default" : "outline"}
                size="sm"
                onClick={() => setCustomPersonality(true)}
              >
                Custom
              </Button>
            </div>
            {customPersonality && (
              <DeferredTextarea
                value={contact.customSoul}
                onSave={(customSoul) => patch({ customSoul })}
                placeholder="e.g. You are a professional assistant. Be formal, concise, and helpful. Always respond in English."
                rows={4}
                className="resize-none"
              />
            )}
          </div>

          {/* Permissions */}
          <div className="rounded-lg border p-4 space-y-4">
            <Label className="text-sm font-medium">Permissions</Label>
            <p className="text-xs text-muted-foreground">
              Control what the agent is allowed to do when responding to this
              contact.
            </p>

            <PermissionToggle
              label="Personal memory"
              description="Access your personal memory. When off, the agent uses a separate contact memory instead."
              checked={contact.permissions.memoryAccess}
              onChange={(v) =>
                patch({
                  permissions: { ...contact.permissions, memoryAccess: v },
                })
              }
            />

            <PermissionToggle
              label="Web access"
              description="Search the web and fetch URLs."
              checked={contact.permissions.webAccess}
              onChange={(v) =>
                patch({
                  permissions: { ...contact.permissions, webAccess: v },
                })
              }
            />

            <PermissionToggle
              label="Extensions"
              description="Use Brave Search, Zapier, and other integrations."
              checked={contact.permissions.extensionAccess}
              onChange={(v) =>
                patch({
                  permissions: { ...contact.permissions, extensionAccess: v },
                })
              }
            />

            <PermissionToggle
              label="Plugins"
              description="Create, edit, and run plugins."
              checked={contact.permissions.pluginAccess}
              onChange={(v) =>
                patch({
                  permissions: { ...contact.permissions, pluginAccess: v },
                })
              }
            />

            <PermissionToggle
              label="Code execution"
              description="Run code snippets."
              checked={contact.permissions.codeExecution}
              onChange={(v) =>
                patch({
                  permissions: { ...contact.permissions, codeExecution: v },
                })
              }
            />

            <PermissionToggle
              label="File access"
              description="Read, write, and download files."
              checked={contact.permissions.fileAccess}
              onChange={(v) =>
                patch({
                  permissions: { ...contact.permissions, fileAccess: v },
                })
              }
            />

            <PermissionToggle
              label="Browser"
              description="Automate Chrome for web interactions."
              checked={contact.permissions.browserAccess}
              onChange={(v) =>
                patch({
                  permissions: { ...contact.permissions, browserAccess: v },
                })
              }
            />

            <PermissionToggle
              label="Skills"
              description="Create, edit, and list reusable skills."
              checked={contact.permissions.skillAccess}
              onChange={(v) =>
                patch({
                  permissions: { ...contact.permissions, skillAccess: v },
                })
              }
            />
          </div>

          {/* Response Prefix */}
          <div className="rounded-lg border p-4 space-y-3">
            <Label className="text-sm font-medium">Response Prefix</Label>
            <p className="text-xs text-muted-foreground">
              Name shown in brackets before each reply (e.g. &quot;Kaizen&quot;
              becomes &quot;[Kaizen]&quot;) so the contact can distinguish AI
              responses.
            </p>
            <DeferredInput
              value={contact.responsePrefix}
              onSave={(responsePrefix) => patch({ responsePrefix })}
              placeholder="Kaizen"
            />
          </div>

          {/* Contact Memory — shown when personal memory access is off */}
          {!contact.permissions.memoryAccess && (
            <div className="rounded-lg border p-4 space-y-3">
              <Label className="text-sm font-medium">
                {contact.name && contact.name !== `+${contact.externalId}`
                  ? `${contact.name}'s Memory`
                  : "Contact Memory"}
              </Label>
              <p className="text-xs text-muted-foreground">
                What the agent knows about this contact. You can seed it
                manually, and the agent will also update it as it learns new
                things during conversations.
              </p>
              <DeferredTextarea
                value={contact.instructions}
                onSave={(instructions) => patch({ instructions })}
                placeholder="e.g. Prefers Spanish. Works on the marketing team. Interested in data visualization."
                rows={4}
                className="resize-none"
              />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── DeferredInput — edits locally, saves on blur ────────────────

function DeferredInput({
  value,
  onSave,
  ...props
}: { value: string; onSave: (v: string) => void } & Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "onBlur"
>) {
  const [local, setLocal] = useState(value);
  const prev = useRef(value);

  // Sync from server when value changes externally
  useEffect(() => {
    if (value !== prev.current) {
      setLocal(value);
      prev.current = value;
    }
  }, [value]);

  return (
    <Input
      {...props}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) {
          onSave(local);
          prev.current = local;
        }
      }}
    />
  );
}

function DeferredTextarea({
  value,
  onSave,
  ...props
}: { value: string; onSave: (v: string) => void } & Omit<
  React.ComponentProps<typeof Textarea>,
  "value" | "onChange" | "onBlur"
>) {
  const [local, setLocal] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    if (value !== prev.current) {
      setLocal(value);
      prev.current = value;
    }
  }, [value]);

  return (
    <Textarea
      {...props}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) {
          onSave(local);
          prev.current = local;
        }
      }}
    />
  );
}

// ── PermissionToggle ───────────────────────────────────────────

function PermissionToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        className="shrink-0"
      />
    </div>
  );
}
