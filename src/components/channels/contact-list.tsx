"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Plus, User, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
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
  instructions: string;
  responsePrefix: string;
  permissions: ContactPermissions;
}

interface ContactListProps {
  extensionId: string;
  /** Channel type used for building the detail page URL (e.g. "whatsapp") */
  channelType: string;
  /** Phone number / ID shown under the self contact row */
  selfSubtitle?: string;
  /** Placeholder for the "add contact" input */
  addPlaceholder?: string;
  /** Pre-fetched contacts from SSR */
  initialData?: unknown[];
}

// ── Component ──────────────────────────────────────────────────

export function ContactList({
  extensionId,
  channelType,
  selfSubtitle,
  addPlaceholder = "Phone number (e.g. 14155551234)",
  initialData,
}: ContactListProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [newContactId, setNewContactId] = useState("");

  const { data: contacts = [], isLoading: loading } = useQuery<ContactProfile[]>({
    queryKey: ["contacts", extensionId],
    queryFn: async () => {
      const res = await fetch(`/api/extensions/${extensionId}/contacts`);
      if (res.ok) return res.json();
      return [];
    },
    ...(initialData ? { initialData: initialData as ContactProfile[] } : {}),
  });

  async function toggleEnabled(id: string, enabled: boolean) {
    const res = await fetch(`/api/extensions/${extensionId}/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["contacts", extensionId] });
      toast.success(enabled ? "Contact enabled" : "Contact disabled");
    }
  }

  async function addContact() {
    const cleaned = newContactId.replace(/\D/g, "");
    if (!cleaned) return;

    const res = await fetch(`/api/extensions/${extensionId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ externalId: cleaned, name: `+${cleaned}` }),
    });

    if (res.status === 409) {
      toast.error("Contact already exists");
      return;
    }
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["contacts", extensionId] });
      setNewContactId("");
      toast.success("Contact added");
    }
  }

  const selfContact = contacts.find((c) => c.isSelf);
  const otherContacts = contacts.filter((c) => !c.isSelf);
  const filtered = otherContacts.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.externalId.includes(search),
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="relative">
          <Skeleton className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 rounded" />
          <Skeleton className="h-9 w-full rounded-md !bg-transparent border border-border" />
          <Skeleton className="h-3 w-28 absolute left-9 top-1/2 -translate-y-1/2" />
        </div>
        <Skeleton className="h-3 w-20" />
        <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <Skeleton className="h-4 w-4 rounded shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-3.5 w-[35%]" />
                <Skeleton className="h-3 w-[25%]" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full shrink-0" />
              <Skeleton className="h-4 w-4 rounded shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contacts..."
          className="pl-9"
        />
      </div>

      {/* Count */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {filtered.length} contact{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Contact list — self always pinned at top */}
      <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
        {selfContact && (
          <ContactRow
            contact={selfContact}
            subtitle={selfSubtitle ? `+${selfSubtitle}` : undefined}
            onToggle={(enabled) => toggleEnabled(selfContact.id, enabled)}
            onClick={() =>
              router.push(`/channels/${channelType}/contacts/${selfContact.id}`)
            }
          />
        )}
        {filtered.map((contact) => (
          <ContactRow
            key={contact.id}
            contact={contact}
            onToggle={(enabled) => toggleEnabled(contact.id, enabled)}
            onClick={() =>
              router.push(`/channels/${channelType}/contacts/${contact.id}`)
            }
          />
        ))}
        {filtered.length === 0 && otherContacts.length === 0 && !selfContact && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No contacts yet. Add a phone number below.
          </div>
        )}
      </div>

      {/* Add contact */}
      <div className="flex gap-2">
        <Input
          placeholder={addPlaceholder}
          value={newContactId}
          onChange={(e) => setNewContactId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addContact();
          }}
        />
        <Button
          variant="outline"
          onClick={addContact}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ── ContactRow ─────────────────────────────────────────────────

function ContactRow({
  contact,
  subtitle,
  onToggle,
  onClick,
}: {
  contact: ContactProfile;
  subtitle?: string;
  onToggle: (enabled: boolean) => void;
  onClick: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <User className={`h-4 w-4 shrink-0 ${contact.isSelf ? "text-amber-500" : "text-muted-foreground"}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {contact.name || contact.externalId}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {subtitle ?? `+${contact.externalId}`}
        </p>
      </div>

      <Switch
        checked={contact.enabled}
        onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0"
      />

      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </div>
  );
}
