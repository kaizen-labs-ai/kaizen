import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { parseDeepLearningConfig } from "@/lib/training/types";
import { getTrainingEpochs } from "@/lib/training/queries";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const skill = await prisma.skill.findUnique({
    where: { id },
    select: { deepLearning: true },
  });
  if (!skill) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = parseDeepLearningConfig(skill.deepLearning);
  const { epochs, total } = await getTrainingEpochs(id, 10, 0);

  return NextResponse.json({ config, epochs, total });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const skill = await prisma.skill.findUnique({
    where: { id },
    select: { deepLearning: true },
  });
  if (!skill) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = parseDeepLearningConfig(skill.deepLearning);

  if (body.enabled !== undefined) config.enabled = !!body.enabled;
  if (body.objective !== undefined) {
    const newObjective = String(body.objective);
    // If objective changed and skill was "optimized", reset to idle so training resumes
    if (newObjective !== config.objective && config.status === "optimized") {
      config.status = "idle";
      config.runsSinceLastEpoch = 0;
    }
    config.objective = newObjective;
  }
  if (body.trainEveryN !== undefined) config.trainEveryN = Math.max(1, Number(body.trainEveryN) || 1);
  if (body.convergenceThreshold !== undefined) config.convergenceThreshold = Math.max(1, Number(body.convergenceThreshold) || 3);
  if (body.maxEpochs !== undefined) config.maxEpochs = Math.max(1, Number(body.maxEpochs) || 50);

  // When disabling, reset status to idle
  if (body.enabled === false) {
    config.status = "idle";
    config.runsSinceLastEpoch = 0;
  }

  await prisma.skill.update({
    where: { id },
    data: { deepLearning: JSON.stringify(config) },
  });

  return NextResponse.json({ config });
}
