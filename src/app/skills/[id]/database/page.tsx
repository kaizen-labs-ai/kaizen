import { prisma } from "@/lib/db/prisma";
import { notFound } from "next/navigation";
import { SkillDatabasePage } from "./skill-database-page";

export default async function SkillDatabaseRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const skill = await prisma.skill.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!skill) notFound();
  return <SkillDatabasePage skillId={skill.id} skillName={skill.name} />;
}
