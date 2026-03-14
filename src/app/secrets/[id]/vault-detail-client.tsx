"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Loader2,
  RotateCw,
  Trash2,
  Lock,
  Ticket,
  UserRound,
  MapPin,
  FileText,
  Eye,
  EyeOff,
  Plus,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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
import { PageHeader } from "@/components/layout/page-header";
import { toast } from "sonner";

import type { VaultListItem } from "@/lib/vault/queries";

const CATEGORY_LABELS: Record<string, string> = {
  api_key: "API Key",
  token: "Token",
  password: "Password",
  login: "Login",
  address: "Address",
  other: "Other",
};

const CATEGORY_ICONS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  api_key: KeyRound,
  token: Ticket,
  password: Lock,
  login: UserRound,
  address: MapPin,
  other: FileText,
};

function PasswordInput({
  id,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-9"
      />
      <button
        type="button"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setShow(!show)}
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function VaultDetailClient({
  initialData,
}: {
  initialData: VaultListItem;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const Icon = CATEGORY_ICONS[initialData.category] ?? KeyRound;

  const { data: item } = useQuery<VaultListItem>({
    queryKey: ["vault", initialData.id],
    queryFn: async () => {
      const res = await fetch(`/api/vault/${initialData.id}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    initialData,
    staleTime: 0,
  });

  // Edit form state
  const [label, setLabel] = useState(item.label);
  const [authorizedDomains, setAuthorizedDomains] = useState<string[]>(
    item.authorizedDomains ? item.authorizedDomains.split(",").map((d) => d.trim()).filter(Boolean) : [],
  );
  const [description, setDescription] = useState(item.description ?? "");
  const [saving, setSaving] = useState(false);

  // Login fields
  const [username, setUsername] = useState(item.fields.username ?? "");

  // Address fields
  const [firstName, setFirstName] = useState(item.fields.first_name ?? item.fields.name ?? "");
  const [lastName, setLastName] = useState(item.fields.last_name ?? "");
  const [street, setStreet] = useState(item.fields.street ?? "");
  const [city, setCity] = useState(item.fields.city ?? "");
  const [addrState, setAddrState] = useState(item.fields.state ?? "");
  const [zip, setZip] = useState(item.fields.zip ?? "");
  const [country, setCountry] = useState(item.fields.country ?? "");
  const [phone, setPhone] = useState(item.fields.phone ?? "");

  // Rotate value state
  const [newValue, setNewValue] = useState("");
  const [rotating, setRotating] = useState(false);
  const [showRotate, setShowRotate] = useState(false);

  // Delete state
  const [deleting, setDeleting] = useState(false);

  const hasVaultSecret = item.category !== "address";

  const currentDomains = authorizedDomains.map((d) => d.trim()).filter(Boolean).join(", ");
  const initialDomains = item.authorizedDomains ?? "";
  const hasChanges =
    label.trim() !== item.label ||
    currentDomains !== initialDomains ||
    (description.trim() || "") !== (item.description ?? "") ||
    (item.category === "login" && (
      username.trim() !== (item.fields.username ?? "")
    )) ||
    (item.category === "address" && (
      firstName.trim() !== (item.fields.first_name ?? item.fields.name ?? "") ||
      lastName.trim() !== (item.fields.last_name ?? "") ||
      street.trim() !== (item.fields.street ?? "") ||
      city.trim() !== (item.fields.city ?? "") ||
      addrState.trim() !== (item.fields.state ?? "") ||
      zip.trim() !== (item.fields.zip ?? "") ||
      country.trim() !== (item.fields.country ?? "") ||
      phone.trim() !== (item.fields.phone ?? "")
    ));

  async function handleSave() {
    if (!label.trim()) { toast.error("Label is required"); return; }

    const body: Record<string, unknown> = {
      label: label.trim(),
      authorizedDomains: authorizedDomains.map((d) => d.trim()).filter(Boolean).join(", "),
      description: description.trim() || undefined,
    };

    if (item.category === "login") {
      body.fields = {
        username: username.trim(),
      };
    } else if (item.category === "address") {
      body.fields = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        ...(street.trim() && { street: street.trim() }),
        ...(city.trim() && { city: city.trim() }),
        ...(addrState.trim() && { state: addrState.trim() }),
        ...(zip.trim() && { zip: zip.trim() }),
        ...(country.trim() && { country: country.trim() }),
        ...(phone.trim() && { phone: phone.trim() }),
      };
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/vault/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Failed to update"); return; }
      toast.success("Saved");
      queryClient.invalidateQueries({ queryKey: ["vault", item.id] });
      queryClient.invalidateQueries({ queryKey: ["vault"] });
    } catch {
      toast.error("Failed to update");
    } finally {
      setSaving(false);
    }
  }

  async function handleRotate() {
    if (!newValue) { toast.error("Enter a new value"); return; }
    setRotating(true);
    try {
      const res = await fetch(`/api/vault/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: newValue }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Failed to rotate value"); return; }
      toast.success("Secret value rotated");
      setNewValue("");
      setShowRotate(false);
      queryClient.invalidateQueries({ queryKey: ["vault", item.id] });
      queryClient.invalidateQueries({ queryKey: ["vault"] });
    } catch {
      toast.error("Failed to rotate value");
    } finally {
      setRotating(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/vault/${item.id}`, { method: "DELETE" });
      if (!res.ok) { toast.error("Failed to delete"); return; }
      toast.success("Secret deleted");
      queryClient.invalidateQueries({ queryKey: ["vault"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      router.push("/secrets");
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/secrets">Secrets</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{item.label}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="mx-auto w-full max-w-xl space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold">{item.label}</h2>
              <p className="text-xs text-muted-foreground">
                Created {new Date(item.createdAt).toLocaleDateString()}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0">
              {CATEGORY_LABELS[item.category] ?? item.category}
            </Badge>
          </div>

          {/* Secret value section — only for types that have a vault secret */}
          {hasVaultSecret && (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {item.category === "login" ? "Encrypted Password" : "Encrypted Value"}
                </Label>
                <div className="flex items-center gap-2">
                  <code className="text-sm bg-muted px-2 py-1 rounded flex-1 truncate">
                    {item.hasValue ? item.hint : "Not set"}
                  </code>
                </div>
              </div>

              {!showRotate ? (
                <Button variant="outline" size="sm" onClick={() => setShowRotate(true)}>
                  <RotateCw className="h-3.5 w-3.5 mr-1" />
                  Rotate Value
                </Button>
              ) : (
                <div className="space-y-2 pt-1">
                  <Label htmlFor="new-value" className="text-xs">New Value</Label>
                  <div className="flex gap-2">
                    <PasswordInput
                      id="new-value"
                      placeholder="Paste new secret value..."
                      value={newValue}
                      onChange={setNewValue}
                    />
                    <Button size="sm" onClick={handleRotate} disabled={rotating}>
                      {rotating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowRotate(false); setNewValue(""); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Details section — type-specific fields */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Details</h3>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-label" className="text-xs">Label</Label>
                <Input id="edit-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} />
              </div>

              {/* Login-specific fields */}
              {item.category === "login" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-username" className="text-xs">Username / Email</Label>
                    <Input id="edit-username" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={200} />
                  </div>
                </>
              )}

              {/* Address-specific fields */}
              {item.category === "address" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-first-name" className="text-xs">First Name</Label>
                      <Input id="edit-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={50} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-last-name" className="text-xs">Last Name</Label>
                      <Input id="edit-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={50} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-street" className="text-xs">Street Address</Label>
                    <Input id="edit-street" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={200} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-city" className="text-xs">City</Label>
                      <Input id="edit-city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={100} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-state" className="text-xs">State / Region</Label>
                      <Input id="edit-state" value={addrState} onChange={(e) => setAddrState(e.target.value)} maxLength={100} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-zip" className="text-xs">ZIP / Postal Code</Label>
                      <Input id="edit-zip" value={zip} onChange={(e) => setZip(e.target.value)} maxLength={20} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-country" className="text-xs">Country</Label>
                      <Input id="edit-country" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={100} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-phone" className="text-xs">Phone</Label>
                    <Input id="edit-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
                  </div>
                </>
              )}

              {/* Authorized Domains — all types */}
              <div className="space-y-1.5">
                <Label className="text-xs">Authorized Domains</Label>
                <div className="space-y-1.5">
                  {(authorizedDomains.length === 0 ? [""] : authorizedDomains).map((domain, idx) => (
                    <div key={idx} className="relative">
                      <Input
                        placeholder="e.g. openai.com"
                        value={domain}
                        onChange={(e) => {
                          if (authorizedDomains.length === 0) {
                            setAuthorizedDomains([e.target.value]);
                          } else {
                            const next = [...authorizedDomains];
                            next[idx] = e.target.value;
                            setAuthorizedDomains(next);
                          }
                        }}
                        maxLength={200}
                        className="pr-8"
                      />
                      {(domain || idx > 0) && (
                        <button
                          type="button"
                          onClick={() => {
                            if (authorizedDomains.length <= 1) {
                              setAuthorizedDomains([]);
                            } else {
                              setAuthorizedDomains(authorizedDomains.filter((_, i) => i !== idx));
                            }
                          }}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAuthorizedDomains([...authorizedDomains, ""])}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    Add domain
                  </button>
                </div>
              </div>

              {/* Description — for other type */}
              {item.category === "other" && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-desc" className="text-xs">Description</Label>
                  <Textarea id="edit-desc" placeholder="Optional notes" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} />
                </div>
              )}
            </div>

            <Button onClick={handleSave} disabled={saving || !hasChanges} size="sm">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Saving
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>

          <Separator />

          {/* Danger zone */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-destructive">Danger Zone</h3>
            <p className="text-xs text-muted-foreground">
              Permanently remove this {item.category === "address" ? "address" : "secret"}. This action cannot be undone.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleting}>
                  {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete &ldquo;{item.label}&rdquo;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove this secret. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
