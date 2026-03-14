import { NextResponse } from "next/server";
import { getAllAgentConfigs } from "@/lib/agents/queries";

export async function GET() {
  const agents = await getAllAgentConfigs();
  return NextResponse.json(agents);
}
