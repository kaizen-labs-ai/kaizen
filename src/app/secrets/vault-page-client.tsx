"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  KeyRound,
  Brain,
  Puzzle,
  Search,
  Plus,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Eye,
  EyeOff,
  Lock,
  Ticket,
  UserRound,
  MapPin,
  FileText,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/page-header";
import { toast } from "sonner";

import type { VaultListItem } from "@/lib/vault/queries";

// ── Type definitions ──────────────────────────────────────────────

interface SecretType {
  slug: string;
  label: string;
  description: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

const SECRET_TYPES: SecretType[] = [
  { slug: "api_key", label: "API Key", description: "Service API keys", icon: KeyRound },
  { slug: "token", label: "Token", description: "Auth tokens", icon: Ticket },
  { slug: "password", label: "Password", description: "Single password", icon: Lock },
  { slug: "login", label: "Login", description: "Email + password", icon: UserRound },
  { slug: "address", label: "Address", description: "Physical address", icon: MapPin },
  { slug: "other", label: "Other", description: "Custom secret", icon: FileText },
];

const CATEGORY_LABELS: Record<string, string> = {
  api_key: "API Key",
  token: "Token",
  password: "Password",
  login: "Login",
  address: "Address",
  system: "System",
  extension: "Extension",
  other: "Other",
};

const CATEGORY_ICONS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  api_key: KeyRound,
  token: Ticket,
  password: Lock,
  login: UserRound,
  address: MapPin,
  system: Brain,
  extension: Puzzle,
  other: FileText,
};

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat;
}

// ── Password input with eye toggle ───────────────────────────────

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

// ── List subtitle per type ────────────────────────────────────────

function itemSubtitle(item: VaultListItem): React.ReactNode {
  if (item.source === "extension") {
    return item.hasValue ? (
      <code className="text-[11px]">{item.hint}</code>
    ) : (
      <span className="italic">Not set</span>
    );
  }

  if (item.category === "login") {
    return item.fields.username ? item.fields.username : <span className="italic">No details</span>;
  }

  if (item.category === "address") {
    const parts: string[] = [];
    if (item.fields.name) parts.push(item.fields.name);
    if (item.fields.city) parts.push(item.fields.city);
    if (item.fields.country) parts.push(item.fields.country);
    return parts.length > 0 ? parts.join(", ") : <span className="italic">No details</span>;
  }

  // api_key, token, password, other
  return (
    <>
      {item.hasValue ? (
        <code className="text-[11px]">{item.hint}</code>
      ) : (
        <span className="italic">Not set</span>
      )}
      {item.authorizedDomains && (() => {
        const domains = item.authorizedDomains!.split(",").map((d) => d.trim()).filter(Boolean);
        if (domains.length === 0) return null;
        return (
          <span className="ml-2 text-muted-foreground/60">
            {domains[0]}
            {domains.length > 1 && <span className="ml-1 text-muted-foreground/40">+{domains.length - 1}</span>}
          </span>
        );
      })()}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────

export function VaultPageClient({
  initialData,
}: {
  initialData: VaultListItem[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Dialog two-step state
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // Shared form state
  const [label, setLabel] = useState("");
  const [authorizedDomains, setAuthorizedDomains] = useState<string[]>([]);
  const [secretValue, setSecretValue] = useState("");
  const [description, setDescription] = useState("");

  // Login fields
  const [username, setUsername] = useState("");

  // Address fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState("");
  const [phone, setPhone] = useState("");

  // Auto-open dialog when navigated with ?create
  useEffect(() => {
    if (searchParams.has("create")) {
      setDialogOpen(true);
      router.replace("/secrets", { scroll: false });
    }
  }, [searchParams, router]);

  const { data: items = [], isLoading } = useQuery<VaultListItem[]>({
    queryKey: ["vault"],
    queryFn: async () => {
      const res = await fetch("/api/vault");
      return res.json();
    },
    initialData,
    staleTime: 0,
  });

  const filtered = items.filter(
    (item) =>
      item.label.toLowerCase().includes(search.toLowerCase()) ||
      (item.authorizedDomains ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (item.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (item.fields.username ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (item.fields.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  function resetForm() {
    setStep("pick");
    setSelectedType(null);
    setLabel("");
    setAuthorizedDomains([]);
    setSecretValue("");
    setDescription("");
    setUsername("");
    setFirstName("");
    setLastName("");
    setStreet("");
    setCity("");
    setState("");
    setZip("");
    setCountry("");
    setPhone("");
  }

  function handleDialogChange(open: boolean) {
    setDialogOpen(open);
    if (!open) resetForm();
  }

  function handlePickType(slug: string) {
    setSelectedType(slug);
    setStep("form");
  }

  async function handleCreate() {
    if (!selectedType) return;

    // Build request based on type
    let value: string | undefined;
    let fields: Record<string, string> | undefined;
    let finalLabel = label.trim();

    if (selectedType === "login") {
      if (!username.trim()) { toast.error("Username or email is required"); return; }
      if (!secretValue) { toast.error("Password is required"); return; }
      value = secretValue;
      fields = {
        username: username.trim(),
      };
      if (!finalLabel) finalLabel = username.trim();
    } else if (selectedType === "address") {
      if (!firstName.trim()) { toast.error("First name is required"); return; }
      if (!lastName.trim()) { toast.error("Last name is required"); return; }
      fields = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        ...(street.trim() && { street: street.trim() }),
        ...(city.trim() && { city: city.trim() }),
        ...(state.trim() && { state: state.trim() }),
        ...(zip.trim() && { zip: zip.trim() }),
        ...(country.trim() && { country: country.trim() }),
        ...(phone.trim() && { phone: phone.trim() }),
      };
      if (!finalLabel) finalLabel = `${firstName.trim()} ${lastName.trim()}`;
    } else {
      // api_key, token, password, other
      if (!secretValue) { toast.error("Value is required"); return; }
      value = secretValue;
    }

    if (!finalLabel) { toast.error("Label is required"); return; }

    setCreating(true);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: finalLabel,
          value,
          category: selectedType,
          authorizedDomains: authorizedDomains.map((d) => d.trim()).filter(Boolean).join(", ") || undefined,
          description: description.trim() || undefined,
          fields,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create secret");
        return;
      }
      toast.success("Secret created");
      resetForm();
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["vault"] });
    } catch {
      toast.error("Failed to create secret");
    } finally {
      setCreating(false);
    }
  }

  function handleRowClick(item: VaultListItem) {
    if (item.source === "extension" && item.sourceLink) {
      router.push(item.sourceLink);
    } else if (item.source === "user") {
      router.push(`/secrets/${item.id}`);
    }
  }

  // ── Render type-specific form ───────────────────────────────────

  function renderForm() {
    if (!selectedType) return null;
    const typeInfo = SECRET_TYPES.find((t) => t.slug === selectedType);

    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep("pick")}
              className="text-muted-foreground hover:text-foreground transition-colors -ml-1"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            {typeInfo?.label ?? "New Secret"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Label — always present */}
          <div className="space-y-1.5">
            <Label htmlFor="v-label" className="text-xs">Label</Label>
            <Input
              id="v-label"
              placeholder={selectedType === "login" ? "e.g. GitHub Account" : selectedType === "address" ? "e.g. Home Address" : "e.g. OpenAI API Key"}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={100}
            />
          </div>

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

          {/* Type-specific fields */}
          {(selectedType === "api_key" || selectedType === "token" || selectedType === "password") && (
            <div className="space-y-1.5">
              <Label htmlFor="v-value" className="text-xs">
                {selectedType === "api_key" ? "API Key" : selectedType === "token" ? "Token" : "Password"}
              </Label>
              <PasswordInput
                id="v-value"
                placeholder={`Paste ${selectedType === "api_key" ? "API key" : selectedType === "token" ? "token" : "password"}...`}
                value={secretValue}
                onChange={setSecretValue}
              />
            </div>
          )}

          {selectedType === "login" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="v-username" className="text-xs">Username / Email</Label>
                <Input
                  id="v-username"
                  placeholder="e.g. john@example.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-password" className="text-xs">Password</Label>
                <PasswordInput
                  id="v-password"
                  placeholder="Enter password..."
                  value={secretValue}
                  onChange={setSecretValue}
                />
              </div>
            </>
          )}

          {selectedType === "address" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="v-first-name" className="text-xs">First Name</Label>
                  <Input id="v-first-name" placeholder="John" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={50} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="v-last-name" className="text-xs">Last Name</Label>
                  <Input id="v-last-name" placeholder="Doe" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={50} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-street" className="text-xs">Street Address</Label>
                <Input id="v-street" placeholder="123 Main St" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={200} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="v-city" className="text-xs">City</Label>
                  <Input id="v-city" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} maxLength={100} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="v-state" className="text-xs">State / Region</Label>
                  <Input id="v-state" placeholder="State" value={state} onChange={(e) => setState(e.target.value)} maxLength={100} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="v-zip" className="text-xs">ZIP / Postal Code</Label>
                  <Input id="v-zip" placeholder="10001" value={zip} onChange={(e) => setZip(e.target.value)} maxLength={20} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="v-country" className="text-xs">Country</Label>
                  <Input id="v-country" placeholder="Country" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={100} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-phone" className="text-xs">Phone (optional)</Label>
                <Input id="v-phone" placeholder="+1 234 567 8900" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
              </div>
            </>
          )}

          {selectedType === "other" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="v-value" className="text-xs">Value</Label>
                <PasswordInput
                  id="v-value"
                  placeholder="Paste secret value..."
                  value={secretValue}
                  onChange={setSecretValue}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-desc" className="text-xs">Description (optional)</Label>
                <Textarea
                  id="v-desc"
                  placeholder="Optional notes about this secret"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={2}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Saving
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </>
    );
  }

  // ── Main render ─────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={
          <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Secret
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              {step === "pick" ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Add Secret</DialogTitle>
                    <DialogDescription>
                      Choose what type of secret to store.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="divide-y divide-border rounded-md border border-border mt-2">
                    {SECRET_TYPES.map((type) => (
                      <button
                        key={type.slug}
                        type="button"
                        onClick={() => handlePickType(type.slug)}
                        className="flex items-center gap-3 w-full px-3 py-3 text-left hover:bg-muted/50 transition-colors"
                      >
                        <type.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{type.label}</p>
                          <p className="text-xs text-muted-foreground">{type.description}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                renderForm()
              )}
            </DialogContent>
          </Dialog>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Secrets</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="mx-auto w-full max-w-xl space-y-4">
          {/* Search */}
          {isLoading ? (
            <Skeleton className="h-9 w-full rounded-md" />
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search secrets..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          {/* Count */}
          {isLoading ? (
            <Skeleton className="h-3 w-20" />
          ) : (
            <p className="text-xs text-muted-foreground">
              {filtered.length} secret{filtered.length !== 1 ? "s" : ""}
            </p>
          )}

          {/* List */}
          {isLoading ? (
            <div className="rounded-md border border-border divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3">
                  <Skeleton className="h-4 w-4 rounded shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <Skeleton className="h-3.5 w-[40%]" />
                    <Skeleton className="h-3 w-[60%]" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              ))}
            </div>
          ) : filtered.length > 0 ? (
            <div className="rounded-md border border-border divide-y divide-border">
              {filtered.map((item) => {
                const Icon = CATEGORY_ICONS[item.category] ?? KeyRound;
                return (
                  <div
                    key={`${item.source}-${item.id}`}
                    className="flex items-center gap-3 w-full px-3 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => handleRowClick(item)}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {item.label}
                        </span>
                        {item.source === "extension" ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-400 border-blue-500/20 shrink-0"
                          >
                            Extension
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 shrink-0"
                          >
                            {categoryLabel(item.category)}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {itemSubtitle(item)}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                );
              })}
            </div>
          ) : items.length > 0 ? (
            <div className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No secrets match your search.
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <KeyRound className="h-10 w-10 opacity-30" />
              <p className="text-sm">No secrets stored yet</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialogOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Secret
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
