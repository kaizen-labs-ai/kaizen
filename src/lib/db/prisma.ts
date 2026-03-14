import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  _extensionsBooted?: boolean;
};

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({
    url: "file:./kaizen.db",
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Auto-boot enabled extensions on first server-side module load.
// Uses deferred dynamic import so the gateway module chain (Baileys, node:fs, etc.)
// stays out of the static dependency graph. The globalThis flag survives HMR reloads.
if (!globalForPrisma._extensionsBooted) {
  globalForPrisma._extensionsBooted = true;
  setTimeout(async () => {
    try {
      const { bootWhatsAppIfEnabled } = await import(
        "@/lib/extensions/whatsapp/gateway"
      );
      await bootWhatsAppIfEnabled();
    } catch (err) {
      console.error("[server-init] extension auto-boot failed:", err);
    }

    try {
      const { bootScheduler } = await import("@/lib/schedules/scheduler");
      bootScheduler();
    } catch (err) {
      console.error("[server-init] scheduler boot failed:", err);
    }
  }, 2000);
}
