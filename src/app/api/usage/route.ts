import { NextResponse } from "next/server";
import {
  getUsageSummary,
  getDailyCosts,
  getCostByModel,
  getCostByAgent,
} from "@/lib/usage/queries";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") ?? "30d";

  let since: Date | undefined;
  const now = new Date();
  switch (range) {
    case "7d":  since = new Date(now.getTime() - 7 * 86400000); break;
    case "30d": since = new Date(now.getTime() - 30 * 86400000); break;
    case "90d": since = new Date(now.getTime() - 90 * 86400000); break;
    case "all": since = undefined; break;
    default:    since = new Date(now.getTime() - 30 * 86400000);
  }

  try {
    const [summary, daily, byModel, byAgent] = await Promise.all([
      getUsageSummary(since),
      getDailyCosts(since),
      getCostByModel(since),
      getCostByAgent(since),
    ]);

    return NextResponse.json({ summary, daily, byModel, byAgent });
  } catch (err) {
    console.error("[usage-api] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
