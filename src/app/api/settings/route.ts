import { NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/settings/registry";
import { hasSecret } from "@/lib/vault/vault";

export const dynamic = "force-dynamic";

export async function GET() {
  const [settings, hasKey] = await Promise.all([
    getAllSettings(),
    hasSecret("openrouter_api_key"),
  ]);
  return NextResponse.json({
    ...settings,
    has_openrouter_key: hasKey ? "true" : "false",
  });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const { key, value } = body as { key: string; value: string };

  if (!key || typeof value !== "string") {
    return NextResponse.json({ error: "key and value required" }, { status: 400 });
  }

  const setting = await setSetting(key, value);
  return NextResponse.json(setting);
}
