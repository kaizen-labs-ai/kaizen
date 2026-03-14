import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { AppSidebar } from "@/components/layout/sidebar";
import { SidebarInset } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { OpenRouterGuard } from "@/components/onboarding/openrouter-guard";
import { NewChatFab } from "@/components/layout/new-chat-fab";
import { DictationOverlay } from "@/components/ui/dictation-overlay";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kaizen",
  description: "Self-improving AI orchestration system",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value === "true";

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers sidebarOpen={sidebarOpen}>
          <AppSidebar />
          <SidebarInset className="h-svh overflow-hidden flex flex-col">
            <OpenRouterGuard />
            <div className="flex-1 overflow-hidden">{children}</div>
          </SidebarInset>
          <NewChatFab />
          <DictationOverlay />
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
