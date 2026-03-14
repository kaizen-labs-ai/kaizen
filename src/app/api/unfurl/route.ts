import { NextResponse } from "next/server";
import { unfurlBatch } from "@/lib/unfurl/unfurl";

export async function POST(req: Request) {
  const body = await req.json();
  const { urls } = body as { urls?: string[] };

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: "urls array is required" }, { status: 400 });
  }

  // Validate: HTTP(S) only, reasonable length
  const validUrls = urls.filter(
    (u) => typeof u === "string" && /^https?:\/\//.test(u) && u.length <= 2048,
  );

  if (validUrls.length === 0) {
    return NextResponse.json({ results: {} });
  }

  const results = await unfurlBatch(validUrls);
  return NextResponse.json({ results });
}
