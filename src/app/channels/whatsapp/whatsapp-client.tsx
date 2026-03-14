"use client";

import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Wifi, WifiOff, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FaWhatsapp } from "react-icons/fa";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactList } from "@/components/channels/contact-list";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
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
import { toast } from "sonner";
import QRCode from "qrcode";

interface ExtensionData {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  status: string;
  config: string;
}

interface WhatsAppConfig {
  phoneNumber: string | null;
}

function parseConfig(raw: string): WhatsAppConfig {
  try {
    return { phoneNumber: null, ...JSON.parse(raw) };
  } catch {
    return { phoneNumber: null };
  }
}

export interface WhatsAppInitialData {
  extension: ExtensionData | null;
  contacts: unknown[];
}

export function WhatsAppClient({ initialData }: { initialData?: WhatsAppInitialData }) {
  const queryClient = useQueryClient();

  // QR pairing state
  const [pairing, setPairing] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const { data: waData, isLoading: loading } = useQuery({
    queryKey: ["whatsapp-extension"],
    queryFn: async () => {
      const res = await fetch("/api/extensions");
      const data: ExtensionData[] = await res.json();
      const wa = data.find((e) => e.type === "whatsapp") ?? null;
      return wa;
    },
    ...(initialData?.extension !== undefined ? { initialData: initialData.extension } : {}),
  });

  const ext = waData ?? null;
  const config = parseConfig(ext?.config ?? "{}");

  async function patchExtension(data: Record<string, unknown>) {
    if (!ext) return;
    const res = await fetch(`/api/extensions/${ext.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-extension"] });
    }
  }

  function startPairing() {
    setPairing(true);
    setQrDataUrl(null);

    const es = new EventSource("/api/extensions/whatsapp/qr");
    eventSourceRef.current = es;

    es.addEventListener("qr", async (e) => {
      const { qr } = JSON.parse(e.data);
      try {
        const dataUrl = await QRCode.toDataURL(qr, {
          width: 256,
          margin: 2,
          color: { dark: "#ffffff", light: "#00000000" },
        });
        setQrDataUrl(dataUrl);
      } catch {
        // QR generation failed
      }
    });

    es.addEventListener("connected", (e) => {
      const { phoneNumber } = JSON.parse(e.data);
      toast.success(`WhatsApp connected: +${phoneNumber}`);
      setPairing(false);
      setQrDataUrl(null);
      es.close();
      eventSourceRef.current = null;
      patchExtension({ enabled: true, status: "connected" });
    });

    es.addEventListener("error", (e) => {
      if (es.readyState === EventSource.CLOSED) {
        setPairing(false);
      }
      try {
        const { message } = JSON.parse((e as MessageEvent).data);
        toast.error(`WhatsApp error: ${message}`);
        setPairing(false);
        setQrDataUrl(null);
      } catch {
        // Standard EventSource error — ignore
      }
    });
  }

  function cancelPairing() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setPairing(false);
    setQrDataUrl(null);
  }

  async function handleDisconnect() {
    await fetch("/api/extensions/whatsapp/disconnect", { method: "POST" });
    toast.success("WhatsApp disconnected");
    queryClient.invalidateQueries({ queryKey: ["whatsapp-extension"] });
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
                <BreadcrumbPage>WhatsApp</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageHeader>
        <ScrollArea className="flex-1 overflow-hidden p-4">
          <div className="max-w-xl mx-auto space-y-6">
            {/* Header skeleton */}
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-6 rounded shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-3.5 w-[75%]" />
              </div>
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>

            {/* Connection section skeleton */}
            <div className="rounded-lg border p-4 space-y-4">
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-[85%]" />
                <Skeleton className="h-3.5 w-[65%]" />
              </div>
              <Skeleton className="h-9 w-36 rounded-md" />
            </div>

            {/* Contact list skeleton */}
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
          </div>
        </ScrollArea>
      </div>
    );
  }

  const isConnected = ext?.status === "connected";

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
              <BreadcrumbPage>WhatsApp</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="max-w-xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FaWhatsapp className="h-5 w-5 text-white" />
                WhatsApp
              </h2>
              <p className="text-sm text-muted-foreground">
                Send and receive messages through WhatsApp using your own number.
              </p>
            </div>
          </div>

          {/* Connection Section */}
          <div className="rounded-lg border p-4 space-y-4">
            {!isConnected && !pairing && (
              <>
                <p className="text-sm text-muted-foreground">
                  Connect your WhatsApp account by scanning a QR code, just like WhatsApp Web.
                  Messages to your &quot;Message Yourself&quot; chat will be processed by Kaizen.
                </p>
                <Button onClick={startPairing}>
                  Connect WhatsApp
                </Button>
              </>
            )}

            {pairing && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Scan with WhatsApp</p>
                  <Button variant="ghost" size="sm" onClick={cancelPairing}>
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>

                {qrDataUrl ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="rounded-lg border p-4 bg-muted/30">
                      <img
                        src={qrDataUrl}
                        alt="WhatsApp QR Code"
                        className="w-64 h-64"
                      />
                    </div>
                    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>Open WhatsApp on your phone</li>
                      <li>Go to Settings &gt; Linked Devices</li>
                      <li>Tap &quot;Link a Device&quot;</li>
                      <li>Scan this QR code</li>
                    </ol>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">
                      Generating QR code...
                    </span>
                  </div>
                )}
              </div>
            )}

            {isConnected && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <Wifi className="h-3.5 w-3.5 text-green-400" />
                      Connected
                    </p>
                    {config.phoneNumber && (
                      <p className="text-xs text-muted-foreground">
                        Phone: +{config.phoneNumber}
                      </p>
                    )}
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        Disconnect
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will disconnect your WhatsApp account. You can reconnect at any time by scanning a new QR code.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDisconnect}>
                          Disconnect
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            )}
          </div>

          {/* Contacts — only show when connected */}
          {isConnected && ext && (
            <ContactList extensionId={ext.id} channelType="whatsapp" selfSubtitle={config.phoneNumber ?? undefined} initialData={initialData?.contacts} />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
