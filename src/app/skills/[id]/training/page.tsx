import { prisma } from "@/lib/db/prisma";
import { notFound } from "next/navigation";
import { TrainingPageClient } from "./training-page-client";

export default async function TrainingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const skill = await prisma.skill.findUnique({
    where: { id },
    select: { id: true, name: true, deepLearning: true },
  });
  if (!skill) notFound();
  return <TrainingPageClient skillId={skill.id} skillName={skill.name} />;
}
