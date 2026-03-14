import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAllSchedules, getNextRun } from "@/lib/schedules/queries";

export async function GET() {
  const schedules = await getAllSchedules();
  const enriched = schedules.map((s) => ({
    ...s,
    nextRunAt: s.enabled ? getNextRun(s.cron, s.lastRunAt) : null,
  }));
  return NextResponse.json(enriched);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, cron, skillId, destination } = body;

  if (!name || !cron || !skillId) {
    return NextResponse.json(
      { error: "name, cron, and skillId are required" },
      { status: 400 },
    );
  }

  const schedule = await prisma.schedule.create({
    data: {
      name,
      cron,
      targetType: "skill",
      skillId,
      destination: destination ?? '{"type":"none"}',
      lastRunAt: new Date(), // prevent immediate fire on next scheduler tick
    },
    include: {
      skill: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(schedule, { status: 201 });
}
