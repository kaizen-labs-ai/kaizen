import { NextResponse } from "next/server";
import { whatsappGateway } from "@/lib/extensions/whatsapp/gateway";
import { prisma } from "@/lib/db/prisma";

export async function POST() {
  await whatsappGateway.logout();

  // Reset extension config
  try {
    const ext = await prisma.extension.findUnique({ where: { type: "whatsapp" } });
    if (ext) {
      const config = JSON.parse(ext.config || "{}");
      config.phoneNumber = null;
      await prisma.extension.update({
        where: { type: "whatsapp" },
        data: {
          enabled: false,
          status: "disconnected",
          config: JSON.stringify(config),
        },
      });
    }
  } catch {
    // Best-effort
  }

  return NextResponse.json({ ok: true });
}
