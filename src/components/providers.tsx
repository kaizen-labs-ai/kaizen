"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useState, useEffect } from "react";
import { loader } from "@monaco-editor/react";

export function Providers({ children, sidebarOpen = false }: { children: React.ReactNode; sidebarOpen?: boolean }) {
  useEffect(() => { loader.init(); }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <SidebarProvider defaultOpen={sidebarOpen}>
          {children}
        </SidebarProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
