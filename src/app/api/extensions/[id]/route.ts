import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ext = await prisma.extension.findUnique({ where: { id } });
  if (!ext) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(ext);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.enabled !== undefined) data.enabled = body.enabled;
  if (body.config !== undefined) data.config = typeof body.config === "string" ? body.config : JSON.stringify(body.config);
  if (body.status !== undefined) data.status = body.status;

  const ext = await prisma.extension.update({ where: { id }, data });
  return NextResponse.json(ext);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await prisma.extension.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
