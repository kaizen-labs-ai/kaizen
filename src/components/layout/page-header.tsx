"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

interface PageHeaderProps {
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ children, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center min-h-[57px] border-b border-border px-4 py-3 gap-2 shrink-0">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="!h-3.5 mr-1" />
      <div className="flex-1 min-w-0">{children}</div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
