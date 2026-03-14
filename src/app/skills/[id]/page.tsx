import { getSkillWithDetails } from "@/lib/skills/registry";
import { serialize } from "@/lib/db/serialize";
import { SkillDetailClient } from "./skill-detail-client";

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const skill = id === "new" ? null : await getSkillWithDetails(id);
  return <SkillDetailClient initialData={skill ? serialize(skill) : null} id={id} />;
}
