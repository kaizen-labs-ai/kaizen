"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Save,
  Trash2,
  MessageSquare,
  MessageSquarePlus,
  Phone,
  EyeOff,
  Check,
  ChevronLeft,
  ChevronRight,
  Search,
  CalendarClock,
  Timer,
  Clock,
  Sun,
  CalendarDays,
  CalendarRange,
  BookOpen,
} from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { StepWizard } from "@/components/ui/step-wizard";
import { toast } from "sonner";
import Link from "next/link";

interface TargetOption {
  id: string;
  name: string;
  description?: string;
}

interface ChatOption {
  id: string;
  title: string;
  messages?: { role: string; content: string }[];
}

interface WhatsAppContactOption {
  id: string;
  name: string;
  externalId: string;
  isSelf: boolean;
}

function chatPreview(content: string): string {
  const cleaned = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#*_~`>]/g, "")
    .replace(/\n+/g, " ")
    .trim();
  if (cleaned.length <= 80) return cleaned;
  return cleaned.slice(0, 80).trim() + "\u2026";
}

type DestinationType = "none" | "new_chat" | "chat" | "whatsapp";
type FrequencyType = "minutes" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";

const DESTINATION_OPTIONS = [
  {
    value: "none" as DestinationType,
    label: "None",
    description: "Skill handles its own output",
    icon: EyeOff,
  },
  {
    value: "new_chat" as DestinationType,
    label: "New chat",
    description: "Fresh chat each run",
    icon: MessageSquarePlus,
  },
  {
    value: "chat" as DestinationType,
    label: "Existing chat",
    description: "Append to a chat",
    icon: MessageSquare,
  },
  {
    value: "whatsapp" as DestinationType,
    label: "WhatsApp",
    description: "Send to your WhatsApp",
    icon: Phone,
  },
];

const FREQUENCY_OPTIONS = [
  { value: "minutes" as FrequencyType, label: "Minutes", description: "Run every N minutes", icon: Timer },
  { value: "hourly" as FrequencyType, label: "Hourly", description: "Once every hour", icon: Clock },
  { value: "daily" as FrequencyType, label: "Daily", description: "Once a day", icon: Sun },
  { value: "weekly" as FrequencyType, label: "Weekly", description: "On specific days", icon: CalendarDays },
  { value: "monthly" as FrequencyType, label: "Monthly", description: "Once a month", icon: CalendarRange },
  { value: "yearly" as FrequencyType, label: "Yearly", description: "Once a year", icon: CalendarClock },
];

const DAYS_OF_WEEK = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];


function buildCron(
  freqType: FrequencyType,
  time: string,
  days: number[],
  minuteInterval: number,
  monthDay: number,
  month: number = 1,
): string {
  const [h, m] = time.split(":").map(Number);
  switch (freqType) {
    case "minutes":
      return `*/${minuteInterval} * * * *`;
    case "hourly":
      return `${m} * * * *`;
    case "daily":
      return `${m} ${h} * * *`;
    case "weekly": {
      const dow = days.length > 0 ? days.sort().join(",") : "1";
      return `${m} ${h} * * ${dow}`;
    }
    case "monthly":
      return `${m} ${h} ${monthDay} * *`;
    case "yearly":
      return `${m} ${h} ${monthDay} ${month} *`;
  }
}

function parseCron(cron: string): {
  freqType: FrequencyType;
  time: string;
  days: number[];
  minuteInterval: number;
  monthDay: number;
  month: number;
} {
  const defaults = { days: [1], minuteInterval: 15, monthDay: 1, month: 1 };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { freqType: "daily", time: "09:00", ...defaults };
  const [min, hour, dom, mon, dow] = parts;

  if (min.startsWith("*/")) {
    return { freqType: "minutes", time: "09:00", ...defaults, minuteInterval: parseInt(min.slice(2)) || 15 };
  }
  if (min !== "*" && hour === "*") {
    return { freqType: "hourly", time: `00:${min.padStart(2, "0")}`, ...defaults };
  }
  if (dow !== "*" && dom === "*") {
    const dayList = dow.split(",").map(Number).filter((n) => !isNaN(n));
    return { freqType: "weekly", time: `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`, ...defaults, days: dayList.length > 0 ? dayList : [1] };
  }
  if (dom !== "*" && mon !== "*") {
    return { freqType: "yearly", time: `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`, ...defaults, monthDay: parseInt(dom) || 1, month: parseInt(mon) || 1 };
  }
  if (dom !== "*") {
    return { freqType: "monthly", time: `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`, ...defaults, monthDay: parseInt(dom) || 1 };
  }
  if (min !== "*" && hour !== "*") {
    return { freqType: "daily", time: `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`, ...defaults };
  }
  return { freqType: "daily", time: "09:00", ...defaults };
}

interface ScheduleData {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  targetType: string;
  skillId: string | null;
  destination: string;
  skill: { id: string; name: string } | null;
}

function ChoiceCard({
  selected,
  onClick,
  icon: Icon,
  label,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-lg border-2 p-4 text-center transition-all ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
      }`}
    >
      <Icon className={`h-5 w-5 ${selected ? "text-primary" : "text-muted-foreground"}`} />
      <span className={`text-sm font-medium ${selected ? "text-primary" : ""}`}>{label}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

const PAGE_SIZE = 5;

function renderPagination(page: number, totalPages: number, setPage: (p: number) => void) {
  if (totalPages <= 1) return null;
  return (
    <Pagination className="mt-3 justify-end">
      <PaginationContent className="gap-0.5">
        <PaginationItem>
          <PaginationPrevious
            onClick={(e) => { e.preventDefault(); if (page > 0) setPage(page - 1); }}
            className={`h-7 px-2 text-xs ${page === 0 ? "pointer-events-none opacity-40" : "cursor-pointer"}`}
            href="#"
          />
        </PaginationItem>
        {Array.from({ length: totalPages }, (_, i) => (
          <PaginationItem key={i}>
            <PaginationLink
              isActive={i === page}
              onClick={(e) => { e.preventDefault(); setPage(i); }}
              href="#"
              className="h-7 w-7 text-xs cursor-pointer"
            >
              {i + 1}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext
            onClick={(e) => { e.preventDefault(); if (page < totalPages - 1) setPage(page + 1); }}
            className={`h-7 px-2 text-xs ${page >= totalPages - 1 ? "pointer-events-none opacity-40" : "cursor-pointer"}`}
            href="#"
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function formatFrequency(
  freqType: FrequencyType,
  freqTime: string,
  freqDays: number[],
  freqMinuteInterval: number,
  freqMonthDay: number,
  freqMonth: number,
): string {
  switch (freqType) {
    case "minutes": return `Every ${freqMinuteInterval} minutes`;
    case "hourly": return `Hourly at :${freqTime.split(":")[1]}`;
    case "daily": return `Daily at ${freqTime}`;
    case "weekly": return `${freqDays.map((d) => DAYS_OF_WEEK.find((dw) => dw.value === d)?.label).join(", ")} at ${freqTime}`;
    case "monthly": return `Monthly on day ${freqMonthDay} at ${freqTime}`;
    case "yearly": return `Yearly on ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][freqMonth - 1]} ${freqMonthDay} at ${freqTime}`;
  }
}

// ---------------------------------------------------------------------------
// Wizard for creating new schedules
// ---------------------------------------------------------------------------

function NewScheduleWizard({
  skills,
  chats,
  whatsappContacts,
  waPhoneNumber,
  onCreated,
}: {
  skills: TargetOption[];
  chats: ChatOption[];
  whatsappContacts: WhatsAppContactOption[];
  waPhoneNumber: string | null;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const targetType = "skill" as const;
  const [targetId, setTargetId] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [destType, setDestType] = useState<DestinationType | null>(null);
  const [destChatId, setDestChatId] = useState("");
  const [destContactId, setDestContactId] = useState("");
  const [freqType, setFreqType] = useState<FrequencyType | null>(null);
  const [freqTime, setFreqTime] = useState("09:00");
  const [freqDays, setFreqDays] = useState<number[]>([1]);
  const [freqMinuteInterval, setFreqMinuteInterval] = useState(10);
  const [freqMonthDay, setFreqMonthDay] = useState(1);
  const [freqMonth, setFreqMonth] = useState(1);
  const [chatSearch, setChatSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [targetPage, setTargetPage] = useState(0);
  const [chatPage, setChatPage] = useState(0);
  const [contactPage, setContactPage] = useState(0);

  // Steps: 1=skill, 2=destination, 3=chat (conditional), 4=whatsapp (conditional), 5=frequency
  const FREQ_STEP = 5;
  const showChatStep = destType === "chat" || step === 3;
  const showWhatsAppStep = destType === "whatsapp" || step === 4;
  const visibleSteps: { label: string; panel: number }[] = [
    { label: "Skill", panel: 1 },
    { label: "Destination", panel: 2 },
    ...(showChatStep ? [{ label: "Chat", panel: 3 }] : []),
    ...(showWhatsAppStep ? [{ label: "Contact", panel: 4 }] : []),
    { label: "Frequency", panel: FREQ_STEP },
  ];
  const visibleStepIndex = visibleSteps.findIndex((s) => s.panel === step);

  const filteredChats = chats.filter((c) =>
    c.title.toLowerCase().includes(chatSearch.toLowerCase()),
  );

  const filteredContacts = whatsappContacts.filter((c) =>
    c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
    c.externalId.includes(contactSearch),
  );

  const targets = skills;
  const filtered = targets.filter((t) =>
    t.name.toLowerCase().includes(targetSearch.toLowerCase()) ||
    (t.description ?? "").toLowerCase().includes(targetSearch.toLowerCase()),
  );
  const targetTotalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pagedTargets = filtered.slice(targetPage * PAGE_SIZE, (targetPage + 1) * PAGE_SIZE);

  const chatTotalPages = Math.ceil(filteredChats.length / PAGE_SIZE);
  const pagedChats = filteredChats.slice(chatPage * PAGE_SIZE, (chatPage + 1) * PAGE_SIZE);

  const contactTotalPages = Math.ceil(filteredContacts.length / PAGE_SIZE);
  const pagedContacts = filteredContacts.slice(contactPage * PAGE_SIZE, (contactPage + 1) * PAGE_SIZE);

  const selectedTargetName =
    targets.find((t) => t.id === targetId)?.name ?? "";

  function handleSelectTarget(id: string) {
    setTargetId(id);
    setTimeout(() => setStep(2), 200);
  }

  function handleSelectDest(value: DestinationType) {
    setDestType(value);
    if (value === "chat") {
      setChatSearch("");
      setTimeout(() => setStep(3), 200);
    } else if (value === "whatsapp") {
      setContactSearch("");
      setTimeout(() => setStep(4), 200);
    } else {
      setTimeout(() => setStep(FREQ_STEP), 200);
    }
  }

  function handleSelectChat(id: string) {
    setDestChatId(id);
    setTimeout(() => setStep(FREQ_STEP), 200);
  }

  function handleSelectContact(id: string) {
    setDestContactId(id);
    setTimeout(() => setStep(FREQ_STEP), 200);
  }

  async function handleCreate() {
    if (!targetType || !targetId || !freqType) return;
    setSaving(true);

    const cron = buildCron(freqType, freqTime, freqDays, freqMinuteInterval, freqMonthDay, freqMonth);
    const destination: Record<string, string> = { type: destType ?? "none" };
    if (destType === "chat") destination.chatId = destChatId;
    if (destType === "whatsapp") destination.contactId = destContactId;

    const body: Record<string, unknown> = {
      name: selectedTargetName || "Unnamed schedule",
      cron,
      targetType,
      destination: JSON.stringify(destination),
    };
    body.skillId = targetId;

    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || "Failed to create schedule");
      setSaving(false);
      return;
    }
    const created = await res.json();
    toast.success("Schedule created");
    queryClient.invalidateQueries({ queryKey: ["schedules"] });
    onCreated(created.id);
  }

  // Whether the Next button should be enabled for the current step
  const canAdvance =
    (step === 1 && targetId !== "") ||
    (step === 2 && destType !== null) ||
    (step === 3 && destChatId !== "") ||
    (step === 4 && destContactId !== "") ||
    step === FREQ_STEP;

  function handleNext() {
    if (step === 1 && targetId) { setStep(2); }
    else if (step === 2 && destType) {
      if (destType === "chat") { setChatSearch(""); setStep(3); }
      else if (destType === "whatsapp") { setContactSearch(""); setStep(4); }
      else { setStep(FREQ_STEP); }
    }
    else if (step === 3 && destChatId) { setStep(FREQ_STEP); }
    else if (step === 4 && destContactId) { setStep(FREQ_STEP); }
  }

  function handleBack() {
    if (step === FREQ_STEP) {
      if (destType === "chat") setStep(3);
      else if (destType === "whatsapp") setStep(4);
      else setStep(2);
    } else if (step > 1) setStep(step - 1);
  }

  const stepNav = (
    <div className="flex items-center justify-between">
      {step > 1 ? (
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
      ) : (
        <div className="w-14" />
      )}

      <div className="flex items-center gap-1.5">
        {visibleSteps.map((vs, i) => (
          <div
            key={vs.panel}
            className={`h-1.5 w-1.5 rounded-full transition-colors ${
              i <= visibleStepIndex ? "bg-primary" : "bg-border"
            }`}
          />
        ))}
      </div>

      {step < FREQ_STEP ? (
        <button
          type="button"
          disabled={!canAdvance}
          onClick={handleNext}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : (
        <div className="w-14" />
      )}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-xl">
        <StepWizard
          step={step}
          footer={<div className="px-6 py-3">{stepNav}</div>}
          contentClassName="min-h-[561px]"
        >
          {/* Step 0: placeholder (unused — wizard starts at step 1) */}
          <div />

          {/* Step 1: Select skill */}
          <div className="px-6 py-6">
              <h2 className="text-lg font-semibold text-center mb-1">
                Choose a skill
              </h2>
              <p className="text-sm text-muted-foreground text-center mb-6">
                Select which skill to run
              </p>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search skills..."
                  value={targetSearch}
                  onChange={(e) => { setTargetSearch(e.target.value); setTargetPage(0); }}
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                {filtered.length} skill{filtered.length !== 1 ? "s" : ""}
              </p>
              <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
                {pagedTargets.length > 0 ? (
                  pagedTargets.map((t) => {
                    const isSelected = targetId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleSelectTarget(t.id)}
                        className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${
                          isSelected ? "bg-primary/5" : "hover:bg-muted/50"
                        }`}
                      >
                        <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                        }`}>
                          {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm font-medium truncate block ${isSelected ? "text-primary" : ""}`}>
                            {t.name}
                          </span>
                          {t.description && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{t.description}</p>
                          )}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                    {targetSearch ? "No matches" : "No skills yet"}
                  </div>
                )}
              </div>
              {renderPagination(targetPage, targetTotalPages, setTargetPage)}
          </div>

          {/* Step 2: Destination */}
          <div className="px-6 py-6">
            <h2 className="text-lg font-semibold text-center mb-1">Where should the output go?</h2>
            <p className="text-sm text-muted-foreground text-center mb-8">Choose how you want to receive results</p>
            <div className="grid grid-cols-2 gap-4">
              {DESTINATION_OPTIONS.map((opt) => (
                <ChoiceCard
                  key={opt.value}
                  selected={destType === opt.value}
                  onClick={() => handleSelectDest(opt.value)}
                  icon={opt.icon}
                  label={opt.label}
                  description={opt.description}
                />
              ))}
            </div>
          </div>

          {/* Step 3: Select chat (conditional) */}
          <div className="px-6 py-6">
            <h2 className="text-lg font-semibold text-center mb-1">Choose a chat</h2>
              <p className="text-sm text-muted-foreground text-center mb-6">
                Select which chat to send results to
              </p>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search chats..."
                  value={chatSearch}
                  onChange={(e) => { setChatSearch(e.target.value); setChatPage(0); }}
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                {filteredChats.length} chat{filteredChats.length !== 1 ? "s" : ""}
              </p>
              <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
                {pagedChats.length > 0 ? (
                  pagedChats.map((c) => {
                    const isSelected = destChatId === c.id;
                    const lastMsg = c.messages?.find((m) => m.content);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectChat(c.id)}
                        className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${
                          isSelected ? "bg-primary/5" : "hover:bg-muted/50"
                        }`}
                      >
                        <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                        }`}>
                          {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm font-medium truncate block ${isSelected ? "text-primary" : ""}`}>
                            {c.title}
                          </span>
                          {lastMsg && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {lastMsg.role === "user" ? "You: " : ""}
                              {chatPreview(lastMsg.content)}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                    {chatSearch ? "No matches" : "No chats yet"}
                  </div>
                )}
              </div>
              {renderPagination(chatPage, chatTotalPages, setChatPage)}
          </div>

          {/* Step 4: Select WhatsApp contact (conditional) */}
          <div className="px-6 py-6">
            <h2 className="text-lg font-semibold text-center mb-1">Choose a contact</h2>
              <p className="text-sm text-muted-foreground text-center mb-6">
                Select which WhatsApp contact to send results to
              </p>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search contacts..."
                  value={contactSearch}
                  onChange={(e) => { setContactSearch(e.target.value); setContactPage(0); }}
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                {filteredContacts.length} contact{filteredContacts.length !== 1 ? "s" : ""}
              </p>
              <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
                {pagedContacts.length > 0 ? (
                  pagedContacts.map((c) => {
                    const isSelected = destContactId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectContact(c.id)}
                        className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${
                          isSelected ? "bg-primary/5" : "hover:bg-muted/50"
                        }`}
                      >
                        <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                        }`}>
                          {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm font-medium truncate block ${isSelected ? "text-primary" : ""}`}>
                            {c.name}
                          </span>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            +{c.isSelf && waPhoneNumber ? waPhoneNumber : c.externalId}
                          </p>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                    {contactSearch ? "No matches" : "No contacts yet"}
                  </div>
                )}
              </div>
              {renderPagination(contactPage, contactTotalPages, setContactPage)}
          </div>

          {/* Step 5: Frequency */}
          <div className="px-6 py-6">
            <h2 className="text-lg font-semibold text-center mb-1">How often?</h2>
              <p className="text-sm text-muted-foreground text-center mb-8">Set the schedule frequency</p>

              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  {FREQUENCY_OPTIONS.map((f) => (
                    <ChoiceCard
                      key={f.value}
                      selected={freqType === f.value}
                      onClick={() => {
                        setFreqType(f.value);
                        if (f.value === "minutes") setFreqMinuteInterval(10);
                        if (f.value === "hourly") setFreqTime("00:00");
                        if (f.value === "daily" || f.value === "weekly" || f.value === "monthly" || f.value === "yearly") setFreqTime("09:00");
                        if (f.value === "weekly") setFreqDays([1]);
                        if (f.value === "monthly" || f.value === "yearly") setFreqMonthDay(1);
                        if (f.value === "yearly") setFreqMonth(1);
                      }}
                      icon={f.icon}
                      label={f.label}
                      description={f.description}
                    />
                  ))}
                </div>

                {freqType === "minutes" && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Every</span>
                    <Input
                      type="number"
                      min={1}
                      max={1440}
                      value={freqMinuteInterval}
                      onChange={(e) => setFreqMinuteInterval(Math.max(1, Math.min(1440, Number(e.target.value) || 1)))}
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">minutes</span>
                  </div>
                )}

                {freqType === "hourly" && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">At minute</span>
                    <Select
                      value={freqTime.split(":")[1]}
                      onValueChange={(v) => setFreqTime(`${freqTime.split(":")[0]}:${v}`)}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["00", "15", "30", "45"].map((m) => (
                          <SelectItem key={m} value={m}>
                            :{m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">of every hour</span>
                  </div>
                )}

                {(freqType === "daily" || freqType === "weekly" || freqType === "monthly" || freqType === "yearly") && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">At</span>
                    <Input
                      type="time"
                      value={freqTime}
                      onChange={(e) => setFreqTime(e.target.value)}
                      className="w-auto [&::-webkit-calendar-picker-indicator]:hidden"
                    />
                  </div>
                )}

                {freqType === "weekly" && (
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS_OF_WEEK.map((day) => {
                      const active = freqDays.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                            active
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                          }`}
                          onClick={() => {
                            if (active) {
                              if (freqDays.length > 1) setFreqDays(freqDays.filter((d) => d !== day.value));
                            } else {
                              setFreqDays([...freqDays, day.value]);
                            }
                          }}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {freqType === "monthly" && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">On day</span>
                    <Select
                      value={String(freqMonthDay)}
                      onValueChange={(v) => setFreqMonthDay(Number(v))}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                          <SelectItem key={d} value={String(d)}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">of every month</span>
                  </div>
                )}

                {freqType === "yearly" && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-muted-foreground">On</span>
                    <Select
                      value={String(freqMonth)}
                      onValueChange={(v) => setFreqMonth(Number(v))}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={String(freqMonthDay)}
                      onValueChange={(v) => setFreqMonthDay(Number(v))}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                          <SelectItem key={d} value={String(d)}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Summary accordion */}
                {freqType && (
                  <Accordion type="single" collapsible className="rounded-lg border border-border px-4 mt-6">
                    <AccordionItem value="summary" className="border-b-0">
                      <AccordionTrigger className="py-3 hover:no-underline">
                        <div className="flex items-center gap-2 text-sm">
                          <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium">Summary</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="text-sm space-y-1.5 pl-6">
                          <p>
                            <span className="text-muted-foreground">Target:</span>{" "}
                            <span className="font-medium">{selectedTargetName}</span>{" "}
                            <span className="text-muted-foreground">({targetType})</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground">Destination:</span>{" "}
                            {DESTINATION_OPTIONS.find((d) => d.value === destType)?.label}
                            {destType === "chat" && destChatId && (() => {
                              const chat = chats.find((c) => c.id === destChatId);
                              return chat ? <span className="text-muted-foreground"> — {chat.title}</span> : null;
                            })()}
                            {destType === "whatsapp" && destContactId && (() => {
                              const contact = whatsappContacts.find((c) => c.id === destContactId);
                              if (!contact) return null;
                              const number = contact.isSelf && waPhoneNumber ? waPhoneNumber : contact.externalId;
                              return <span className="text-muted-foreground"> — {contact.name} (+{number})</span>;
                            })()}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Frequency:</span>{" "}
                            {formatFrequency(freqType, freqTime, freqDays, freqMinuteInterval, freqMonthDay, freqMonth)}
                          </p>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}

                <Button className="w-full" onClick={handleCreate} disabled={saving || !freqType}>
                  {saving ? "Creating..." : "Create schedule"}
                </Button>
              </div>
          </div>
        </StepWizard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit destination dialog
// ---------------------------------------------------------------------------

function EditDestinationDialog({
  open,
  onOpenChange,
  destType: currentType,
  destChatId: currentChatId,
  destContactId: currentContactId,
  chats,
  whatsappContacts,
  waPhoneNumber,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destType: DestinationType;
  destChatId: string;
  destContactId: string;
  chats: ChatOption[];
  whatsappContacts: WhatsAppContactOption[];
  waPhoneNumber: string | null;
  onSave: (type: DestinationType, chatId: string, contactId: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState(currentType);
  const [chatId, setChatId] = useState(currentChatId);
  const [contactId, setContactId] = useState(currentContactId);
  const [chatSearch, setChatSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [chatPage, setChatPage] = useState(0);
  const [contactPage, setContactPage] = useState(0);

  useEffect(() => {
    if (open) {
      setStep(0);
      setType(currentType);
      setChatId(currentChatId);
      setContactId(currentContactId);
      setChatSearch("");
      setContactSearch("");
      setChatPage(0);
      setContactPage(0);
    }
  }, [open, currentType, currentChatId, currentContactId]);

  const filteredChats = chats.filter((c) =>
    c.title.toLowerCase().includes(chatSearch.toLowerCase()),
  );
  const chatTotalPages = Math.ceil(filteredChats.length / PAGE_SIZE);
  const pagedChats = filteredChats.slice(chatPage * PAGE_SIZE, (chatPage + 1) * PAGE_SIZE);

  const filteredContacts = whatsappContacts.filter((c) =>
    c.name.toLowerCase().includes(contactSearch.toLowerCase()) || c.externalId.includes(contactSearch),
  );
  const contactTotalPages = Math.ceil(filteredContacts.length / PAGE_SIZE);
  const pagedContacts = filteredContacts.slice(contactPage * PAGE_SIZE, (contactPage + 1) * PAGE_SIZE);

  function handleSelectType(value: DestinationType) {
    setType(value);
    if (value === "chat") {
      setChatSearch("");
      setChatPage(0);
      setTimeout(() => setStep(1), 200);
    } else if (value === "whatsapp") {
      setContactSearch("");
      setContactPage(0);
      setTimeout(() => setStep(2), 200);
    }
  }

  function handleSave() {
    onSave(type, chatId, contactId);
    onOpenChange(false);
  }

  const canSave =
    type === "none" || type === "new_chat" ||
    (type === "chat" && chatId !== "") ||
    (type === "whatsapp" && contactId !== "");

  // Steps: 0 = type, 1 = chat, 2 = contact
  const footer = (
    <div className="flex items-center justify-between px-5 py-3">
      {step > 0 ? (
        <button
          type="button"
          onClick={() => setStep(0)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
      ) : (
        <div />
      )}
      <Button size="sm" onClick={handleSave} disabled={!canSave}>
        Update
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0">
        <StepWizard step={step} footer={footer} className="border-0 rounded-none">
          {/* Step 0: Type */}
          <div className="px-6 py-6">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-center">Output destination</DialogTitle>
              <DialogDescription className="text-center">Choose how you want to receive results</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              {DESTINATION_OPTIONS.map((opt) => (
                <ChoiceCard
                  key={opt.value}
                  selected={type === opt.value}
                  onClick={() => handleSelectType(opt.value)}
                  icon={opt.icon}
                  label={opt.label}
                  description={opt.description}
                />
              ))}
            </div>
          </div>

          {/* Step 1: Chat */}
          <div className="px-6 py-6">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-center">Choose a chat</DialogTitle>
              <DialogDescription className="text-center">Select which chat to send results to</DialogDescription>
            </DialogHeader>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search chats..."
                value={chatSearch}
                onChange={(e) => { setChatSearch(e.target.value); setChatPage(0); }}
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {filteredChats.length} chat{filteredChats.length !== 1 ? "s" : ""}
            </p>
            <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
              {pagedChats.length > 0 ? (
                pagedChats.map((c) => {
                  const isSelected = chatId === c.id;
                  const lastMsg = c.messages?.find((m) => m.content);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setChatId(c.id)}
                      className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${
                        isSelected ? "bg-primary/5" : "hover:bg-muted/50"
                      }`}
                    >
                      <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                      }`}>
                        {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-medium truncate block ${isSelected ? "text-primary" : ""}`}>
                          {c.title}
                        </span>
                        {lastMsg && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {lastMsg.role === "user" ? "You: " : ""}
                            {chatPreview(lastMsg.content)}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {chatSearch ? "No matches" : "No chats yet"}
                </div>
              )}
            </div>
            {renderPagination(chatPage, chatTotalPages, setChatPage)}
          </div>

          {/* Step 2: Contact */}
          <div className="px-6 py-6">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-center">Choose a contact</DialogTitle>
              <DialogDescription className="text-center">Select which WhatsApp contact to send results to</DialogDescription>
            </DialogHeader>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search contacts..."
                value={contactSearch}
                onChange={(e) => { setContactSearch(e.target.value); setContactPage(0); }}
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {filteredContacts.length} contact{filteredContacts.length !== 1 ? "s" : ""}
            </p>
            <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
              {pagedContacts.length > 0 ? (
                pagedContacts.map((c) => {
                  const isSelected = contactId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setContactId(c.id)}
                      className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${
                        isSelected ? "bg-primary/5" : "hover:bg-muted/50"
                      }`}
                    >
                      <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                      }`}>
                        {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-medium truncate block ${isSelected ? "text-primary" : ""}`}>
                          {c.name}
                        </span>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          +{c.isSelf && waPhoneNumber ? waPhoneNumber : c.externalId}
                        </p>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {contactSearch ? "No matches" : "No contacts yet"}
                </div>
              )}
            </div>
            {renderPagination(contactPage, contactTotalPages, setContactPage)}
          </div>
        </StepWizard>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit frequency dialog
// ---------------------------------------------------------------------------

function EditFrequencyDialog({
  open,
  onOpenChange,
  freqType: currentFreqType,
  freqTime: currentFreqTime,
  freqDays: currentFreqDays,
  freqMinuteInterval: currentMinuteInterval,
  freqMonthDay: currentMonthDay,
  freqMonth: currentMonth,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  freqType: FrequencyType;
  freqTime: string;
  freqDays: number[];
  freqMinuteInterval: number;
  freqMonthDay: number;
  freqMonth: number;
  onSave: (type: FrequencyType, time: string, days: number[], minuteInterval: number, monthDay: number, month: number) => void;
}) {
  const [type, setType] = useState(currentFreqType);
  const [time, setTime] = useState(currentFreqTime);
  const [days, setDays] = useState(currentFreqDays);
  const [minuteInterval, setMinuteInterval] = useState(currentMinuteInterval);
  const [monthDay, setMonthDay] = useState(currentMonthDay);
  const [month, setMonth] = useState(currentMonth);

  useEffect(() => {
    if (open) {
      setType(currentFreqType);
      setTime(currentFreqTime);
      setDays(currentFreqDays);
      setMinuteInterval(currentMinuteInterval);
      setMonthDay(currentMonthDay);
      setMonth(currentMonth);
    }
  }, [open, currentFreqType, currentFreqTime, currentFreqDays, currentMinuteInterval, currentMonthDay, currentMonth]);

  function handleSave() {
    onSave(type, time, days, minuteInterval, monthDay, month);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule frequency</DialogTitle>
          <DialogDescription>Set how often this schedule should run</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            {FREQUENCY_OPTIONS.map((f) => (
              <ChoiceCard
                key={f.value}
                selected={type === f.value}
                onClick={() => {
                  setType(f.value);
                  if (f.value === "minutes") setMinuteInterval(minuteInterval || 10);
                  if (f.value === "hourly") setTime(time || "00:00");
                  if (f.value === "daily" || f.value === "weekly" || f.value === "monthly" || f.value === "yearly") setTime(time || "09:00");
                  if (f.value === "weekly" && days.length === 0) setDays([1]);
                  if ((f.value === "monthly" || f.value === "yearly") && !monthDay) setMonthDay(1);
                  if (f.value === "yearly" && !month) setMonth(1);
                }}
                icon={f.icon}
                label={f.label}
                description={f.description}
              />
            ))}
          </div>

          {type === "minutes" && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Every</span>
              <Input
                type="number"
                min={1}
                max={1440}
                value={minuteInterval}
                onChange={(e) => setMinuteInterval(Math.max(1, Math.min(1440, Number(e.target.value) || 1)))}
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">minutes</span>
            </div>
          )}

          {type === "hourly" && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">At minute</span>
              <Select value={time.split(":")[1]} onValueChange={(v) => setTime(`${time.split(":")[0]}:${v}`)}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["00", "15", "30", "45"].map((m) => (
                    <SelectItem key={m} value={m}>:{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">of every hour</span>
            </div>
          )}

          {(type === "daily" || type === "weekly" || type === "monthly" || type === "yearly") && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">At</span>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-auto [&::-webkit-calendar-picker-indicator]:hidden" />
            </div>
          )}

          {type === "weekly" && (
            <div className="flex flex-wrap gap-1.5">
              {DAYS_OF_WEEK.map((day) => {
                const active = days.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    }`}
                    onClick={() => {
                      if (active) {
                        if (days.length > 1) setDays(days.filter((d) => d !== day.value));
                      } else {
                        setDays([...days, day.value]);
                      }
                    }}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          )}

          {type === "monthly" && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">On day</span>
              <Select value={String(monthDay)} onValueChange={(v) => setMonthDay(Number(v))}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <SelectItem key={d} value={String(d)}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">of every month</span>
            </div>
          )}

          {type === "yearly" && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground">On</span>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(monthDay)} onValueChange={(v) => setMonthDay(Number(v))}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <SelectItem key={d} value={String(d)}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button size="sm" onClick={handleSave}>Update</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Read-only detail view for existing schedules
// ---------------------------------------------------------------------------

function EditScheduleForm({
  initialData,
  id,
  chats,
  whatsappContacts,
  waPhoneNumber,
}: {
  initialData: ScheduleData;
  id: string;
  chats: ChatOption[];
  whatsappContacts: WhatsAppContactOption[];
  waPhoneNumber: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [destDialogOpen, setDestDialogOpen] = useState(false);
  const [freqDialogOpen, setFreqDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const initDest = (() => {
    try {
      return JSON.parse(initialData.destination);
    } catch {
      return { type: "none" };
    }
  })();
  const initCron = parseCron(initialData.cron);

  const [enabled, setEnabled] = useState(initialData.enabled);
  const [destType, setDestType] = useState<DestinationType>(initDest.type ?? "none");
  const [destChatId, setDestChatId] = useState(initDest.chatId ?? "");
  const [destContactId, setDestContactId] = useState(initDest.contactId ?? "");
  const [freqType, setFreqType] = useState<FrequencyType>(initCron.freqType);
  const [freqTime, setFreqTime] = useState(initCron.time);
  const [freqDays, setFreqDays] = useState<number[]>(initCron.days);
  const [freqMinuteInterval, setFreqMinuteInterval] = useState(initCron.minuteInterval);
  const [freqMonthDay, setFreqMonthDay] = useState(initCron.monthDay);
  const [freqMonth, setFreqMonth] = useState(initCron.month);

  async function handleSave() {
    if (destType === "chat" && !destChatId) {
      toast.error("Select a chat");
      return;
    }
    if (destType === "whatsapp" && !destContactId) {
      toast.error("Select a contact");
      return;
    }
    setSaving(true);
    const cron = buildCron(freqType, freqTime, freqDays, freqMinuteInterval, freqMonthDay, freqMonth);
    const destination: Record<string, string> = { type: destType };
    if (destType === "chat") destination.chatId = destChatId;
    if (destType === "whatsapp") destination.contactId = destContactId;

    const res = await fetch(`/api/schedules/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cron, enabled, destination: JSON.stringify(destination) }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error("Failed to save");
      return;
    }
    toast.success("Schedule saved");
    queryClient.invalidateQueries({ queryKey: ["schedules"] });
  }

  async function handleDelete() {
    await fetch(`/api/schedules/${id}`, { method: "DELETE" });
    toast.success("Schedule deleted");
    queryClient.invalidateQueries({ queryKey: ["schedules"] });
    router.push("/schedules");
  }

  // Human-readable destination label
  const destOption = DESTINATION_OPTIONS.find((d) => d.value === destType);
  const DestIcon = destOption?.icon ?? EyeOff;
  let destDescription = destOption?.label ?? "None";
  if (destType === "chat" && destChatId) {
    const chat = chats.find((c) => c.id === destChatId);
    if (chat) destDescription += ` — ${chat.title}`;
  }
  if (destType === "whatsapp" && destContactId) {
    const contact = whatsappContacts.find((c) => c.id === destContactId);
    if (contact) {
      const num = contact.isSelf && waPhoneNumber ? waPhoneNumber : contact.externalId;
      destDescription += ` — ${contact.name} (+${num})`;
    }
  }

  // Human-readable frequency label
  const freqOption = FREQUENCY_OPTIONS.find((f) => f.value === freqType);
  const FreqIcon = freqOption?.icon ?? Clock;
  const freqDescription = formatFrequency(freqType, freqTime, freqDays, freqMinuteInterval, freqMonthDay, freqMonth);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
              <Save className="mr-1 h-4 w-4" /> {saving ? "Saving..." : "Save"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => setDeleteOpen(true)}
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
                <Link href="/schedules">Schedules</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{initialData.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto w-full max-w-xl space-y-6">
          {/* Back link + enabled toggle */}
          <div className="flex items-center justify-between">
            <Link
              href="/schedules"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to schedules
            </Link>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Detail list */}
          <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
            {/* Target (read-only) */}
            <div className="flex items-center gap-3 px-3 py-3">
              <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium truncate block">
                  {initialData.skill?.name ?? "Unknown"}
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Skill
                </p>
              </div>
            </div>

            {/* Destination (clickable) */}
            <button
              type="button"
              onClick={() => setDestDialogOpen(true)}
              className="group flex w-full items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors"
            >
              <DestIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0 text-left">
                <span className="text-sm font-medium truncate block">Output destination</span>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{destDescription}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 opacity-40" />
            </button>

            {/* Frequency (clickable) */}
            <button
              type="button"
              onClick={() => setFreqDialogOpen(true)}
              className="group flex w-full items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors"
            >
              <FreqIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0 text-left">
                <span className="text-sm font-medium truncate block">Schedule</span>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{freqDescription}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 opacity-40" />
            </button>
          </div>
        </div>
      </div>

      {/* Edit Destination Dialog */}
      <EditDestinationDialog
        open={destDialogOpen}
        onOpenChange={setDestDialogOpen}
        destType={destType}
        destChatId={destChatId}
        destContactId={destContactId}
        chats={chats}
        whatsappContacts={whatsappContacts}
        waPhoneNumber={waPhoneNumber}
        onSave={(type, chatIdVal, contactIdVal) => {
          setDestType(type);
          setDestChatId(chatIdVal);
          setDestContactId(contactIdVal);
        }}
      />

      {/* Edit Frequency Dialog */}
      <EditFrequencyDialog
        open={freqDialogOpen}
        onOpenChange={setFreqDialogOpen}
        freqType={freqType}
        freqTime={freqTime}
        freqDays={freqDays}
        freqMinuteInterval={freqMinuteInterval}
        freqMonthDay={freqMonthDay}
        freqMonth={freqMonth}
        onSave={(t, ti, d, mi, md, mo) => {
          setFreqType(t);
          setFreqTime(ti);
          setFreqDays(d);
          setFreqMinuteInterval(mi);
          setFreqMonthDay(md);
          setFreqMonth(mo);
        }}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this schedule. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component — routes to wizard or edit form
// ---------------------------------------------------------------------------

export function ScheduleDetailClient({
  initialData,
  id,
}: {
  initialData: ScheduleData | null;
  id: string;
}) {
  const router = useRouter();
  const isNew = id === "new";

  const [skills, setSkills] = useState<TargetOption[]>([]);
  const [chats, setChats] = useState<ChatOption[]>([]);
  const [whatsappContacts, setWhatsappContacts] = useState<WhatsAppContactOption[]>([]);
  const [waPhoneNumber, setWaPhoneNumber] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fetches: Promise<unknown>[] = [
      fetch("/api/chats").then((r) => r.json()),
      // Always fetch WhatsApp data (needed for both new wizard and edit dialogs)
      fetch("/api/extensions").then((r) => r.json()).then(async (exts: { id: string; type: string; config: string }[]) => {
        const wa = exts.find((e) => e.type === "whatsapp");
        if (!wa) return { contacts: [], phoneNumber: null };
        const res = await fetch(`/api/extensions/${wa.id}/contacts`);
        if (!res.ok) return { contacts: [], phoneNumber: null };
        const contacts = await res.json();
        let phoneNumber: string | null = null;
        try { phoneNumber = JSON.parse(wa.config).phoneNumber ?? null; } catch {}
        return { contacts, phoneNumber };
      }),
    ];
    if (isNew) {
      fetches.push(
        fetch("/api/skills").then((r) => r.json()),
      );
    }
    Promise.all(fetches).then(([ch, waData, sk]) => {
      setChats((ch as ChatOption[]).map((c) => ({ id: c.id, title: c.title, messages: c.messages })));
      const { contacts, phoneNumber } = (waData as { contacts: { id: string; name: string; externalId: string; isSelf: boolean }[]; phoneNumber: string | null }) ?? { contacts: [], phoneNumber: null };
      if (contacts) {
        setWhatsappContacts(
          contacts.map((c) => ({ id: c.id, name: c.name, externalId: c.externalId, isSelf: c.isSelf })),
        );
      }
      if (phoneNumber) setWaPhoneNumber(phoneNumber);
      if (isNew) {
        setSkills((sk as TargetOption[]).map((s) => ({ id: s.id, name: s.name, description: s.description })));
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  if (isNew) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader
          actions={
            <Button variant="outline" size="sm" onClick={() => router.push("/schedules")}>
              Cancel
            </Button>
          }
        >
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/schedules">Schedules</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>New Schedule</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageHeader>
        {loaded ? (
          <NewScheduleWizard
            skills={skills}
            chats={chats}
            whatsappContacts={whatsappContacts}
            waPhoneNumber={waPhoneNumber}
            onCreated={(newId) => router.replace(`/schedules/${newId}`)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        )}
      </div>
    );
  }

  if (!initialData) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Schedule not found
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <EditScheduleForm
      initialData={initialData}
      id={id}
      chats={chats}
      whatsappContacts={whatsappContacts}
      waPhoneNumber={waPhoneNumber}
    />
  );
}
