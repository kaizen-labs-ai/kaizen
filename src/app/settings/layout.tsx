"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

const NAV_ITEMS = [
  { label: "System Agents", href: "/settings/agents" },
  { label: "Soul", href: "/settings/soul" },
  { label: "Theme", href: "/settings/theme" },
  { label: "Voice", href: "/settings/voice" },
  { label: "Browser", href: "/settings/browser" },
  { label: "Memory", href: "/settings/memory" },
  { label: "Recovery", href: "/settings/recovery" },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const activeTab =
    NAV_ITEMS.find(
      (item) => pathname === item.href || pathname.startsWith(item.href + "/")
    )?.href ?? "/settings/agents";

  // Hide tabs on detail sub-pages (e.g. /settings/agents/[id])
  const isDetailPage = NAV_ITEMS.some(
    (item) => pathname.startsWith(item.href + "/") && pathname !== item.href
  );

  // Read detail label from React Query cache (populated by the agents list page)
  const queryClient = useQueryClient();
  const agentMatch = isDetailPage ? pathname.match(/^\/settings\/agents\/(.+)$/) : null;
  const cachedAgents = agentMatch
    ? (queryClient.getQueryData<{ id: string; label: string }[]>(["agents"]) ?? [])
    : [];
  const cachedLabel = agentMatch
    ? cachedAgents.find((a) => a.id === agentMatch[1])?.label ?? null
    : null;

  // Fallback: fetch only if cache miss (e.g. direct URL navigation)
  const [fetchedLabel, setFetchedLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!agentMatch || cachedLabel) {
      setFetchedLabel(null);
      return;
    }
    fetch(`/api/agents/${agentMatch[1]}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setFetchedLabel(data?.label ?? null))
      .catch(() => setFetchedLabel(null));
  }, [pathname, agentMatch?.[1], cachedLabel]);

  const detailLabel = cachedLabel ?? fetchedLabel;

  // Find parent section for breadcrumb link
  const parentSection = isDetailPage
    ? NAV_ITEMS.find((item) => pathname.startsWith(item.href + "/"))
    : null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              {isDetailPage ? (
                <BreadcrumbLink asChild>
                  <Link href="/settings/agents">Settings</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>Settings</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {isDetailPage && parentSection && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href={parentSection.href}>{parentSection.label}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            {isDetailPage && detailLabel && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{detailLabel}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="mx-auto max-w-xl">
          {!isDetailPage && (
            <Tabs value={activeTab}>
              <TabsList>
                {NAV_ITEMS.map((item) => (
                  <TabsTrigger key={item.href} value={item.href} asChild>
                    <Link href={item.href} prefetch={false} onClick={(e) => { if (activeTab === item.href) e.preventDefault(); }}>
                      {item.label}
                    </Link>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <div className={isDetailPage ? "" : "mt-4"}>{children}</div>
        </div>
      </ScrollArea>
    </div>
  );
}
