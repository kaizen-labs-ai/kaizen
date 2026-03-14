import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSchedule } from "@/lib/schedules/queries";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const schedule = await getSchedule(id);
  if (!schedule) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(schedule);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, cron, enabled, skillId, destination } = body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (cron !== undefined) data.cron = cron;
  if (enabled !== undefined) data.enabled = enabled;
  if (destination !== undefined) data.destination = destination;
  if (skillId !== undefined) data.skillId = skillId;

  // When re-enabling, reset lastRunAt to now so the scheduler waits a full interval
  if (enabled === true) {
    const current = await prisma.schedule.findUnique({ where: { id }, select: { enabled: true } });
    if (current && !current.enabled) {
      data.lastRunAt = new Date();
    }
  }

  const schedule = await prisma.schedule.update({
    where: { id },
    data,
    include: {
      skill: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(schedule);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.schedule.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
